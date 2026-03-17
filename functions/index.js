const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { GoogleGenerativeAI } = require("@google/generative-ai");

initializeApp();

const db = getFirestore();
const geminiApiKey = defineSecret("GEMINI_API_KEY");
const uploadApiKey = defineSecret("UPLOAD_API_KEY");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB limit

/**
 * HTTP Cloud Function — called by ESP32 when a bottle is detected.
 *
 * Request:
 *   POST  (raw JPEG body)
 *   Headers:
 *     Content-Type:  image/jpeg
 *     X-Api-Key:     <shared secret>  (required)
 *     X-Machine-Id:  <machineId>      (required)
 *     X-User-Id:     <uid>            (optional)
 *     X-Session-Id:  <sessionId>      (optional)
 *
 * Response (JSON):
 *   { status: "PROCESSING"|"REJECTED", valid: bool, path: string }
 */
exports.uploadBottleImage = onRequest(
  {
    timeoutSeconds: 60,
    memory: "512MiB",
    secrets: [geminiApiKey, uploadApiKey],
    // Allow unauthenticated at IAM level; auth is enforced via X-Api-Key header
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // ── Fix 4: Content-Type validation ────────────────────────────────────────
    if (!req.headers["content-type"]?.startsWith("image/jpeg")) {
      res.status(415).json({ error: "Content-Type must be image/jpeg" });
      return;
    }

    // ── Fix 3: Shared-secret API key validation ───────────────────────────────
    const expectedKey = uploadApiKey.value().trim();
    const providedKey = req.headers["x-api-key"];
    if (!expectedKey || !providedKey || providedKey !== expectedKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const machineId = req.headers["x-machine-id"];
    const userId = req.headers["x-user-id"] || "";
    const sessionId = req.headers["x-session-id"] || "unknown";

    if (!machineId) {
      res.status(400).json({ error: "Missing X-Machine-Id header" });
      return;
    }

    // ── Fix 1: Payload size limit ─────────────────────────────────────────────
    const imageBuffer = req.body;
    if (!imageBuffer || imageBuffer.length === 0) {
      res.status(400).json({ error: "Empty image body" });
      return;
    }
    if (imageBuffer.length > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: `Payload too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
      return;
    }

    const machineRef = db.collection("machines").doc(machineId);

    // ── Validate machine + atomic rate limit (transaction prevents TOCTOU) ────
    let machineNotFound = false;
    let rateLimited = false;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(machineRef);
      if (!snap.exists) { machineNotFound = true; return; }
      const lastUploadAt = snap.data().last_upload_at;
      if (lastUploadAt && Date.now() - lastUploadAt.toMillis() < 3000) {
        rateLimited = true;
        return;
      }
      tx.update(machineRef, { last_upload_at: FieldValue.serverTimestamp() });
    });

    if (machineNotFound) {
      res.status(404).json({ error: "Unknown machine" });
      return;
    }
    if (rateLimited) {
      res.status(429).json({ error: "Rate limit: wait before next upload" });
      return;
    }

    try {
      // ── 1. Save image to Firebase Storage ─────────────────────────────────
      const bucket = getStorage().bucket();
      const timestamp = Date.now();
      const humanDate = new Date(timestamp).toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const storagePath = `captures/${machineId}/${sessionId}/${humanDate}.jpg`;
      const file = bucket.file(storagePath);

      await file.save(imageBuffer, {
        contentType: "image/jpeg",
        metadata: {
          machineId,
          userId,
          sessionId,
          capturedAt: new Date().toISOString(),
        },
      });

      const gsUri = `gs://${bucket.name}/${storagePath}`;
      console.log(`[Storage] saved: ${gsUri}`);

      // ── 2. Classify with Gemini Vision ────────────────────────────────────
      let isValid = true;
      let classifyReason = "no_api_key";
      let classifyLabel = "unknown";

      const apiKey = geminiApiKey.value();
      if (apiKey) {
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-1.5-flash" });

          const prompt = `You are a smart recycling machine (Gloop RVM). Examine this image and identify the bottle brand by reading the CAP logo and SIDE LABEL text/design.

Accepted bottles (valid = true) — identify by brand markings:
1. "m150"      — M-150 energy drink. Look for: "M-150" or "M150" text on the cap or label. Red/yellow label design with the M-150 logo.
2. "cvitt"     — C-Vitt vitamin drink. Look for: "C-vitt" or "C-Vitt" text on the cap or label. Orange/white label with vitamin C branding.
3. "lipoviton" — Lipoviton energy drink (ลิโพวิตัน). Look for: "Lipoviton" text on the cap or label. Yellow/green label design.

Classification priority:
- First try to read the brand name on the CAP (top of bottle).
- If cap is not visible, read the SIDE LABEL text or logo.
- If the brand matches one of the 3 above → valid = true.
- If the brand is unrecognizable or different → valid = false.

NOT accepted (valid = false):
- Any bottle whose label/cap does not match M-150, C-Vitt, or Lipoviton
- Plastic or PET bottles
- Aluminum or tin cans
- Cardboard, paper, tetra pak
- Blurry or unclear images where brand cannot be determined

Reply ONLY with a JSON object — no markdown, no extra text:
{"valid": true, "label": "m150", "reason": "M-150 text visible on cap and red label"}
or
{"valid": false, "label": "other_glass", "reason": "label shows different brand, not accepted"}

The label must be one of: "m150", "cvitt", "lipoviton", "can", "pet_bottle", "other_glass", "cardboard", "unknown".`;

          const imageData = {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType: "image/jpeg",
            },
          };

          const result = await model.generateContent([prompt, imageData]);
          const text = result.response.text().trim();
          console.log(`[Gemini] raw response: ${text}`);

          // Try parsing the full text first, then extract the first {...} block.
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            const jsonMatch = text.match(/\{[^{}]*\}/);
            if (jsonMatch) {
              try { parsed = JSON.parse(jsonMatch[0]); } catch { /* leave null */ }
            }
          }

          if (parsed !== null && typeof parsed === "object" && "valid" in parsed) {
            isValid = parsed.valid === true;
            classifyReason = parsed.reason || "classified";
            classifyLabel = parsed.label || "unknown";
          } else {
            console.warn("[Gemini] could not parse JSON, defaulting to reject");
            isValid = false;
            classifyReason = "parse_error_reject";
            classifyLabel = "unknown";
          }
        } catch (geminiErr) {
          console.error("[Gemini] classification error:", geminiErr);
          classifyReason = "gemini_error_accept";
        }
      }

      console.log(`[Classify] valid=${isValid} label=${classifyLabel} reason=${classifyReason}`);

      // ── 3. Update Firestore ───────────────────────────────────────────────
      const newStatus = isValid ? "PROCESSING" : "REJECTED";

      await machineRef.update({
        status: newStatus,
        last_capture: {
          path: gsUri,
          storage_path: storagePath,
          valid: isValid,
          label: classifyLabel,
          reason: classifyReason,
          captured_at: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[Firestore] machine ${machineId} status → ${newStatus}`);

      // ── 4. Write sorting log (valid bottles only) ──────────────────────────
      if (isValid) {
        await db.collection("logs").add({
          machine_id: machineId,
          bottle_type: classifyLabel,
          user_id: userId,
          session_id: sessionId,
          sorted_at: FieldValue.serverTimestamp(),
        });
        console.log(`[Logs] sorted: ${classifyLabel} by ${userId || "unknown"}`);
      }

      res.status(200).json({
        status: newStatus,
        valid: isValid,
        label: classifyLabel,
        path: storagePath,
      });
    } catch (err) {
      console.error("[uploadBottleImage] error:", err);

      // Fallback: default to PROCESSING so user is not blocked
      try {
        await machineRef.update({
          status: "PROCESSING",
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (fallbackErr) {
        console.error("[uploadBottleImage] fallback update failed:", fallbackErr);
      }

      res.status(500).json({ error: String(err), status: "PROCESSING" });
    }
  }
);

/**
 * Scheduled function — runs every 5 minutes.
 * Resets any machine stuck in an active state (READY/PROCESSING/REJECTED)
 * with no activity for more than 10 minutes.
 */
exports.resetStaleSessions = onSchedule("every 5 minutes", async () => {
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  const cutoff = new Date(Date.now() - TIMEOUT_MS);

  const snapshot = await db.collection("machines")
    .where("status", "in", ["READY", "PROCESSING", "REJECTED"])
    .get();

  if (snapshot.empty) {
    console.log("[resetStaleSessions] no active machines");
    return;
  }

  const resets = snapshot.docs
    .filter((doc) => {
      const updatedAt = doc.data().updatedAt?.toDate?.();
      return updatedAt && updatedAt < cutoff;
    })
    .map((doc) => {
      console.log(`[resetStaleSessions] resetting ${doc.id} (last active: ${doc.data().updatedAt?.toDate()})`);
      return doc.ref.update({
        status: "IDLE",
        current_user: "",
        session_id: "",
        session_score: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

  await Promise.all(resets);
  console.log(`[resetStaleSessions] reset ${resets.length} machine(s)`);
});
