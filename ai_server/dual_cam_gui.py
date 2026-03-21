"""
Gloop RVM — Dual Camera AI Tester (GUI)
----------------------------------------
Manual image tester for label_model.pt and cap_model.pt.
Select a label image and a cap image, then click RUN AI to see detections.
"""

import os
import tkinter as tk
from tkinter import filedialog, messagebox
import cv2
import numpy as np
from PIL import Image, ImageTk
from ultralytics import YOLO

# ── Brand veto mapping (label class → expected cap class) ────────────────────
BRAND_TO_CAP = {
    "cvitt":   "cvitt_cap",
    "ginseng": "ginseng_cap",
    "lipo":    "lipo_cap",
    "m150":    "m150_cap",
    "msport":  "m-sport_cap",
    "peptein": "peptein_cap",
    "shark":   "shark_cap",
}
LABEL_BRANDS = set(BRAND_TO_CAP.keys())
CAP_BRANDS   = set(BRAND_TO_CAP.values())

# ── Per-class confidence thresholds ──────────────────────────────────────────
# Lower = more sensitive (more detections, more false positives).
# Raise other classes first before lowering m150 further.
CONF_THRESHOLDS = {
    "m150":       0.25,   # M-150 label has low contrast — relaxed threshold
    "m150_cap":   0.25,   # same for its cap
    "default":    0.45,   # all other classes
}

# Image preview size (pixels) — small enough for 1366×768 laptops
PREV_W, PREV_H = 370, 260

# ── Colours ───────────────────────────────────────────────────────────────────
BG       = "#1e1e2e"
PANEL_BG = "#2a2a3e"
BORDER   = "#3b3b5c"
BTN_BG   = "#7c3aed"
BTN_HOV  = "#6d28d9"
RUN_BG   = "#059669"
RUN_HOV  = "#047857"
FG_TITLE = "#e2e8f0"
FG_DIM   = "#64748b"
FG_INFO  = "#94a3b8"
CANVAS_BG= "#12121f"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_models():
    try:
        lm = YOLO("models/label_model.pt")
        cm = YOLO("models/cap_model.pt")
        return lm, cm
    except Exception as e:
        messagebox.showerror("Model Load Error", str(e))
        return None, None


