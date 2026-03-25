"""
Gloop RVM — Webcam AI Listener  (Logitech C270 / USB webcam edition)
---------------------------------------------------------------------
Flow:
  1. Master ESP32 detects bottle via sensor, sets:
       machines/{id}.status = "ready"
     (No image upload — ESP32 must have WEBCAM_MODE=true in config.h)

  2. This service detects status = "ready", claims the document, waits
     CAPTURE_DELAY_S seconds for the bottle to settle, then captures a
     frame directly from the USB webcam (OpenCV VideoCapture).

  3. Runs label_model (YOLO) on the captured frame.

  4. Result written back:
       status   → "PROCESSING" | "REJECTED"
       result   → 1 (lipo_cap) | 2 (cvitt_cap) | 3 (m150_cap)
       last_capture.* → ai_label, ai_conf, reason

  Master ESP32 reads status and controls the solenoid.

How to run:
  python listener_webcam.py

Required env vars (see .env.example):
  FIREBASE_SERVICE_ACCOUNT   path to service account JSON
  WEBCAM_INDEX               camera device index (default: 0)
  CAPTURE_DELAY_S            seconds to wait after trigger before capture (default: 0.3)
  AI_CONFIDENCE_THRESHOLD    minimum YOLO confidence (default: 0.5)
"""

import os
import time
import logging
import cv2
import numpy as np
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.transaction import transactional
from ultralytics import YOLO

load_dotenv()

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Firebase init (no Storage needed) ────────────────────────────────────────
_sa_path = os.environ["FIREBASE_SERVICE_ACCOUNT"]

cred = credentials.Certificate(_sa_path)
firebase_admin.initialize_app(cred)

db = firestore.client()

# ─────────────────────────────────────────────────────────────────────────────
# Webcam init
# ─────────────────────────────────────────────────────────────────────────────

_WEBCAM_NAME    = os.environ.get("WEBCAM_NAME", "")
_WEBCAM_INDEX   = int(os.environ.get("WEBCAM_INDEX", "0"))
_CAPTURE_DELAY  = float(os.environ.get("CAPTURE_DELAY_S", "0.3"))

# Prefer name-based open (needed for cameras that can't be opened by index on Windows)
if _WEBCAM_NAME:
    _cam_src = f"video={_WEBCAM_NAME}"
    log.info("[CAM] Opening webcam by name: %s…", _WEBCAM_NAME)
else:
    _cam_src = _WEBCAM_INDEX
    log.info("[CAM] Opening webcam index %d…", _WEBCAM_INDEX)

_cap = cv2.VideoCapture(_cam_src, cv2.CAP_DSHOW)
_cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
_cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
_cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)

if not _cap.isOpened():
    raise RuntimeError(f"Cannot open webcam: {_cam_src}")

# Warmup: discard early frames so AEC/AWB can settle
log.info("[CAM] Warming up webcam (20 frames)…")
for _ in range(20):
    _cap.read()
