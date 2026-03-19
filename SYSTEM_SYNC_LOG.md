# Gloop RVM — System Sync Log

> Last audited: 2026-03-19
> Auditor: Claude Code (Lead Systems Engineer mode)

---

## 1. Architecture Overview

```
[User presses Start on Web]
        │ assignMachineToUser()  →  status: "READY"
        ▼
[Master ESP32 sensor detects bottle]
        │ firestoreSlotEvent()   →  status: "READY"
        ▼
[Master ESP32 captures label image + uploads to Cloud Function]
        │ POST /uploadBottleImage
        │   sets: status = "ready"
        │         last_capture.label_storage_path = "<path>"   ← NEW (dual-cam)
        ▼
[Slave ESP32 captures cap image independently]
        │ uploads to Storage, then writes:
        │   last_capture.cap_storage_path = "<path>"
        │ (arrives 0–2 s after Master)
        ▼
[listener.py detects status: "ready"]
        │ Transaction claim      →  status: "processing_ai"
        │ Downloads label image  (Master — always required)
        │ Waits up to CAP_WAIT_SECONDS for cap_storage_path
        │ Downloads cap image    (Slave — optional)
        │
        │ detect_bottle(label_bytes, cap_bytes | None)
        │   label_model  → primary decision (label image)
        │   cap_model    → validator veto   (cap image, if present)
        │
        ├── Accepted  →  status: "PROCESSING"  +  result: 1|2|3
        └── Rejected  →  status: "REJECTED"
        ▼
[Master ESP32 polls Firestore every 400 ms (10 s timeout)]
        ├── "PROCESSING" → startSolenoid() — bottle drops through
        └── "REJECTED"   → hold bottle, show rejection on web
        ▼                  (Slave ESP32 NEVER reads status — upload only)
[Master ESP32 slot sensor fires when bottle drops]
        │ firestoreSlotEvent("SMALL")  →  session_score += 1, status: "READY"
        ▼
[User presses End Session on Web]
        │ forceSetStatus("COMPLETED")
        ▼
[Summary page] → persistUserSessionScore() → resetMachine() → status: "IDLE"
```

### Graceful Degradation

| Scenario | Behaviour |
|---|---|
| Both cameras online | `dual_cam = true` — cap_model validates label_model's decision |
| Slave offline / cap image not in Firestore within `CAP_WAIT_SECONDS` | `dual_cam = false` — label_model decides alone |
| Cap image arrives but cannot be decoded | Falls back to single-cam; logs a warning |
| Master image missing (label_storage_path absent) | Pipeline raises, writes `REJECTED` as fail-safe |

---

## 2. Firestore `machines/{machineId}` — Field Reference

| Field | Type | Set by | Values / Notes |
|---|---|---|---|
| `status` | string | All layers | See table below |
| `current_user` | string | Web (`assignMachineToUser`) | Firebase Auth UID |
| `session_id` | string | Web | UUID, generated per session |
| `session_score` | number | ESP32 (`firestoreSlotEvent`) | Incremented by 1 per accepted bottle |
| `result` | number | listener.py | **1** = clear / **2** = brown / **3** = green. Only present after AI accepts. |
| `last_capture.label_storage_path` | string | Cloud Function (Master) | GCS path to label/side image |
| `last_capture.cap_storage_path` | string | Slave ESP32 upload | GCS path to cap/top image (optional) |
| `last_capture.path` | string | Cloud Function | Full `gs://` URI (legacy) |
| `last_capture.storage_path` | string | Cloud Function | Legacy single-cam path (backward-compat) |
| `last_capture.captured_at` | timestamp | Cloud Function | Server timestamp |
| `last_capture.valid` | bool | listener.py | `true` if accepted |
| `last_capture.ai_label` | string | listener.py | label_model top class, e.g. `"lipo_cap"` |
| `last_capture.ai_conf` | float | listener.py | label_model confidence 0.0–1.0 |
| `last_capture.cap_name` | string | listener.py | cap_model top class, or `"no_image"` if Slave offline |
| `last_capture.cap_conf` | float | listener.py | cap_model confidence, or `0.0` if Slave offline |
| `last_capture.dual_cam` | bool | listener.py | `true` = both cameras used; `false` = single-cam fallback |
| `last_capture.reason` | string | listener.py | Human-readable decision explanation |
| `last_upload_at` | timestamp | Cloud Function | Rate-limit guard (3 s cooldown) |
| `updatedAt` | timestamp | All layers | Server timestamp |

