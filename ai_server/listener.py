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
import threading
import cv2
import numpy as np
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud.firestore_v1.transaction import transactional
from ultralytics import YOLO
from config_manager import ConfigManager

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

# ── Dynamic config (replaces static .env thresholds) ─────────────────────────
_config = ConfigManager(db, os.environ.get("MACHINE_ID", "Gloop_01"))

# ── Service state (read by api.py for /health and /status) ───────────────────
service_state: dict = {
    "started_at":       time.time(),
    "total_processed":  0,
    "last_processed_at": None,
    "last_detection":   None,
    "listener_alive":   False,
}
_state_lock = threading.Lock()


# ─────────────────────────────────────────────────────────────────────────────
# YOLO Model loading (once at startup)
# ─────────────────────────────────────────────────────────────────────────────

_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
log.info("[AI] Loading YOLO models…")
_label_model = YOLO(os.path.join(_MODEL_DIR, "label_model.pt"))
_cap_model   = YOLO(os.path.join(_MODEL_DIR, "cap_model.pt"))
log.info("[AI] Models loaded. Label classes: %s", _label_model.names)
log.info("[AI] Cap classes: %s", _cap_model.names)

# NOTE: AI_CONFIDENCE_THRESHOLD, AI_SAFETY_LOCK_THRESHOLD, CAP_WAIT_SECONDS
# are now fetched dynamically from Firestore via _config.get_float().
# .env values are kept as startup fallbacks only (loaded into _config defaults).