log.info("[CAM] Webcam ready — %dx%d",
         int(_cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
         int(_cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))


def capture_frame() -> np.ndarray | None:
    """Grab a fresh frame from the webcam. Returns BGR ndarray or None on failure."""
    # Flush stale buffered frames — grab twice, use second
    _cap.grab()
    ret, frame = _cap.read()
    if not ret or frame is None:
        log.warning("[CAM] frame capture failed")
        return None
    return frame


# ─────────────────────────────────────────────────────────────────────────────
# YOLO model loading
# ─────────────────────────────────────────────────────────────────────────────

_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
log.info("[AI] Loading label model…")
_label_model = YOLO(os.path.join(_MODEL_DIR, "label_model.pt"))
log.info("[AI] Label model ready. Classes: %s", _label_model.names)

_CONFIDENCE_THRESHOLD   = float(os.environ.get("AI_CONFIDENCE_THRESHOLD", "0.5"))
_SAFETY_LOCK_THRESHOLD  = float(os.environ.get("AI_SAFETY_LOCK_THRESHOLD", "0.35"))

# Class names must match label_model.pt — same as listener.py
_LABEL_TO_RESULT: dict[str, int] = {
    "lipo_cap":  1,
    "lipo":      1,   # alias: label_model may return without _cap suffix
    "cvitt_cap": 2,
    "cvitt":     2,   # alias: label_model may return without _cap suffix
    "m150_cap":  3,
    "m150":      3,   # alias: label_model may return without _cap suffix
}

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


def detect_bottle(frame: np.ndarray) -> dict:
    """
    Run label_model on a webcam frame.

    Decision priority:
      1. label_model detects a REJECT class      → REJECTED
      2. label_model detects an ACCEPT class     → PROCESSING
      3. Anything else                           → REJECTED

    Returns a dict with: valid, result, ai_label, ai_conf, reason
    """
    ai_label, ai_conf = _top_detection(_label_model(frame, verbose=False)[0])
    log.info("[YOLO] label=%s(%.2f)", ai_label, ai_conf)

    # Safety Lock: hard floor — reject immediately if confidence is too low
    if ai_conf < _SAFETY_LOCK_THRESHOLD:
        log.warning("[SAFETY_LOCK] ai_conf=%.2f below %.2f — hard REJECTED",
                    ai_conf, _SAFETY_LOCK_THRESHOLD)
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "reason": "Low confidence",
        }

    if ai_label in _REJECT_CLASSES and ai_conf >= _CONFIDENCE_THRESHOLD:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "reason": f"reject class '{ai_label}' (conf={ai_conf:.2f})",
        }

    result_code = _LABEL_TO_RESULT.get(ai_label)

    if result_code is None:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "reason": (
                f"'{ai_label}' not in accepted or reject classes"
                if ai_label != "none"
                else "no detection"
            ),
        }

    if ai_conf < _CONFIDENCE_THRESHOLD:
        return {
            "valid": False, "result": None,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "reason": f"'{ai_label}' conf {ai_conf:.2f} below threshold {_CONFIDENCE_THRESHOLD}",
        }

    return {
        "valid":    True,
        "result":   result_code,
        "ai_label": ai_label,
        "ai_conf":  ai_conf,
        "reason":   f"accepted '{ai_label}' conf={ai_conf:.2f} [webcam]",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Transaction: atomically claim a "ready" document
# ─────────────────────────────────────────────────────────────────────────────

@transactional
def _claim_if_ready(transaction, machine_ref):
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
# Pipeline: capture → infer → write result
# ─────────────────────────────────────────────────────────────────────────────

def process_machine(machine_id: str, data: dict):
    machine_ref = db.collection("machines").document(machine_id)

    try:
        claimed = _claim_if_ready(db.transaction(), machine_ref)
    except Exception as e:
        log.error("[%s] transaction error: %s", machine_id, e)
        return

    if not claimed:
        log.info("[%s] not claimed (status already changed) — skipping", machine_id)
        return

    log.info("[%s] claimed → capturing from webcam in %.1fs…", machine_id, _CAPTURE_DELAY)

    try:
        # Wait for bottle to settle before capturing
        if _CAPTURE_DELAY > 0:
            time.sleep(_CAPTURE_DELAY)

        frame = capture_frame()
        if frame is None:
            raise RuntimeError("webcam capture returned None")

        log.info("[%s] frame captured (%dx%d)", machine_id, frame.shape[1], frame.shape[0])

        # Save frame for debugging
        debug_dir = os.path.join(os.path.dirname(__file__), "debug_captures")
        os.makedirs(debug_dir, exist_ok=True)
        debug_path = os.path.join(debug_dir, f"{machine_id}_{int(time.time())}.jpg")
        cv2.imwrite(debug_path, frame)
        log.info("[%s] frame saved: %s", machine_id, debug_path)

        detection  = detect_bottle(frame)
        is_valid   = detection["valid"]
        new_status = "PROCESSING" if is_valid else "REJECTED"

        update_payload = {
            "status":                new_status,
            "last_capture.valid":    is_valid,
            "last_capture.ai_label": detection["ai_label"],
            "last_capture.ai_conf":  detection["ai_conf"],
            "last_capture.cap_name": "webcam",
            "last_capture.cap_conf": 0.0,
            "last_capture.dual_cam": False,
            "last_capture.reason":   detection["reason"],
            "updatedAt":             firestore.SERVER_TIMESTAMP,
        }

        if is_valid:
            update_payload["result"] = detection["result"]

        machine_ref.update(update_payload)

        if is_valid:
            db.collection("logs").add({
                "machine_id":  machine_id,
                "bottle_type": detection["ai_label"],
                "result":      detection["result"],
                "ai_label":    detection["ai_label"],
                "ai_conf":     detection["ai_conf"],
                "cap_name":    "webcam",
                "cap_conf":    0.0,
                "dual_cam":    False,
                "user_id":     data.get("current_user", ""),
                "session_id":  data.get("session_id", "unknown"),
                "sorted_at":   firestore.SERVER_TIMESTAMP,
            })

        log.info("[%s] → status=%s  label=%s  result=%s  conf=%.2f",
                 machine_id, new_status, detection["ai_label"],
                 detection.get("result"), detection["ai_conf"])

    except Exception as exc:
        log.exception("[%s] pipeline failed: %s", machine_id, exc)
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
            log.error("[%s] fallback update also failed: %s", machine_id, fallback_exc)


# ─────────────────────────────────────────────────────────────────────────────
# Firestore listener
# ─────────────────────────────────────────────────────────────────────────────

def on_machines_snapshot(col_snapshot, changes, read_time):
    for change in changes:
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
    log.info("Gloop AI Listener (webcam mode) — watching machines collection")
    watch = db.collection("machines").on_snapshot(on_machines_snapshot)
    log.info("Listener active. Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down…")
        watch.unsubscribe()
        _cap.release()


if __name__ == "__main__":
    main()
