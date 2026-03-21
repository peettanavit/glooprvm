"""
Gloop RVM — Local AI Detection Server
--------------------------------------
Replaces the Firebase Cloud Function / Gemini AI with a local YOLO-based server.
Tunneled to the ESP32 via ngrok.

Supported request formats (both work — ESP32 needs only a URL change):
  1. multipart/form-data  — fields: image (file), machine_id, [user_id], [session_id]
  2. raw JPEG body        — headers: Content-Type: image/jpeg, X-Machine-Id, [X-User-Id], [X-Session-Id]

Both accept X-Api-Key header (or api_key form field) for authentication.
"""

import os
import cv2
import numpy as np
from flask import Flask, request, jsonify
from ultralytics import YOLO
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# ── Model loading (once at startup) ─────────────────────────────────────────
_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
print("[Server] Loading YOLO models...")
label_model = YOLO(os.path.join(_MODEL_DIR, "label_model.pt"))
cap_model   = YOLO(os.path.join(_MODEL_DIR, "cap_model.pt"))
print("[Server] Models loaded.")

# ── Firebase Admin init ──────────────────────────────────────────────────────
_sa_path = os.environ["FIREBASE_SERVICE_ACCOUNT"]
cred = credentials.Certificate(_sa_path)
firebase_admin.initialize_app(cred)
db = firestore.client()

# ── Config ───────────────────────────────────────────────────────────────────
API_KEY   = os.environ.get("UPLOAD_API_KEY", "")
MAX_BYTES = 2 * 1024 * 1024  # 2 MB


# ─────────────────────────────────────────────────────────────────────────────
# Detection logic
# ─────────────────────────────────────────────────────────────────────────────

def detect_bottle(img_bytes: bytes) -> dict:
    """
    Run label_model and cap_model on the same image.

    Result logic:
      "Brand"    → label detected  + cap detected  → valid (PROCESSING)
      "No Label" → no label        + cap detected  → valid (still recyclable)
      "Mismatch" → label detected  + no cap        → invalid (cap missing / suspicious)
      "No Label" → nothing detected               → invalid

    Adjust BOTTLE_CLASSES and CAP_CLASSES to match your actual .pt model outputs.
    Check model class names with:  print(label_model.names)  /  print(cap_model.names)
    """
    # Decode image from bytes — no disk write
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return {
            "valid": False, "label": "decode_error",
            "bottle_type": "unknown", "label_name": "error", "cap_name": "error",
        }

    # ── Preprocessing — CLAHE + sharpening (helps low-contrast labels) ───────
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    l_ch = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l_ch)
    enhanced = cv2.cvtColor(cv2.merge([l_ch, a_ch, b_ch]), cv2.COLOR_LAB2BGR)
    sharpen  = np.array([[0, -0.5, 0], [-0.5, 3, -0.5], [0, -0.5, 0]])
    proc     = cv2.filter2D(enhanced, -1, sharpen)

    def _best_detection(results, model_names):
        """Return (name, conf) for highest-conf detection above its class threshold."""
        best_name, best_conf = "no_detection", 0.0
        if len(results.boxes) == 0:
            print(f"  [DEBUG] No detections")
            return best_name, best_conf
        for box in sorted(results.boxes, key=lambda b: float(b.conf[0]), reverse=True):
            cls_id = int(box.cls[0].item())
            name   = model_names[cls_id]
            conf   = float(box.conf[0].item())
            thr    = CONF_THRESHOLDS.get(name, CONF_THRESHOLDS["default"])
            status = "PASS" if conf >= thr else f"FAIL(thr={thr:.0%})"
            print(f"  [DEBUG]   {name}: {conf:.3f} [{status}]")
            if conf >= thr and conf > best_conf:
                best_conf = conf
                best_name = name
        return best_name, best_conf

    # ── Run label model ──────────────────────────────────────────────────────
    print(f"[YOLO] label model raw detections:")
    label_results = label_model(proc, verbose=False)[0]
    label_name, label_conf = _best_detection(label_results, label_model.names)

    # ── Run cap model ────────────────────────────────────────────────────────
    print(f"[YOLO] cap model raw detections:")
    cap_results = cap_model(proc, verbose=False)[0]
    cap_name, cap_conf = _best_detection(cap_results, cap_model.names)

    print(f"[YOLO] final → label={label_name}({label_conf:.2f})  cap={cap_name}({cap_conf:.2f})")

    # ── Classify result ──────────────────────────────────────────────────────
    # Update these sets to match your model's actual class names.
    # Run: print(label_model.names) and print(cap_model.names) to check.
    BOTTLE_CLASSES = {"cvitt", "ginseng", "lipo", "m150", "msport", "peptein", "shark"}
    CAP_CLASSES    = {"cvitt_cap", "ginseng_cap", "lipo_cap", "m-sport_cap", "m150_cap", "peptein_cap", "shark_cap"}
    CONF_THRESHOLDS = {"m150": 0.25, "m150_cap": 0.25, "default": 0.45}

    has_label = label_name in BOTTLE_CLASSES
    has_cap   = cap_name   in CAP_CLASSES

    if has_label and has_cap:
        result      = "Brand"
        valid       = True
        bottle_type = label_name
    elif not has_label and has_cap:
        result      = "No Label"   # cap visible but label unreadable — still recyclable
        valid       = True
        bottle_type = "unlabeled_bottle"
    elif has_label and not has_cap:
        result      = "Mismatch"   # label present but cap missing — reject
        valid       = False
        bottle_type = "mismatch"
    else:
        result      = "No Label"   # nothing detected
        valid       = False
        bottle_type = "unknown"

    return {
        "valid":       valid,
        "label":       result,
        "bottle_type": bottle_type,
        "label_name":  label_name,
        "cap_name":    cap_name,
    }


