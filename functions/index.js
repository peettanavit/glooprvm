const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();
const uploadApiKey = defineSecret("UPLOAD_API_KEY");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB limit

/**
 * HTTP Cloud Function — called by ESP32 when a bottle is detected.
 *
 * Saves the JPEG to Firebase Storage and sets status: "ready" in Firestore.
 * Classification is handled by the external Python AI listener (listener.py),
 * which watches for status: "ready" and writes the result back.
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
 *   { status: "ready", path: string }
 */
exports.uploadBottleImage = onRequest(
  {
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [uploadApiKey],
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
      const storagePath = `captures/${machineId}/${sessionId}/labels/${humanDate}.jpg`;
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

      // ── 2. Signal the Python AI listener ─────────────────────────────────
      // Classification is done externally by listener.py, which watches for
      // status: "ready" and writes valid/label/reason back to Firestore.
      await machineRef.update({
        status: "ready",
        last_capture: {
          path: gsUri,
          label_storage_path: storagePath,
          captured_at: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[Firestore] machine ${machineId} status → ready`);

      res.status(200).json({
        status: "ready",
        path: storagePath,
      });
    } catch (err) {
      console.error("[uploadBottleImage] error:", err);

      // Fallback: default to PROCESSING so the ESP32 / web are not blocked
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
    .where("status", "in", ["READY", "PROCESSING", "REJECTED", "COMPLETED", "ready", "processing_ai"])
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
