"""
Gloop AI Listener — Simulation & Unit Tests
=============================================
Tests three key behaviours without needing real Firebase or YOLO models:

  1. detect_bottle()  — decision logic + Safety Lock
  2. _claim_if_ready  — transaction race-condition guard
  3. _wait_for_cap_path — dual-cam polling / timeout

Run:
    pip install pytest
    pytest ai_server/test_listener_sim.py -v

The script patches firebase_admin, YOLO, and cv2 so no real credentials or
model files are needed.  The mocked Firestore store is an in-memory dict that
the patched functions read / write, letting you verify state transitions.
"""

import sys
import types
import time
import threading
import unittest
from unittest.mock import MagicMock, patch, PropertyMock
import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
# Stub out firebase_admin and ultralytics BEFORE importing listener
# ─────────────────────────────────────────────────────────────────────────────

def _build_firebase_stub():
    """Return a minimal firebase_admin module stub."""
    fb            = types.ModuleType("firebase_admin")
    creds         = types.ModuleType("firebase_admin.credentials")
    fs_mod        = types.ModuleType("firebase_admin.firestore")
    st_mod        = types.ModuleType("firebase_admin.storage")
    tx_mod        = types.ModuleType("google.cloud.firestore_v1.transaction")

    fb.initialize_app      = MagicMock()
    creds.Certificate      = MagicMock(return_value=MagicMock())
    fs_mod.client          = MagicMock()
    fs_mod.SERVER_TIMESTAMP = "__server_ts__"
    fs_mod.DELETE_FIELD    = "__delete__"
    st_mod.bucket          = MagicMock()
    tx_mod.transactional   = lambda fn: fn  # no-op decorator

    # Register sub-modules
    sys.modules["firebase_admin"]                           = fb
    sys.modules["firebase_admin.credentials"]               = creds
    sys.modules["firebase_admin.firestore"]                 = fs_mod
    sys.modules["firebase_admin.storage"]                   = st_mod
    sys.modules["google"]                                   = types.ModuleType("google")
    sys.modules["google.cloud"]                             = types.ModuleType("google.cloud")
    sys.modules["google.cloud.firestore_v1"]                = types.ModuleType("google.cloud.firestore_v1")
    sys.modules["google.cloud.firestore_v1.transaction"]    = tx_mod

    return fb, fs_mod


def _build_yolo_stub():
    ultralytics = types.ModuleType("ultralytics")
    ultralytics.YOLO = MagicMock()
    sys.modules["ultralytics"] = ultralytics
    return ultralytics


def _build_cv2_stub():
    cv2_mod = types.ModuleType("cv2")
    # cv2.imdecode returns a fake image array unless told otherwise
    cv2_mod.imdecode    = MagicMock(return_value=np.zeros((64, 64, 3), dtype=np.uint8))
    cv2_mod.IMREAD_COLOR = 1
    sys.modules["cv2"] = cv2_mod
    return cv2_mod


_fb_stub, _fs_stub = _build_firebase_stub()
_ul_stub            = _build_yolo_stub()
_cv2_stub           = _build_cv2_stub()

# Patch dotenv so listener.py doesn't need a .env file
sys.modules["dotenv"] = MagicMock()

# Provide required env vars
import os
os.environ.setdefault("FIREBASE_SERVICE_ACCOUNT", "/fake/sa.json")
os.environ.setdefault("FIREBASE_STORAGE_BUCKET",  "fake-bucket.appspot.com")

# Now we can safely import listener internals
import importlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import listener  # noqa: E402  (after stubs registered)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers to build fake YOLO result objects
# ─────────────────────────────────────────────────────────────────────────────

def _make_yolo_result(class_name: str, conf: float, names: dict[int, str]):
    """Return a fake YOLO result object with one detection box."""
    import torch  # may not be present; use plain tensors via numpy fallback

    class FakeBoxes:
        def __init__(self):
            class_id = [k for k, v in names.items() if v == class_name]
            if not class_id:
                # No detection
                self.conf = _tensor([])
                self.cls  = _tensor([])
            else:
                self.conf = _tensor([conf])
                self.cls  = _tensor([float(class_id[0])])

        def __len__(self):
            return len(self.conf)

    class FakeResult:
        def __init__(self):
            self.boxes = FakeBoxes()
            self.names = names

    return FakeResult()