# ── Accepted classes — mapped to ESP32 result codes ──────────────────────────
# Order matches physical sorting slots: 1 = smallest, 3 = largest.
# Only these three classes trigger status: "PROCESSING" and open the solenoid.
_LABEL_TO_RESULT: dict[str, int] = {
    "lipo_cap":  1,   # smallest bottle — sorts first
    "lipo":      1,   # alias: label_model may return without _cap suffix
    "cvitt_cap": 2,   # medium bottle   — sorts second
    "cvitt":     2,   # alias: label_model may return without _cap suffix
    "m150_cap":  3,   # largest bottle  — sorts last
    "m150":      3,   # alias: label_model may return without _cap suffix
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


def _all_scores(results) -> dict[str, float]:
    """Return {class_name: best_confidence} for every detected box."""
    scores: dict[str, float] = {}
    for i in range(len(results.boxes)):
        name = results.names[int(results.boxes.cls[i].item())]
        conf = round(float(results.boxes.conf[i].item()), 4)
        if name not in scores or conf > scores[name]:
            scores[name] = conf
    return scores


def detect_bottle(
    label_bytes: bytes,
    cap_bytes: bytes | None,
    *,
    conf_threshold: float,
    safety_lock_threshold: float,
) -> dict:
    """
    Primary:   label_model  on label_bytes  (Master ESP32 — side/label camera).
    Validator: cap_model    on cap_bytes    (Slave  ESP32 — top/cap camera).
               Skipped entirely when cap_bytes is None (graceful degradation).

    Decision priority (checked in order):
      1. Label image decode failure                          → REJECTED
      2. Safety lock: label_model conf < floor               → REJECTED
      3. label_model detects a REJECT class                  → REJECTED  (negative filter)
      4. cap_model detects a REJECT class                    → REJECTED  (validator veto, dual-cam only)
      5. label_model conf >= threshold                       → PROCESSING  (master accepts directly)
      6. label_model conf < threshold + slave agrees on same
         class with conf >= threshold                        → PROCESSING  (slave rescue)
      7. Anything else                                       → REJECTED

    Returns a dict with:
        valid              (bool)        — True → "PROCESSING", False → "REJECTED"
        result             (int | None)  — 1 / 2 / 3
        ai_label           (str)
        ai_conf            (float)
        cap_name           (str)
        cap_conf           (float)
        dual_cam           (bool)
        reason             (str)
        label_all_scores   (dict)        — {class: conf} for all label_model detections
        cap_all_scores     (dict)        — {class: conf} for all cap_model detections
        rescued_by_slave   (bool)        — True when Step 6 (slave rescue) triggered
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
            "label_all_scores": {}, "cap_all_scores": {},
            "rescued_by_slave": False,
            "reason": "could not decode label image bytes (Master)",
        }

    # ── Run label model (primary) ─────────────────────────────────────────────
    label_results   = _label_model(label_img, verbose=False)[0]
    ai_label, ai_conf = _top_detection(label_results)
    label_all_scores  = _all_scores(label_results)

    # ── Decode + run cap model (Slave — only when image is available) ─────────
    cap_name, cap_conf, dual_cam = "no_image", 0.0, False
    cap_all_scores: dict[str, float] = {}
    if cap_bytes is not None:
        nparr   = np.frombuffer(cap_bytes, np.uint8)
        cap_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if cap_img is not None:
            cap_results            = _cap_model(cap_img, verbose=False)[0]
            cap_name, cap_conf     = _top_detection(cap_results)
            cap_all_scores         = _all_scores(cap_results)
            dual_cam = True
        else:
            cap_name = "decode_error"
            log.warning("[YOLO] cap image decode failed — treating as single-cam")

    log.info("[YOLO] label=%s(%.2f)  cap=%s(%.2f)  dual_cam=%s",
             ai_label, ai_conf, cap_name, cap_conf, dual_cam)

    # Helper: build a base return dict to avoid repetition
    def _base(valid, result, reason, rescued=False):
        return {
            "valid": valid, "result": result,
            "ai_label": ai_label, "ai_conf": ai_conf,
            "cap_name": cap_name, "cap_conf": cap_conf,
            "dual_cam": dual_cam,
            "label_all_scores": label_all_scores,
            "cap_all_scores":   cap_all_scores,
            "rescued_by_slave": rescued,
            "reason": reason,
        }

    # ── Safety Lock: hard floor on label confidence ────────────────────────────
    if ai_conf < safety_lock_threshold:
        log.warning("[SAFETY_LOCK] ai_conf=%.2f below %.2f — hard REJECTED",
                    ai_conf, safety_lock_threshold)
        return _base(False, None, "Low confidence")

    # ── Step 2: label_model negative-filter check ─────────────────────────────
    if ai_label in _REJECT_CLASSES and ai_conf >= conf_threshold:
        return _base(False, None,
                     f"label_model flagged reject class '{ai_label}' (conf={ai_conf:.2f})")

    # ── Step 3: cap_model validator veto (dual-cam only) ──────────────────────
    if dual_cam and cap_name in _REJECT_CLASSES and cap_conf >= conf_threshold:
        return _base(False, None,
                     f"cap_model vetoed '{ai_label}': "
                     f"detected reject class '{cap_name}' (conf={cap_conf:.2f})")

    # ── Step 4: Accept check (label_model primary) ────────────────────────────
    result_code = _LABEL_TO_RESULT.get(ai_label)

    if result_code is None:
        return _base(False, None,
                     f"label_model returned '{ai_label}' — not in accepted or reject classes"
                     if ai_label != "none" else "label_model found no detection")

    # ── Step 5: Master confident enough → accept directly ─────────────────────
    if ai_conf >= conf_threshold:
        mode = (f"dual-cam validator='{cap_name}'({cap_conf:.2f})"
                if dual_cam else "single-cam (Slave offline or timed out)")
        return _base(True, result_code,
                     f"accepted '{ai_label}' conf={ai_conf:.2f} [{mode}]")

    # ── Step 6: Slave rescue — master below threshold, slave can compensate ───
    if dual_cam:
        slave_result = _LABEL_TO_RESULT.get(cap_name)
        if slave_result == result_code and cap_conf >= conf_threshold:
            log.info("[YOLO] slave rescue: master '%s'(%.2f) < %.2f, slave '%s'(%.2f) agrees",
                     ai_label, ai_conf, conf_threshold, cap_name, cap_conf)
            return _base(True, result_code,
                         f"accepted '{ai_label}' via slave rescue: "
                         f"master={ai_conf:.2f} slave='{cap_name}'({cap_conf:.2f})",
                         rescued=True)

    # ── Rejected — master insufficient, slave could not rescue ────────────────
    slave_note = (f"; slave '{cap_name}'({cap_conf:.2f}) did not rescue"
                  if dual_cam else "")
    return _base(False, None,
                 f"'{ai_label}' master conf {ai_conf:.2f} below threshold "
                 f"{conf_threshold}{slave_note}")


def _wait_for_cap_path(machine_ref, initial_data: dict) -> str | None:
    """
    Returns last_capture.cap_storage_path when available.

    Checks the initial snapshot first (zero-latency if Slave already uploaded).
    If not present, polls Firestore every 200 ms for up to CAP_WAIT_SECONDS.
    Returns None if the Slave didn't upload within the window — caller proceeds
    in single-cam mode.
    """
    cap_path = (initial_data.get("last_capture") or {}).get("cap_storage_path")
    if cap_path:
        log.info("[CAM] Slave image already present in snapshot")
        return cap_path

    cap_wait_s = _config.get_float("CAP_WAIT_SECONDS")
    log.info("[CAM] Waiting up to %.1fs for Slave ESP32 cap image…", cap_wait_s)
    deadline = time.monotonic() + cap_wait_s
    while time.monotonic() < deadline:
        time.sleep(0.2)
        snap     = machine_ref.get()
        cap_path = (snap.get("last_capture") or {}).get("cap_storage_path")
        if cap_path:
            log.info("[CAM] Slave image arrived: %s", cap_path)
            return cap_path

    log.info("[CAM] Slave image not received within %.1fs — single-cam mode", cap_wait_s)
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

        # 3. Run AI models — measure inference latency
        conf_threshold    = _config.get_float("AI_CONFIDENCE_THRESHOLD")
        safety_lock_thr   = _config.get_float("AI_SAFETY_LOCK_THRESHOLD")
        t0 = time.monotonic()
        detection = detect_bottle(
            label_bytes, cap_bytes,
            conf_threshold=conf_threshold,
            safety_lock_threshold=safety_lock_thr,
        )
        inference_ms = round((time.monotonic() - t0) * 1000, 1)
        log.info(f"[{machine_id}] detection ({inference_ms} ms): {detection}")

        is_valid   = detection["valid"]

        # 3b. Bin-full check — override accept if the target slot is full.
        #     result 1=SMALL, 2=MEDIUM, 3=LARGE; bin_full written by Web Admin.
        if is_valid and detection.get("result") is not None:
            _RESULT_TO_SLOT = {1: "SMALL", 2: "MEDIUM", 3: "LARGE"}
            slot = _RESULT_TO_SLOT.get(detection["result"])
            bin_full = (data.get("bin_full") or {})
            if slot and bin_full.get(slot):
                log.warning("[%s] bin %s is full — overriding to REJECTED", machine_id, slot)
                is_valid = False
                detection = {**detection, "valid": False, "reason": f"bin_{slot.lower()}_full"}

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
            "last_capture.inference_ms":     inference_ms,
            "last_capture.cap_storage_path": firestore.DELETE_FIELD,
            "updatedAt":                     firestore.SERVER_TIMESTAMP,
        }
        if is_valid:
            update_payload["result"] = detection["result"]
            update_payload["session_score"] = firestore.Increment(detection["result"])

        machine_ref.update(update_payload)

        # 5. Write inference log for ALL bottles (valid + rejected) with full telemetry
        db.collection("logs").add({
            "machine_id":         machine_id,
            "bottle_type":        detection["ai_label"],  # web SortingHistoryTable reads this field
            "result":             detection.get("result"),
            "valid":              is_valid,
            "ai_label":           detection["ai_label"],
            "ai_conf":            detection["ai_conf"],
            "cap_name":           detection["cap_name"],
            "cap_conf":           detection["cap_conf"],
            "dual_cam":           detection["dual_cam"],
            "rescued_by_slave":   detection["rescued_by_slave"],
            "reason":             detection["reason"],
            # Inference telemetry
            "inference_ms":       inference_ms,
            "label_all_scores":   detection["label_all_scores"],
            "cap_all_scores":     detection["cap_all_scores"],
            # Config snapshot at time of inference (for reproducibility)
            "conf_threshold":     conf_threshold,
            "safety_lock_thr":    safety_lock_thr,
            "user_id":            data.get("current_user", ""),
            "session_id":         data.get("session_id", "unknown"),
            "sorted_at":          firestore.SERVER_TIMESTAMP,
        })

        # 6. Update service state for /status endpoint
        with _state_lock:
            service_state["total_processed"]  += 1
            service_state["last_processed_at"] = time.time()
            service_state["last_detection"]    = {
                "machine_id":   machine_id,
                "valid":        is_valid,
                "ai_label":     detection["ai_label"],
                "ai_conf":      detection["ai_conf"],
                "dual_cam":     detection["dual_cam"],
                "inference_ms": inference_ms,
                "status":       new_status,
            }

        log.info(
            f"[{machine_id}] → status={new_status}  label={detection['ai_label']}  "
            f"result={detection.get('result')}  conf={detection['ai_conf']:.2f}  "
            f"dual_cam={detection['dual_cam']}  latency={inference_ms}ms"
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

def start_listener():
    """
    Start the Firestore watch in the background (non-blocking).
    Returns the watch handle so the caller can unsubscribe later.
    Safe to call from api.py — does not block.
    """
    with _state_lock:
        service_state["listener_alive"] = True
    log.info("Gloop AI Listener — watching machines collection for status=ready")
    watch = db.collection("machines").on_snapshot(on_machines_snapshot)
    log.info("Listener active.")
    return watch


def main():
    watch = start_listener()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down…")
        with _state_lock:
            service_state["listener_alive"] = False
        watch.unsubscribe()


if __name__ == "__main__":
    main()