---

## 3. `status` Field — Complete State Machine

| Value | Case | Set by | Read by |
|---|---|---|---|
| `"IDLE"` | UPPER | Web `resetMachine()`, `resetStaleSessions` | ESP32 (won't process), Web (shows "ว่าง") |
| `"READY"` | UPPER | Web `assignMachineToUser()`, ESP32 `firestoreSlotEvent()`, ESP32 (after reject hold, after ready-button) | ESP32 `handleBottleInsert()`, Web |
| `"PROCESSING"` | UPPER | listener.py (AI accepted), ESP32 (AI timeout fallback) | ESP32 `slotSmallInterrupt`, Web |
| `"REJECTED"` | UPPER | listener.py (AI rejected), listener.py (exception fallback) | ESP32 `rejectUntil` guard, Web |
| `"COMPLETED"` | UPPER | Web `forceSetStatus("COMPLETED")` | Web → navigates to /summary |
| `"ready"` | lower | Cloud Function `uploadBottleImage` | listener.py only |
| `"processing_ai"` | lower | listener.py (transaction claim) | `resetStaleSessions` watchdog |

> **Rule:** The ESP32 only ever acts on UPPER-case statuses. Lower-case values are
> internal pipeline signals between Cloud Function and Python only.

---

## 4. Result Codes (ESP32 ↔ Firestore ↔ Web)

Both `label_model.pt` and `cap_model.pt` share these 7 classes:
`cvitt_cap`, `ginseng_cap`, `lipo_cap`, `m-sport_cap`, `m150_cap`, `peptein_cap`, `shark_cap`

### Accepted classes (open solenoid)

Ordered by physical slot position — smallest bottle first.

| `result` value | YOLO label (`ai_label`) | Brand | Physical slot |
|---|---|---|---|
| `1` | `"lipo_cap"` | Lipoviton | Small (sorts first) |
| `2` | `"cvitt_cap"` | C-Vitt | Medium (sorts second) |
| `3` | `"m150_cap"` | M-150 | Large (sorts last) |

### Negative-filter classes (explicit reject)

These classes are **never** accepted. If either model detects them with conf ≥ threshold,
the bottle is rejected immediately — even if the other model would have accepted it.

| YOLO label | Action |
|---|---|
| `"ginseng_cap"` | REJECTED |
| `"m-sport_cap"` | REJECTED |
| `"peptein_cap"` | REJECTED |
| `"shark_cap"` | REJECTED |

### Decision priority (in order)

1. Image decode failure → **REJECTED**
2. Either model detects a negative-filter class (conf ≥ threshold) → **REJECTED**
3. `label_model` detects an accepted class (conf ≥ threshold) → **PROCESSING** + `result: 1|2|3`
4. Anything else (unknown class, no detection, low confidence) → **REJECTED**

> The ESP32 does **not** read `result` — it acts solely on `status: "PROCESSING"`.
> `result` is for the web dashboard and admin panel only.

**To change the mapping**, edit `_LABEL_TO_RESULT` and `_REJECT_CLASSES` in `ai_server/listener.py` (lines 71–85).

---

## 5. Firestore `logs` Collection — Field Reference

Written by listener.py on each accepted bottle. Read by web `SortingHistoryTable`.

| Field | Type | Notes |
|---|---|---|
| `machine_id` | string | e.g. `"Gloop_01"` |
| `bottle_type` | string | = `ai_label` (e.g. `"clear"`) — web history table reads this |
| `result` | number | 1 / 2 / 3 |
| `ai_label` | string | Raw YOLO class name |
| `ai_conf` | float | Confidence score 0.0–1.0 |
| `user_id` | string | Firebase Auth UID |
| `session_id` | string | Session UUID |
| `sorted_at` | timestamp | Server timestamp |

---

## 6. Storage Path Convention

```
captures/{machineId}/{sessionId}/{YYYY-MM-DD_HH-MM-SS}.jpg          ← Master (label)
captures/{machineId}/{sessionId}/{YYYY-MM-DD_HH-MM-SS}_cap.jpg      ← Slave  (cap)
```

Example:
- `captures/Gloop_01/abc-123/2026-03-19_14-30-00.jpg`
- `captures/Gloop_01/abc-123/2026-03-19_14-30-00_cap.jpg`

The Master path is written to `last_capture.label_storage_path` by the Cloud Function.
The Slave path is written to `last_capture.cap_storage_path` by a separate upload.
`listener.py` reads both via `bucket.blob(path).download_as_bytes()`.

**Backward compatibility:** If `label_storage_path` is absent (old single-cam firmware),
`listener.py` falls back to `last_capture.storage_path` automatically.

---

## 7. Dual-Camera Sync & Failure-Mode Reference

This section documents exactly which mechanism prevents each failure mode so you can
debug quickly during the demo.

### How double-processing is prevented

`_claim_if_ready` runs inside a **Firestore transaction**. It reads the document and
only proceeds if `status == "ready"`. It immediately writes `status = "processing_ai"`
inside the same atomic operation. Any second call (listener restart, duplicate event)
finds status already changed and exits. No session-ID matching or extra locks needed.

```
listener fires  →  transaction: "ready" → "processing_ai"  ✓
listener fires  →  transaction: status != "ready"           → skip (safe)
```

### How ghost Slave images are prevented

The Cloud Function (`uploadBottleImage`) writes `last_capture` as a **full map
replace** — not dot notation. This overwrites (and therefore deletes) any
`cap_storage_path` left from the previous bottle the moment the Master uploads.

As an additional belt-and-suspenders guard, `listener.py` explicitly deletes
`last_capture.cap_storage_path` from Firestore after every detection cycle using
`firestore.DELETE_FIELD`. A stale Slave path can never leak into the next scan.

### Why there is no Python-side 5-second IDLE reset

The ESP32 owns the post-detection state transitions:

| After `PROCESSING` | ESP32 slot sensor fires → `firestoreSlotEvent()` → `READY` |
| After `REJECTED`   | ESP32 waits 1.2 s (`REJECT_HOLD_MS`) → sets `READY`        |

A Python timer that reset the machine to `IDLE` after 5 seconds would race with
both of these transitions and break the hardware loop. Stuck machines are already
covered by the `resetStaleSessions` Cloud Function (10-minute watchdog).

### Slave timeout behaviour

| `CAP_WAIT_SECONDS` | Slave arrived? | `dual_cam` | Validator active? |
|---|---|---|---|
| 1.5 s (default) | Yes (within window) | `true` | Yes — cap_model can veto |
| 1.5 s (default) | No (timeout) | `false` | No — label_model decides alone |
| — | Cap image decode fails | `false` | No — treated as single-cam |

Raise `CAP_WAIT_SECONDS` in `.env` if your Slave uploads are slower than 1.5 s
(poor WiFi, far from AP). Lowering it speeds up the per-bottle cycle at the cost
of fewer dual-cam validations.

### Master / Slave responsibility split

| Responsibility | Master ESP32 | Slave ESP32 |
|---|---|---|
| Trigger detection | ✓ (sets `status: "ready"`) | ✗ |
| Read Firestore status | ✓ (polls every 400 ms) | ✗ |
| Trigger solenoid | ✓ (`PROCESSING` → open) | ✗ |
| Upload image | ✓ (`label_storage_path`) | ✓ (`cap_storage_path`) |
| Score increment | ✓ (slot sensor) | ✗ |

---

## 9. Changes Made During This Audit

| File | Change | Reason |
|---|---|---|
| `ai_server/listener.py` | `"finished"` → `"PROCESSING"`, `"rejected"` → `"REJECTED"` | **Critical**: ESP32 only polls for UPPER-case values; solenoid would never open |
| `ai_server/listener.py` | Added `"bottle_type": detection["ai_label"]` to `logs.add()` | Web `SortingHistoryTable` reads `bottle_type`; without it every entry showed `"unknown"` |
| `functions/index.js` | Added `"COMPLETED"` to `resetStaleSessions` query | Machine stuck in COMPLETED (browser closed on summary page) was never auto-reset |
| `ai_server/.env.example` | Added `AI_CONFIDENCE_THRESHOLD=0.5` | Env var existed in listener.py but was undocumented |
| `ai_server/requirements.txt` | Added `google-cloud-firestore>=2.14.0`; added comments | listener.py imports from it directly; Flask labeled as server.py-only |

---

## 8. Local Setup — Step-by-Step

### Prerequisites
- Python 3.10+
- Node.js 18+ (for Cloud Functions emulation, optional)
- Firebase service account JSON (download from Firebase Console → Project Settings → Service Accounts → Generate new private key)

### Step 1 — Clone and enter the AI server directory
```bash
cd ai_server
```

### Step 2 — Create and activate a virtual environment
```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### Step 3 — Install dependencies
```bash
pip install -r requirements.txt
```

> **GPU note:** If your machine has CUDA, PyTorch will auto-detect it. For CPU-only
> (demo laptop), no extra steps needed — ultralytics defaults to CPU.

### Step 4 — Configure environment
```bash
cp .env.example .env
# Edit .env and fill in:
#   FIREBASE_SERVICE_ACCOUNT = path to your downloaded service account JSON
#   FIREBASE_STORAGE_BUCKET  = glooprvm.firebasestorage.app  (or your bucket name)
#   AI_CONFIDENCE_THRESHOLD  = 0.5  (raise to 0.6–0.7 to reduce false positives)
#   CAP_WAIT_SECONDS         = 2.0  (how long to wait for Slave ESP32 image)
#                                    increase if Slave uploads are slow over WiFi
```

### Step 5 — Verify model class names match the result mapping
```bash
python -c "
from ultralytics import YOLO
lm = YOLO('models/label_model.pt')
cm = YOLO('models/cap_model.pt')
print('label_model classes:', lm.names)
print('cap_model  classes:', cm.names)
"
```
Expected output should show `clear`, `brown`, `green` in label_model classes.
If the names differ, update `_LABEL_TO_RESULT` in `listener.py` lines 71–75.

### Step 6 — Start the listener
```bash
python listener.py
```

Expected startup output:
```
2026-03-19 14:00:00 [INFO] [AI] Loading YOLO models…
2026-03-19 14:00:02 [INFO] [AI] Models loaded. Label classes: {0: 'clear', 1: 'brown', 2: 'green'}
2026-03-19 14:00:02 [INFO] [AI] Cap classes: {0: 'cap', 1: 'no_cap'}
2026-03-19 14:00:03 [INFO] Gloop AI Listener — watching machines collection for status=ready
2026-03-19 14:00:03 [INFO] Listener active. Press Ctrl+C to stop.
```

### Step 7 — Verify end-to-end (manual test)
1. Open Firebase Console → Firestore → `machines/Gloop_01`
2. Manually set `status = "ready"` and ensure `last_capture.storage_path` points to a real image in Storage
3. Watch listener.py logs — should see: `claimed → starting AI pipeline` → `[YOLO] label=...` → `status=PROCESSING`
4. Confirm Firestore shows `status: "PROCESSING"` and `result: 1` (or 2/3)

---

## 10. System Health Checklist (Demo Day)

- [ ] `listener.py` running, shows "Listener active"
- [ ] Model class names confirmed to match `_LABEL_TO_RESULT`
- [ ] ESP32 Serial Monitor shows `[Auth] machine signed in`
- [ ] Test bottle: ESP32 shows `[CAM] upload ok` → `[RVM] waiting for AI result...`
- [ ] listener.py shows `[YOLO] label=clear(0.87) cap=cap` → `status=PROCESSING`
- [ ] ESP32 shows `[RVM] AI accepted -> solenoid open`
- [ ] Solenoid physically opens
- [ ] ESP32 shows `[Slot] SMALL triggered` after bottle drops
- [ ] Firebase Console: `session_score` incremented, `result: 1` present
- [ ] Web dashboard shows bottle in sorting history table with correct label