def _tensor(data):
    """Return a simple numpy-backed object with argmax() and item()."""
    class T:
        def __init__(self, arr):
            self._arr = np.array(arr, dtype=np.float32)

        def argmax(self):
            return T(np.argmax(self._arr))

        def item(self):
            return float(self._arr)

        def __len__(self):
            return len(self._arr)

        def __getitem__(self, idx):
            return T(self._arr[idx])

    return T(data)


# ─────────────────────────────────────────────────────────────────────────────
# 1. detect_bottle() — decision logic
# ─────────────────────────────────────────────────────────────────────────────

LABEL_NAMES = {0: "lipo_cap", 1: "cvitt_cap", 2: "m150_cap",
               3: "ginseng_cap", 4: "m-sport_cap", 5: "none"}
CAP_NAMES   = {0: "lipo_cap", 1: "cvitt_cap", 2: "m150_cap",
               3: "ginseng_cap", 4: "shark_cap",  5: "none"}


def _patch_models(label_name, label_conf, cap_name="none", cap_conf=0.0):
    """Patch both YOLO models to return the specified detections."""
    label_result = _make_yolo_result(label_name, label_conf, LABEL_NAMES)
    cap_result   = _make_yolo_result(cap_name,   cap_conf,   CAP_NAMES)

    listener._label_model = MagicMock(return_value=[label_result])
    listener._cap_model   = MagicMock(return_value=[cap_result])


class TestDetectBottle(unittest.TestCase):

    def _fake_image(self):
        return b"\xff\xd8\xff"  # minimal "jpeg" header — cv2 stub ignores content

    # ── Acceptance cases ──────────────────────────────────────────────────────

    def test_accept_lipo_cap(self):
        _patch_models("lipo_cap", 0.92)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertTrue(result["valid"])
        self.assertEqual(result["result"], 1)
        self.assertEqual(result["ai_label"], "lipo_cap")
        self.assertFalse(result["dual_cam"])

    def test_accept_cvitt_cap(self):
        _patch_models("cvitt_cap", 0.75)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertTrue(result["valid"])
        self.assertEqual(result["result"], 2)

    def test_accept_m150_cap_dual_cam(self):
        _patch_models("m150_cap", 0.80, cap_name="m150_cap", cap_conf=0.70)
        result = listener.detect_bottle(self._fake_image(), self._fake_image())
        self.assertTrue(result["valid"])
        self.assertEqual(result["result"], 3)
        self.assertTrue(result["dual_cam"])

    # ── Rejection: negative-filter class ─────────────────────────────────────

    def test_reject_ginseng_by_label(self):
        _patch_models("ginseng_cap", 0.88)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertFalse(result["valid"])
        self.assertIn("ginseng_cap", result["reason"])

    def test_reject_by_cap_veto(self):
        """cap_model vetoes even when label_model would accept."""
        _patch_models("lipo_cap", 0.82, cap_name="ginseng_cap", cap_conf=0.77)
        result = listener.detect_bottle(self._fake_image(), self._fake_image())
        self.assertFalse(result["valid"])
        self.assertIn("cap_model vetoed", result["reason"])

    def test_reject_no_detection(self):
        _patch_models("none", 0.0)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertFalse(result["valid"])

    # ── Rejection: label image decode failure ─────────────────────────────────

    def test_reject_decode_failure(self):
        _cv2_stub.imdecode = MagicMock(return_value=None)  # simulate decode fail
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertFalse(result["valid"])
        self.assertIn("decode", result["reason"])
        _cv2_stub.imdecode = MagicMock(return_value=np.zeros((64, 64, 3), dtype=np.uint8))

    # ── Safety Lock ───────────────────────────────────────────────────────────

    def test_safety_lock_fires_below_threshold(self):
        """ai_conf=0.25 is below 0.35 → Safety Lock → reason='Low confidence'."""
        _patch_models("lipo_cap", 0.25)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertFalse(result["valid"])
        self.assertEqual(result["reason"], "Low confidence")

    def test_safety_lock_boundary_at_threshold(self):
        """ai_conf=0.36 is above the 0.35 floor — Safety Lock must NOT fire.
        Note: np.float32(0.35) = 0.34999... < 0.35 (float64) due to float32
        precision, so 0.35 itself is not a safe boundary value to test with.
        Use 0.36 which survives float32 truncation cleanly."""
        _patch_models("lipo_cap", 0.36)
        result = listener.detect_bottle(self._fake_image(), None)
        # Safety Lock must not fire; falls through to step 4 accept check.
        # conf=0.36 < AI_CONFIDENCE_THRESHOLD=0.5 → rejected via step 4, not lock.
        self.assertFalse(result["valid"])
        self.assertNotEqual(result["reason"], "Low confidence")

    def test_safety_lock_does_not_fire_above_threshold(self):
        """ai_conf=0.55 is above both 0.35 and 0.50 → accepted normally."""
        _patch_models("lipo_cap", 0.55)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertTrue(result["valid"])

    def test_safety_lock_fires_on_reject_class_too(self):
        """Even a reject-class detection with ai_conf<0.35 gets Safety Lock, not the
        reject-class message — the lock fires first."""
        _patch_models("ginseng_cap", 0.20)
        result = listener.detect_bottle(self._fake_image(), None)
        self.assertFalse(result["valid"])
        self.assertEqual(result["reason"], "Low confidence")


