const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { GoogleGenerativeAI } = require("@google/generative-ai");

initializeApp();

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

    const db = getFirestore();
    const machineRef = db.collection("machines").doc(machineId);

    // ── Fix 2: Validate machineId exists before touching Storage or Gemini ────
    const machineSnap = await machineRef.get();
    if (!machineSnap.exists) {
      res.status(404).json({ error: "Unknown machine" });
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
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

          const prompt = `You are a smart recycling machine. Examine this image and decide whether the object is a valid recyclable plastic bottle (e.g. PET water bottle, beverage bottle, soda bottle).

Reply ONLY with a JSON object — no markdown, no extra text:
{"valid": true, "label": "plastic bottle", "reason": "clear PET bottle"}
or
{"valid": false, "label": "non-bottle", "reason": "appears to be a can"}

Rules:
- valid = true  → plastic bottles only (PET/HDPE)
- valid = false → glass, cans, cardboard, unclear image, non-bottle objects`;

          const imageData = {
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType: "image/jpeg",
            },
          };

          const result = await model.generateContent([prompt, imageData]);
          const text = result.response.text().trim();
          console.log(`[Gemini] raw response: ${text}`);

          const jsonMatch = text.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            isValid = parsed.valid === true;
            classifyReason = parsed.reason || "classified";
            classifyLabel = parsed.label || "unknown";
          } else {
            console.warn("[Gemini] could not parse JSON, defaulting to accept");
            classifyReason = "parse_error_accept";
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
