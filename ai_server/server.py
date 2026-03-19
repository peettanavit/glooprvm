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

    # ── Run label model ──────────────────────────────────────────────────────
    label_results = label_model(img, verbose=False)[0]
    if len(label_results.boxes) > 0:
        top_idx  = int(label_results.boxes.conf.argmax().item())
        label_name = label_results.names[int(label_results.boxes.cls[top_idx].item())]
        label_conf = float(label_results.boxes.conf[top_idx].item())
    else:
        label_name = "no_label"
        label_conf = 0.0

    # ── Run cap model ────────────────────────────────────────────────────────
    cap_results = cap_model(img, verbose=False)[0]
    if len(cap_results.boxes) > 0:
        top_idx  = int(cap_results.boxes.conf.argmax().item())
        cap_name = cap_results.names[int(cap_results.boxes.cls[top_idx].item())]
        cap_conf = float(cap_results.boxes.conf[top_idx].item())
    else:
        cap_name = "no_cap"
        cap_conf = 0.0

    print(f"[YOLO] label={label_name}({label_conf:.2f})  cap={cap_name}({cap_conf:.2f})")

    # ── Classify result ──────────────────────────────────────────────────────
    # Update these sets to match your model's actual class names.
    # Run: print(label_model.names) and print(cap_model.names) to check.
    BOTTLE_CLASSES = {"plastic_bottle", "bottle", "pet_bottle", "water_bottle"}
    CAP_CLASSES    = {"cap", "bottle_cap", "with_cap", "closed"}

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
