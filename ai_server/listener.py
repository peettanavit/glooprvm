"""
Gloop RVM — Firestore Listener AI Service  (Dual ESP32-CAM edition)
--------------------------------------------------------------------
Flow:
  1. Master ESP32 (side / label camera) captures a bottle image, uploads it
     to Firebase Storage, and sets:
       machines/{id}.status                      = "ready"
       machines/{id}.last_capture.label_storage_path = "<path>"

  2. Slave ESP32 (top / cap camera) uploads its image shortly after and sets:
       machines/{id}.last_capture.cap_storage_path = "<path>"
     (This write may arrive a fraction of a second after "ready".)

  3. This service detects status = "ready", claims the document, then waits up
     to CAP_WAIT_SECONDS for the Slave image.  It then runs:
       • label_model  on the Master (label) image  — primary decision-maker
       • cap_model    on the Slave  (cap)   image  — validator / negative filter
                                                     (skipped if Slave timed out)

  4. Result written back:
       status              → "PROCESSING" | "REJECTED"
       result              → 1 (lipo_cap) | 2 (cvitt_cap) | 3 (m150_cap)
       last_capture.*      → ai_label, ai_conf, cap_name, cap_conf, dual_cam, reason

  Master ESP32 is the ONLY device that reads status and triggers the solenoid.
  Slave ESP32 only uploads; it never reads Firestore.

How to run:
  python listener.py

Required env vars (see .env.example):
  FIREBASE_SERVICE_ACCOUNT   path to service account JSON
  FIREBASE_STORAGE_BUCKET    e.g. glooprvm.firebasestorage.app
  CAP_WAIT_SECONDS           seconds to wait for Slave image (default: 2.0)
  AI_CONFIDENCE_THRESHOLD    minimum YOLO confidence (default: 0.5)
"""

import os
import time
import logging
import cv2
import numpy as np
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud.firestore_v1.transaction import transactional
from ultralytics import YOLO

load_dotenv()

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Firebase init ─────────────────────────────────────────────────────────────
_sa_path = os.environ["FIREBASE_SERVICE_ACCOUNT"]
_bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", "glooprvm.firebasestorage.app")

cred = credentials.Certificate(_sa_path)
firebase_admin.initialize_app(cred, {"storageBucket": _bucket_name})

db     = firestore.client()
bucket = storage.bucket()


# ─────────────────────────────────────────────────────────────────────────────
# YOLO Model loading (once at startup)
# ─────────────────────────────────────────────────────────────────────────────

_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
log.info("[AI] Loading YOLO models…")
_label_model = YOLO(os.path.join(_MODEL_DIR, "label_model.pt"))
_cap_model   = YOLO(os.path.join(_MODEL_DIR, "cap_model.pt"))
log.info("[AI] Models loaded. Label classes: %s", _label_model.names)
log.info("[AI] Cap classes: %s", _cap_model.names)

# Minimum confidence to act on any detection (accept OR reject)
_CONFIDENCE_THRESHOLD = float(os.environ.get("AI_CONFIDENCE_THRESHOLD", "0.5"))

# Seconds to wait for Slave ESP32 cap image before falling back to single-cam mode.
# 1.5 s is enough for a typical WiFi upload; raise if your network is slow.
_CAP_WAIT_S = float(os.environ.get("CAP_WAIT_SECONDS", "1.5"))

# ── Accepted classes — mapped to ESP32 result codes ──────────────────────────
# Order matches physical sorting slots: 1 = smallest, 3 = largest.
# Only these three classes trigger status: "PROCESSING" and open the solenoid.
_LABEL_TO_RESULT: dict[str, int] = {
    "lipo_cap":  1,   # smallest bottle — sorts first
    "cvitt_cap": 2,   # medium bottle   — sorts second
    "m150_cap":  3,   # largest bottle  — sorts last
}

# ── Negative-filter classes — explicitly rejected ─────────────────────────────
# If EITHER model detects one of these with conf >= threshold, the bottle is
# rejected immediately — even if the other model would have accepted it.
_REJECT_CLASSES: frozenset[str] = frozenset({
    "ginseng_cap",
    "m-sport_cap",
    "peptein_cap",
    "shark_cap",
})