# ─────────────────────────────────────────────────────────────────────────────
# /detect endpoint
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/detect")
def detect():
    # ── Auth ─────────────────────────────────────────────────────────────────
    if API_KEY:
        provided = (
            request.headers.get("X-Api-Key")
            or request.form.get("api_key", "")
        )
        if provided != API_KEY:
            return jsonify({"error": "Unauthorized"}), 401

    # ── machine_id ───────────────────────────────────────────────────────────
    machine_id = (
        request.form.get("machine_id")
        or request.headers.get("X-Machine-Id")
    )
    if not machine_id:
        return jsonify({"error": "Missing machine_id"}), 400

    # ── Optional session info ─────────────────────────────────────────────────
    user_id    = request.form.get("user_id")    or request.headers.get("X-User-Id",    "")
    session_id = request.form.get("session_id") or request.headers.get("X-Session-Id", "unknown")

    # ── Image: multipart file OR raw JPEG body ────────────────────────────────
    if "image" in request.files:
        img_bytes = request.files["image"].read()
    elif request.content_type and request.content_type.startswith("image/"):
        img_bytes = request.get_data()
    else:
        return jsonify({"error": "No image provided (send as multipart 'image' field or raw JPEG body)"}), 400

    if not img_bytes:
        return jsonify({"error": "Empty image"}), 400
    if len(img_bytes) > MAX_BYTES:
        return jsonify({"error": f"Image too large (max {MAX_BYTES // 1024 // 1024} MB)"}), 413

    # ── Validate machine exists ───────────────────────────────────────────────
    machine_ref  = db.collection("machines").document(machine_id)
    machine_snap = machine_ref.get()
    if not machine_snap.exists:
        return jsonify({"error": "Unknown machine"}), 404

    # Fill in user_id / session_id from the live machine doc if not provided
    if not user_id or session_id == "unknown":
        machine_data = machine_snap.to_dict() or {}
        user_id    = user_id    or machine_data.get("current_user", "")
        session_id = session_id if session_id != "unknown" else machine_data.get("session_id", "unknown")

    # ── Run detection ─────────────────────────────────────────────────────────
    try:
        detection  = detect_bottle(img_bytes)
        is_valid   = detection["valid"]
        new_status = "PROCESSING" if is_valid else "REJECTED"

        # ── Update machine document ───────────────────────────────────────────
        machine_ref.update({
            "status": new_status,
            "last_capture": {
                "valid":      is_valid,
                "label":      detection["label"],
                "label_name": detection["label_name"],
                "cap_name":   detection["cap_name"],
                "captured_at": firestore.SERVER_TIMESTAMP,
            },
            # session_score is incremented by the ESP32 slot sensor (SLOT_PIN_SMALL)
            # when the bottle physically drops through — do not increment here.
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        # ── Write log entry (valid bottles only) ─────────────────────────────
        if is_valid:
            db.collection("logs").add({
                "machine_id":  machine_id,
                "bottle_type": detection["bottle_type"],
                "user_id":     user_id,
                "session_id":  session_id,
                "sorted_at":   firestore.SERVER_TIMESTAMP,
            })

        print(f"[Firestore] machine={machine_id}  status={new_status}  label={detection['label']}")

        return jsonify({
            "status":      new_status,
            "valid":       is_valid,
            "label":       detection["label"],
            "bottle_type": detection["bottle_type"],
        }), 200

    except Exception as err:
        print(f"[detect] error: {err}")
        # Fallback: don't block the user
        try:
            machine_ref.update({
                "status":    "PROCESSING",
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass
        return jsonify({"error": str(err), "status": "PROCESSING"}), 500


# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return jsonify({"ok": True}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[Server] Starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