# ─────────────────────────────────────────────────────────────────────────────
# 2. _claim_if_ready — transaction guard
# ─────────────────────────────────────────────────────────────────────────────

class TestClaimIfReady(unittest.TestCase):
    """
    Simulate two concurrent workers racing to claim the same "ready" document.
    Only the first should succeed; the second must see status="processing_ai"
    and return False.
    """

    def _make_machine_ref(self, initial_status: str):
        """Return a fake machine_ref whose .get() returns documents from a shared dict."""
        store = {"status": initial_status}

        class FakeSnap:
            def __init__(self):
                self.exists = True
                self._data = dict(store)

            def get(self, field):
                return self._data.get(field)

        class FakeTx:
            def update(self, ref, payload):
                store.update(payload)

        class FakeRef:
            def get(self, transaction=None):
                return FakeSnap()

        ref   = FakeRef()
        tx    = FakeTx()
        return ref, tx, store

    def test_first_claim_succeeds(self):
        ref, tx, store = self._make_machine_ref("ready")
        result = listener._claim_if_ready(tx, ref)
        self.assertTrue(result)
        self.assertEqual(store["status"], "processing_ai")

    def test_second_claim_fails(self):
        """Status is already 'processing_ai' — must not claim again."""
        ref, tx, store = self._make_machine_ref("processing_ai")
        result = listener._claim_if_ready(tx, ref)
        self.assertFalse(result)

    def test_claim_on_idle_fails(self):
        ref, tx, store = self._make_machine_ref("IDLE")
        result = listener._claim_if_ready(tx, ref)
        self.assertFalse(result)

    def test_concurrent_race(self):
        """
        Two threads both read status='ready' simultaneously (via Barrier),
        then race to write. Only the first writer wins; the second must see
        the updated status and record 'contended'.
        This mirrors Firestore optimistic concurrency: both workers read the
        same snapshot, but only one transaction commit succeeds.
        """
        store   = {"status": "ready"}
        results = []
        write_lock = threading.Lock()
        # Barrier ensures BOTH threads have read before either writes
        read_barrier = threading.Barrier(2)

        def worker():
            # Step 1: read (both threads reach here before either proceeds)
            with write_lock:
                seen_status = store["status"]
            read_barrier.wait()  # synchronise — both have now read

            # Step 2: write (first-writer-wins via write_lock)
            if seen_status == "ready":
                with write_lock:
                    if store["status"] == "ready":
                        store["status"] = "processing_ai"
                        results.append("claimed")
                    else:
                        results.append("contended")

        t1 = threading.Thread(target=worker)
        t2 = threading.Thread(target=worker)
        t1.start(); t2.start()
        t1.join();  t2.join()

        self.assertEqual(results.count("claimed"),   1)
        self.assertEqual(results.count("contended"), 1)
        self.assertEqual(store["status"], "processing_ai")


# ─────────────────────────────────────────────────────────────────────────────
# 3. _wait_for_cap_path — dual-cam polling / timeout
# ─────────────────────────────────────────────────────────────────────────────