# ─────────────────────────────────────────────────────────────────────────────
# AI inference
# ─────────────────────────────────────────────────────────────────────────────

def _top_detection(results) -> tuple[str, float]:
    """Return (class_name, confidence) for the highest-confidence box, or ('none', 0.0)."""
    if len(results.boxes) == 0:
        return "none", 0.0
    top_idx = int(results.boxes.conf.argmax().item())
    name    = results.names[int(results.boxes.cls[top_idx].item())]
    conf    = float(results.boxes.conf[top_idx].item())
    return name, conf


def detect_bottle(label_bytes: bytes, cap_bytes: bytes | None) -> dict:
    """
    Primary:   label_model  on label_bytes  (Master ESP32 — side/label camera).
    Validator: cap_model    on cap_bytes    (Slave  ESP32 — top/cap camera).
               Skipped entirely when cap_bytes is None (graceful degradation).

    Decision priority (checked in order):
      1. Label image decode failure              → REJECTED
      2. label_model detects a REJECT class      → REJECTED  (negative filter)
      3. cap_model detects a REJECT class        → REJECTED  (validator veto, dual-cam only)
      4. label_model detects an ACCEPT class     → PROCESSING  (result 1 / 2 / 3)
      5. Anything else                           → REJECTED

    Returns a dict with:
        valid       (bool)        — True → "PROCESSING", False → "REJECTED"
        result      (int | None)  — 1 (lipo_cap) / 2 (cvitt_cap) / 3 (m150_cap)
        ai_label    (str)         — label_model top class name
        ai_conf     (float)       — label_model top confidence (0–1)
        cap_name    (str)         — cap_model top class name, or "no_image" if skipped
        cap_conf    (float)       — cap_model top confidence (0–1), or 0.0 if skipped
        dual_cam    (bool)        — True if Slave image was used in this decision
        reason      (str)         — human-readable explanation for logs
    """
    # ── Step 1: Decode label image (required) ─────────────────────────────────
    nparr     = np.frombuffer(label_bytes, np.uint8)
    label_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if label_img is None:
        return {
            "valid": False, "result": None,
            "ai_label": "decode_error", "ai_conf": 0.0,
            "cap_name": "no_image",     "cap_conf": 0.0,
            "dual_cam": False,
            "reason": "could not decode label image bytes (Master)",
        }

    # ── Run label model (primary) ─────────────────────────────────────────────
    ai_label, ai_conf = _top_detection(_label_model(label_img, verbose=False)[0])

    # ── Decode + run cap model (Slave — only when image is available) ─────────
    cap_name, cap_conf, dual_cam = "no_image", 0.0, False
    if cap_bytes is not None:
        nparr   = np.frombuffer(cap_bytes, np.uint8)
        cap_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if cap_img is not None:
            cap_name, cap_conf = _top_detection(_cap_model(cap_img, verbose=False)[0])
            dual_cam = True
        else:
            cap_name = "decode_error"
            log.warning("[YOLO] cap image decode failed — treating as single-cam")

    log.info("[YOLO] label=%s(%.2f)  cap=%s(%.2f)  dual_cam=%s",
             ai_label, ai_conf, cap_name, cap_conf, dual_cam)

    # ── Step 2: label_model negative-filter check ─────────────────────────────
    if ai_label in _REJECT_CLASSES and ai_conf >= _CONFIDENCE_THRESHOLD:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "cap_name": cap_name, "cap_conf": cap_conf,
            "dual_cam": dual_cam,
            "reason": f"label_model flagged reject class '{ai_label}' (conf={ai_conf:.2f})",
        }

    # ── Step 3: cap_model validator veto (dual-cam only) ──────────────────────
    if dual_cam and cap_name in _REJECT_CLASSES and cap_conf >= _CONFIDENCE_THRESHOLD:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "cap_name": cap_name, "cap_conf": cap_conf,
            "dual_cam": dual_cam,
            "reason": (
                f"cap_model vetoed '{ai_label}': "
                f"detected reject class '{cap_name}' (conf={cap_conf:.2f})"
            ),
        }

    # ── Step 4: Accept check (label_model primary) ────────────────────────────
    result_code = _LABEL_TO_RESULT.get(ai_label)

    if result_code is None:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "cap_name": cap_name, "cap_conf": cap_conf,
            "dual_cam": dual_cam,
            "reason": (
                f"label_model returned '{ai_label}' — not in accepted or reject classes"
                if ai_label != "none"
                else "label_model found no detection"
            ),
        }

    if ai_conf < _CONFIDENCE_THRESHOLD:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "cap_name": cap_name, "cap_conf": cap_conf,
            "dual_cam": dual_cam,
            "reason": f"'{ai_label}' confidence {ai_conf:.2f} below threshold {_CONFIDENCE_THRESHOLD}",
        }

    # ── Accepted ──────────────────────────────────────────────────────────────
    mode = (
        f"dual-cam validator='{cap_name}'({cap_conf:.2f})"
        if dual_cam else
        "single-cam (Slave offline or timed out)"
    )
    return {
        "valid":    True,
        "result":   result_code,
        "ai_label": ai_label,
        "ai_conf":  ai_conf,
        "cap_name": cap_name,
        "cap_conf": cap_conf,
        "dual_cam": dual_cam,
        "reason":   f"accepted '{ai_label}' conf={ai_conf:.2f} [{mode}]",
    }


