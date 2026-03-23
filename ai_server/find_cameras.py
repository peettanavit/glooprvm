import cv2

try:
    from pygrabber.dshow_graph import FilterGraph
    devices = FilterGraph().get_input_devices()
except Exception:
    devices = []

print("=== DSHOW ===")
for i in range(10):
    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
    if cap.isOpened():
        name = devices[i] if i < len(devices) else "unknown"
        print(f"  index {i}: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}  [{name}]")
        cap.release()

print("\n=== MSMF ===")
for i in range(10):
    cap = cv2.VideoCapture(i, cv2.CAP_MSMF)
    if cap.isOpened():
        name = devices[i] if i < len(devices) else "unknown"
        print(f"  index {i}: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}  [{name}]")
        cap.release()
