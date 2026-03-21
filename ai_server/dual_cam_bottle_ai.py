import sys
import cv2
import numpy as np
from ultralytics import YOLO

# LOAD MODELS
label_model = YOLO("models/label_model.pt")
cap_model   = YOLO("models/cap_model.pt")

# DETECT LABEL
def detect_label(frame):
    results = label_model(frame)
    for r in results:
        for box in r.boxes:
            cls  = int(box.cls[0])
            name = label_model.names[cls]
            conf = float(box.conf[0])
            x1,y1,x2,y2 = map(int, box.xyxy[0])
            return name, conf, (x1,y1,x2,y2)
    return "No Label", 0.0, None

# DETECT CAP
def detect_cap(frame):
    results = cap_model(frame)
    for r in results:
        for box in r.boxes:
            cls  = int(box.cls[0])
            name = cap_model.names[cls]
            conf = float(box.conf[0])
            x1,y1,x2,y2 = map(int, box.xyxy[0])
            return name, conf, (x1,y1,x2,y2)
    return "Unknown Cap", 0.0, None

def draw_box(frame, box, label, color):
    if box is not None:
        x1,y1,x2,y2 = box
        cv2.rectangle(frame, (x1,y1), (x2,y2), color, 2)
        cv2.putText(frame, label, (x1, y1-10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

LABEL_BRANDS = {"cvitt", "ginseng", "lipo", "m150", "msport", "peptein", "shark"}
CAP_BRANDS   = {"cvitt_cap", "ginseng_cap", "lipo_cap", "m-sport_cap", "m150_cap", "peptein_cap", "shark_cap"}

def decide(label_name, cap_name):
    has_label = label_name in LABEL_BRANDS
    has_cap   = cap_name in CAP_BRANDS
    if has_label and has_cap:
        return f"BRAND: {label_name}"
    elif not has_label and has_cap:
        return "No Label (has cap)"
    elif has_label and not has_cap:
        return "WARNING: LABEL/CAP MISMATCH"
    else:
        return "ALERT: NOTHING DETECTED"

# ── IMAGE MODE (python dual_cam_bottle_ai.py label.jpg cap.jpg) ───────────────
if len(sys.argv) == 3:
    label_path, cap_path = sys.argv[1], sys.argv[2]
    frame1 = cv2.imread(label_path)
    frame2 = cv2.imread(cap_path)
    if frame1 is None:
        print(f"[ERROR] Cannot read label image: {label_path}"); sys.exit(1)
    if frame2 is None:
        print(f"[ERROR] Cannot read cap image: {cap_path}"); sys.exit(1)

    label_name, label_conf, label_box = detect_label(frame1)
    cap_name,   cap_conf,   cap_box   = detect_cap(frame2)
    result = decide(label_name, cap_name)

    print(f"Label : {label_name} ({label_conf:.2f})")
    print(f"Cap   : {cap_name}   ({cap_conf:.2f})")
    print(f"Result: {result}")

    draw_box(frame1, label_box, f"Label: {label_name} {label_conf:.2f}", (0,255,0))
    draw_box(frame2, cap_box,   f"Cap: {cap_name} {cap_conf:.2f}",       (255,0,0))
    cv2.putText(frame1, result, (30,40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 3)

    cv2.imshow("CAM1 - LABEL", frame1)
    cv2.imshow("CAM2 - CAP",   frame2)
    print("Press any key to close.")
    cv2.waitKey(0)
    cv2.destroyAllWindows()

# ── SINGLE-IMAGE MODE (python dual_cam_bottle_ai.py image.jpg) ────────────────
elif len(sys.argv) == 2:
    img_path = sys.argv[1]
    frame = cv2.imread(img_path)
    if frame is None:
        print(f"[ERROR] Cannot read image: {img_path}"); sys.exit(1)

    label_name, label_conf, label_box = detect_label(frame)
    cap_name,   cap_conf,   cap_box   = detect_cap(frame)
    result = decide(label_name, cap_name)

    print(f"Label : {label_name} ({label_conf:.2f})")
    print(f"Cap   : {cap_name}   ({cap_conf:.2f})")
    print(f"Result: {result}")

    display = frame.copy()
    draw_box(display, label_box, f"Label: {label_name} {label_conf:.2f}", (0,255,0))
    draw_box(display, cap_box,   f"Cap: {cap_name} {cap_conf:.2f}",       (255,0,0))
    cv2.putText(display, result, (30,40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 3)
    cv2.imshow("Test Image", display)
    print("Press any key to close.")
    cv2.waitKey(0)
    cv2.destroyAllWindows()

# ── LIVE CAMERA MODE (no args) ────────────────────────────────────────────────
else:
    cam_label = cv2.VideoCapture(0)
    cam_cap   = cv2.VideoCapture(1)
    while True:
        ret1, frame1 = cam_label.read()
        ret2, frame2 = cam_cap.read()
        if not ret1 or not ret2:
            break

        label_name, label_conf, label_box = detect_label(frame1)
        cap_name,   cap_conf,   cap_box   = detect_cap(frame2)
        result = decide(label_name, cap_name)

        draw_box(frame1, label_box, f"Label: {label_name} {label_conf:.2f}", (0,255,0))
        draw_box(frame2, cap_box,   f"Cap: {cap_name} {cap_conf:.2f}",       (255,0,0))
        cv2.putText(frame1, result, (30,40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 3)
        cv2.imshow("CAM1 - LABEL", frame1)
        cv2.imshow("CAM2 - CAP",   frame2)
        if cv2.waitKey(1) == 27:
            break

    cam_label.release()
    cam_cap.release()
    cv2.destroyAllWindows()