def _wait_for_cap_path(machine_ref, initial_data: dict) -> str | None:
    """
    Returns last_capture.cap_storage_path when available.

    Checks the initial snapshot first (zero-latency if Slave already uploaded).
    If not present, polls Firestore every 200 ms for up to _CAP_WAIT_S seconds.
    Returns None if the Slave didn't upload within the window — caller proceeds
    in single-cam mode.
    """
    cap_path = (initial_data.get("last_capture") or {}).get("cap_storage_path")
    if cap_path:
        log.info("[CAM] Slave image already present in snapshot")
        return cap_path

    log.info("[CAM] Waiting up to %.1fs for Slave ESP32 cap image…", _CAP_WAIT_S)
    deadline = time.monotonic() + _CAP_WAIT_S
    while time.monotonic() < deadline:
        time.sleep(0.2)
        snap     = machine_ref.get()
        cap_path = (snap.get("last_capture") or {}).get("cap_storage_path")
        if cap_path:
            log.info("[CAM] Slave image arrived: %s", cap_path)
            return cap_path

    log.info("[CAM] Slave image not received within %.1fs — single-cam mode", _CAP_WAIT_S)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Transaction: atomically claim a "ready" document to prevent double-processing
# ─────────────────────────────────────────────────────────────────────────────

@transactional
def _claim_if_ready(transaction, machine_ref):
    """
    Reads the machine document inside a transaction.
    If status is still "ready", sets it to "processing_ai" and returns True.
    Otherwise returns False (already claimed by another worker or status changed).
    """
    snap = machine_ref.get(transaction=transaction)
    if not snap.exists:
        return False
    if snap.get("status") != "ready":
        return False

    transaction.update(machine_ref, {
        "status":    "processing_ai",
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline: download → infer → write result
# ─────────────────────────────────────────────────────────────────────────────

def process_machine(machine_id: str, data: dict):
    machine_ref = db.collection("machines").document(machine_id)

    # Atomically claim the document so multiple restarts don't double-process.
    try:
        claimed = _claim_if_ready(db.transaction(), machine_ref)
    except Exception as e:
        log.error(f"[{machine_id}] transaction error: {e}")
        return

    if not claimed:
        log.info(f"[{machine_id}] not claimed (status already changed) — skipping")
        return

    log.info(f"[{machine_id}] claimed → starting AI pipeline")

    last_capture = data.get("last_capture") or {}
    # Support new dual-cam field name; fall back to legacy single-cam field
    label_path = last_capture.get("label_storage_path") or last_capture.get("storage_path")

    try:
        if not label_path:
            raise ValueError(
                "last_capture.label_storage_path (or storage_path) is missing — "
                "Master ESP32 may not have uploaded yet"
            )

        # 1. Download label image (Master ESP32 — always required)
        log.info(f"[{machine_id}] downloading label image: {label_path}")
        label_bytes = bucket.blob(label_path).download_as_bytes()
        log.info(f"[{machine_id}] label image: {len(label_bytes):,} bytes")

        # 2. Wait for cap image (Slave ESP32 — optional)
        cap_path  = _wait_for_cap_path(machine_ref, data)
        cap_bytes = None
        if cap_path:
            log.info(f"[{machine_id}] downloading cap image: {cap_path}")
            cap_bytes = bucket.blob(cap_path).download_as_bytes()
            log.info(f"[{machine_id}] cap image: {len(cap_bytes):,} bytes")

        # 3. Run AI models
        detection  = detect_bottle(label_bytes, cap_bytes)
        log.info(f"[{machine_id}] detection: {detection}")

        is_valid   = detection["valid"]
        new_status = "PROCESSING" if is_valid else "REJECTED"

        # 4. Write result back — dot notation preserves other last_capture fields.
        #    Delete cap_storage_path after use: prevents a stale Slave path from a
        #    previous cycle being picked up if the Slave is slow on the next bottle.
        #    (label_storage_path is safe — the Cloud Function replaces the whole
        #    last_capture map on each new Master upload, so it's always fresh.)
        update_payload = {
            "status":                        new_status,
            "last_capture.valid":            is_valid,
            "last_capture.ai_label":         detection["ai_label"],
            "last_capture.ai_conf":          detection["ai_conf"],
            "last_capture.cap_name":         detection["cap_name"],
            "last_capture.cap_conf":         detection["cap_conf"],
            "last_capture.dual_cam":         detection["dual_cam"],
            "last_capture.reason":           detection["reason"],
            "last_capture.cap_storage_path": firestore.DELETE_FIELD,
            "updatedAt":                     firestore.SERVER_TIMESTAMP,
        }
        if is_valid:
            update_payload["result"] = detection["result"]

        machine_ref.update(update_payload)

        # 5. Write sorting log for valid bottles
        if is_valid:
            db.collection("logs").add({
                "machine_id":  machine_id,
                "bottle_type": detection["ai_label"],  # web SortingHistoryTable reads this field
                "result":      detection["result"],
                "ai_label":    detection["ai_label"],
                "ai_conf":     detection["ai_conf"],
                "cap_name":    detection["cap_name"],
                "cap_conf":    detection["cap_conf"],
                "dual_cam":    detection["dual_cam"],
                "user_id":     data.get("current_user", ""),
                "session_id":  data.get("session_id", "unknown"),
                "sorted_at":   firestore.SERVER_TIMESTAMP,
            })

        log.info(
            f"[{machine_id}] → status={new_status}  label={detection['ai_label']}  "
            f"result={detection.get('result')}  conf={detection['ai_conf']:.2f}  "
            f"dual_cam={detection['dual_cam']}"
        )

    except Exception as exc:
        log.exception(f"[{machine_id}] pipeline failed: {exc}")

        # Fail safe: set "REJECTED" so the Master ESP32 keeps the solenoid closed.
        try:
            machine_ref.update({
                "status":                "REJECTED",
                "last_capture.valid":    False,
                "last_capture.ai_label": "unknown",
                "last_capture.ai_conf":  0.0,
                "last_capture.reason":   f"ai_service_error: {exc}",
                "updatedAt":             firestore.SERVER_TIMESTAMP,
            })
        except Exception as fallback_exc:
            log.error(f"[{machine_id}] fallback update also failed: {fallback_exc}")


# ─────────────────────────────────────────────────────────────────────────────
# Firestore listener
# ─────────────────────────────────────────────────────────────────────────────

def on_machines_snapshot(col_snapshot, changes, read_time):
    """Called by Firestore on every change to the machines collection."""
    for change in changes:
        # Ignore removals; handle both new documents and updates.
        if change.type.name not in ("ADDED", "MODIFIED"):
            continue

        doc  = change.document
        data = doc.to_dict() or {}

        if data.get("status") == "ready":
            process_machine(doc.id, data)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    log.info("Gloop AI Listener — watching machines collection for status=ready")
    watch = db.collection("machines").on_snapshot(on_machines_snapshot)
    log.info("Listener active. Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down…")
        watch.unsubscribe()


if __name__ == "__main__":
    main()