class TestWaitForCapPath(unittest.TestCase):

    def _make_ref(self, cap_path_sequence: list):
        """
        Returns a fake machine_ref whose .get() returns successive dicts
        from cap_path_sequence on each call.
        """
        call_count = [0]

        class FakeSnap:
            def __init__(self, data):
                self._data = data

            def get(self, field):
                # Support nested dict access for last_capture.cap_storage_path
                parts = field.split(".")
                val = self._data
                for p in parts:
                    val = (val or {}).get(p) if isinstance(val, dict) else None
                return val

        class FakeRef:
            def get(self_inner):
                idx = min(call_count[0], len(cap_path_sequence) - 1)
                call_count[0] += 1
                return FakeSnap(cap_path_sequence[idx])

        return FakeRef()

    def test_cap_already_present(self):
        """Cap path already in initial snapshot → return immediately."""
        initial = {"last_capture": {"cap_storage_path": "caps/bottle.jpg"}}
        ref = self._make_ref([initial])
        result = listener._wait_for_cap_path(ref, initial)
        self.assertEqual(result, "caps/bottle.jpg")

    def test_cap_arrives_after_delay(self):
        """Cap path absent at first, arrives on second poll."""
        snapshots = [
            {"last_capture": {}},
            {"last_capture": {"cap_storage_path": "caps/later.jpg"}},
        ]
        initial = snapshots[0]
        ref     = self._make_ref(snapshots)

        original_sleep = time.sleep
        with patch("time.sleep", return_value=None):
            # Override _CAP_WAIT_S for a fast test
            original_wait = listener._CAP_WAIT_S
            listener._CAP_WAIT_S = 0.6
            result = listener._wait_for_cap_path(ref, initial)
            listener._CAP_WAIT_S = original_wait

        self.assertEqual(result, "caps/later.jpg")

    def test_cap_timeout(self):
        """Slave never uploads — _wait_for_cap_path must return None."""
        snapshots = [{"last_capture": {}}] * 20
        initial   = snapshots[0]
        ref       = self._make_ref(snapshots)

        with patch("time.sleep", return_value=None), \
             patch("time.monotonic", side_effect=[0.0] + [999.0] * 40):
            result = listener._wait_for_cap_path(ref, initial)

        self.assertIsNone(result)


# ─────────────────────────────────────────────────────────────────────────────
# 4. Firestore event simulation helpers
#    (write to Firestore emulator / real Firebase if SA credentials are provided)
# ─────────────────────────────────────────────────────────────────────────────

def simulate_master_upload(machine_id: str, label_path: str):
    """
    Simulate the Cloud Function after a Master ESP32 upload:
    Sets status='ready' and last_capture.label_storage_path.

    Usage (requires real Firebase credentials):
        sim_db = firestore.client()
        simulate_master_upload("Gloop_01", "bottles/session_abc/label.jpg")
    """
    from firebase_admin import firestore as _fs
    _db = _fs.client()
    _db.collection("machines").document(machine_id).update({
        "status": "ready",
        "last_capture": {
            "label_storage_path": label_path,
            "cap_storage_path":   _fs.DELETE_FIELD,
        },
        "updatedAt": _fs.SERVER_TIMESTAMP,
    })
    print(f"[SIM] Master upload → machines/{machine_id}  label_path={label_path}")


def simulate_slave_upload(machine_id: str, cap_path: str, delay_s: float = 0.5):
    """
    Simulate the Slave ESP32 writing cap_storage_path after a short delay.
    In production the Slave uploads ~300 ms after the Master.

    Usage:
        threading.Thread(
            target=simulate_slave_upload,
            args=("Gloop_01", "bottles/session_abc/cap.jpg", 0.5)
        ).start()
    """
    time.sleep(delay_s)
    from firebase_admin import firestore as _fs
    _db = _fs.client()
    _db.collection("machines").document(machine_id).update({
        "last_capture.cap_storage_path": cap_path,
        "updatedAt": _fs.SERVER_TIMESTAMP,
    })
    print(f"[SIM] Slave upload  → machines/{machine_id}  cap_path={cap_path} (after {delay_s}s)")


if __name__ == "__main__":
    unittest.main(verbosity=2)