def preprocess(img_bgr):
    """CLAHE contrast enhancement (LAB L-channel) + mild sharpening.
    Helps with low-contrast labels like M-150 under varied lighting."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    sharpen = np.array([[ 0, -0.5,  0],
                        [-0.5,  3, -0.5],
                        [ 0, -0.5,  0]])
    return cv2.filter2D(enhanced, -1, sharpen)


def run_model(model, img_bgr, tag="model"):
    """Preprocess → infer → apply per-class thresholds → debug-print all scores.

    Returns (class_name, confidence, box) for the best passing detection,
    or (None, 0.0, None) if nothing clears its threshold.
    """
    processed = preprocess(img_bgr)
    results = model(processed, verbose=False)[0]

    # ── Debug: print every raw detection ─────────────────────────────────────
    if len(results.boxes) == 0:
        print(f"[DEBUG:{tag}] No detections at all")
    else:
        print(f"[DEBUG:{tag}] {len(results.boxes)} raw detection(s):")
        for box in sorted(results.boxes, key=lambda b: float(b.conf[0]), reverse=True):
            cls_id = int(box.cls[0].item())
            name   = results.names[cls_id]
            conf   = float(box.conf[0].item())
            thr    = CONF_THRESHOLDS.get(name, CONF_THRESHOLDS["default"])
            status = "PASS" if conf >= thr else f"FAIL (thr={thr:.0%})"
            print(f"  {name}: {conf:.3f} ({conf:.0%})  [{status}]")

    # ── Select best detection that meets its class threshold ──────────────────
    best_name, best_conf, best_box = None, 0.0, None
    for box in results.boxes:
        cls_id = int(box.cls[0].item())
        name   = results.names[cls_id]
        conf   = float(box.conf[0].item())
        thr    = CONF_THRESHOLDS.get(name, CONF_THRESHOLDS["default"])
        if conf >= thr and conf > best_conf:
            best_conf = conf
            best_name = name
            best_box  = tuple(map(int, box.xyxy[0].tolist()))

    return best_name, best_conf, best_box


def draw_detection(img_bgr, name, conf, box, color):
    out = img_bgr.copy()
    if box:
        x1, y1, x2, y2 = box
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        tag = f"{name}  {conf:.0%}"
        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(out, (x1, y1 - th - 8), (x1 + tw + 6, y1), color, -1)
        cv2.putText(out, tag, (x1 + 3, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    return out


def letterbox_photoimage(img_bgr, max_w, max_h):
    """Scale img_bgr to fit (max_w × max_h), keep aspect ratio, return PhotoImage."""
    h, w = img_bgr.shape[:2]
    scale = min(max_w / w, max_h / h)
    new_w, new_h = int(w * scale), int(h * scale)
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb).resize((new_w, new_h), Image.LANCZOS)
    # Paste onto a solid background so the canvas stays the same size
    bg = Image.new("RGB", (max_w, max_h), (18, 18, 31))
    offset = ((max_w - new_w) // 2, (max_h - new_h) // 2)
    bg.paste(pil, offset)
    return ImageTk.PhotoImage(bg)


def veto(label_name, cap_name):
    has_label = label_name in LABEL_BRANDS
    has_cap   = cap_name   in CAP_BRANDS
    if not has_label and not has_cap:
        return "REJECT", "Nothing detected in either image"
    if not has_label:
        return "REJECT", f"No label brand detected  (cap: {cap_name})"
    if not has_cap:
        return "REJECT", f"No cap detected  (label: {label_name})"
    expected = BRAND_TO_CAP[label_name]
    if cap_name == expected:
        return "MATCH", f"{label_name}  ↔  {cap_name}"
    return "REJECT", f"Brand mismatch — label: {label_name},  cap: {cap_name}"


# ─────────────────────────────────────────────────────────────────────────────
# Main application
# ─────────────────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Gloop RVM — AI Tester")
        self.configure(bg=BG)
        self.resizable(True, True)
        self.minsize(820, 580)

        # Centre on screen
        self.update_idletasks()
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
        ww, wh = 880, 640
        self.geometry(f"{ww}x{wh}+{(sw-ww)//2}+{(sh-wh)//2}")

        self._label_img = None
        self._cap_img   = None
        self._photos    = {}      # {key: PhotoImage} — keep refs alive
        self._status    = tk.StringVar(value="Loading models…")

        self._build_ui()
        self.after(150, self._init_models)

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Title row ─────────────────────────────────────────────────────────
        tk.Label(self, text="Gloop RVM — AI Tester",
                 font=("Segoe UI", 15, "bold"),
                 bg=BG, fg=FG_TITLE).pack(pady=(10, 6))

        # ── Image panels (side by side) ────────────────────────────────────────
        mid = tk.Frame(self, bg=BG)
        mid.pack(fill="both", expand=True, padx=12, pady=2)
        mid.columnconfigure(0, weight=1)
        mid.columnconfigure(1, weight=1)
        mid.rowconfigure(0, weight=1)

        self._lp = self._make_panel(mid, "Label Image  (Master)", self._pick_label)
        self._lp.grid(row=0, column=0, padx=(0, 6), sticky="nsew")

        self._cp = self._make_panel(mid, "Cap Image  (Slave)", self._pick_cap)
        self._cp.grid(row=0, column=1, padx=(6, 0), sticky="nsew")

        # ── Bottom bar (always visible) ────────────────────────────────────────
        bottom = tk.Frame(self, bg=BG)
        bottom.pack(fill="x", padx=12, pady=(6, 0))

        # RUN AI
        self._run_btn = tk.Button(
            bottom, text="▶   RUN AI",
            font=("Segoe UI", 12, "bold"),
            bg=RUN_BG, fg="#fff", activebackground=RUN_HOV, activeforeground="#fff",
            relief="flat", padx=28, pady=7,
            cursor="hand2", state="disabled", command=self._run_ai)
        self._run_btn.pack(pady=(4, 2))

        # Verdict
        self._verdict_var = tk.StringVar(value="")
        self._verdict_lbl = tk.Label(
            bottom, textvariable=self._verdict_var,
            font=("Segoe UI", 20, "bold"), bg=BG, fg=FG_INFO)
        self._verdict_lbl.pack()

        self._detail_var = tk.StringVar(value="")
        tk.Label(bottom, textvariable=self._detail_var,
                 font=("Segoe UI", 9), bg=BG, fg=FG_DIM).pack(pady=(0, 4))

        # Status bar
        tk.Label(self, textvariable=self._status,
                 font=("Segoe UI", 8), bg=BG, fg="#475569",
                 anchor="w").pack(fill="x", padx=12, pady=(2, 8))

    def _make_panel(self, parent, title, pick_cmd):
        """Return a labelled frame with canvas + info + select button."""
        frame = tk.Frame(parent, bg=PANEL_BG,
                         highlightbackground=BORDER, highlightthickness=1)
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(1, weight=1)   # canvas row expands

        tk.Label(frame, text=title, font=("Segoe UI", 10, "bold"),
                 bg=PANEL_BG, fg=FG_TITLE).grid(row=0, column=0, pady=(8, 4))

        # Canvas for image display (pixel units)
        canvas = tk.Canvas(frame, width=PREV_W, height=PREV_H,
                           bg=CANVAS_BG, highlightthickness=0)
        canvas.grid(row=1, column=0, padx=8, sticky="nsew")
        # Placeholder text centred in canvas
        canvas.create_text(PREV_W//2, PREV_H//2,
                           text="No image selected", fill="#475569",
                           font=("Segoe UI", 10), tags="placeholder")

        info = tk.Label(frame, text="—", font=("Segoe UI", 9),
                        bg=PANEL_BG, fg=FG_DIM)
        info.grid(row=2, column=0, pady=(3, 2))

        btn = tk.Button(frame, text="Select Image…",
                        font=("Segoe UI", 9, "bold"),
                        bg=BTN_BG, fg="#fff",
                        activebackground=BTN_HOV, activeforeground="#fff",
                        relief="flat", padx=10, pady=5,
                        cursor="hand2", command=pick_cmd)
        btn.grid(row=3, column=0, pady=(2, 10))

        frame._canvas = canvas
        frame._info   = info
        return frame

    # ── Model init ────────────────────────────────────────────────────────────
    def _init_models(self):
        self.label_model, self.cap_model = load_models()
        if self.label_model and self.cap_model:
            self._status.set("Models loaded — select both images and click RUN AI")
        else:
            self._status.set("Model load failed — check models/ folder")
        self._update_run_btn()

    def _update_run_btn(self):
        ready = (self._label_img is not None and
                 self._cap_img is not None and
                 getattr(self, "label_model", None) is not None)
        self._run_btn.config(state="normal" if ready else "disabled")

    # ── Image selection ───────────────────────────────────────────────────────
    def _pick_label(self):
        img, path = self._open_image("Select Label Image")
        if img is None:
            return
        self._label_img = img
        self._display(self._lp, img, path, "label_raw")
        self._clear_verdict()
        self._update_run_btn()

    def _pick_cap(self):
        img, path = self._open_image("Select Cap Image")
        if img is None:
            return
        self._cap_img = img
        self._display(self._cp, img, path, "cap_raw")
        self._clear_verdict()
        self._update_run_btn()

    def _open_image(self, title):
        path = filedialog.askopenfilename(
            title=title,
            filetypes=[("Images", "*.jpg *.jpeg *.png *.bmp *.webp"), ("All", "*.*")])
        if not path:
            return None, None
        img = cv2.imread(path)
        if img is None:
            messagebox.showerror("Error", f"Cannot read image:\n{path}")
            return None, None
        return img, path

    def _display(self, panel, img_bgr, path, ref_key):
        """Render img_bgr letterboxed into the panel canvas."""
        photo = letterbox_photoimage(img_bgr, PREV_W, PREV_H)
        self._photos[ref_key] = photo          # keep alive
        c = panel._canvas
        c.delete("all")
        c.create_image(0, 0, anchor="nw", image=photo)
        fname = os.path.basename(path) if path else ""
        panel._info.config(text=fname)

    # ── Inference ─────────────────────────────────────────────────────────────
    def _run_ai(self):
        if self._label_img is None or self._cap_img is None:
            return

        self._status.set("Running AI…")
        self._run_btn.config(state="disabled")
        self.update_idletasks()

        try:
            lname, lconf, lbox = run_model(self.label_model, self._label_img, tag="label")
            cname, cconf, cbox = run_model(self.cap_model,   self._cap_img,   tag="cap")

            lname = lname or "no_label"
            cname = cname or "no_cap"

            # Annotated images
            ann_label = draw_detection(self._label_img, lname, lconf, lbox, (0, 200, 80))
            ann_cap   = draw_detection(self._cap_img,   cname, cconf, cbox, (200, 80, 0))

            self._display(self._lp, ann_label, "", "label_ann")
            self._display(self._cp, ann_cap,   "", "cap_ann")

            self._lp._info.config(
                text=f"{lname}  ({lconf:.0%})" if lbox else f"{lname}  (no box)")
            self._cp._info.config(
                text=f"{cname}  ({cconf:.0%})" if cbox else f"{cname}  (no box)")

            verdict, detail = veto(lname, cname)
            color = "#10b981" if verdict == "MATCH" else "#ef4444"
            self._verdict_var.set(verdict)
            self._verdict_lbl.config(fg=color)
            self._detail_var.set(detail)

            self._status.set(
                f"Done — label: {lname} ({lconf:.0%})   cap: {cname} ({cconf:.0%})")

        except Exception as e:
            messagebox.showerror("Inference Error", str(e))
            self._status.set("Error during inference")

        finally:
            self._run_btn.config(state="normal")

    def _clear_verdict(self):
        self._verdict_var.set("")
        self._detail_var.set("")
        self._verdict_lbl.config(fg=FG_INFO)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    App().mainloop()
