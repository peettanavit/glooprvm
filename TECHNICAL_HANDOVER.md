# Gloop RVM — Technical Handover Document

> Last updated: 2026-03-19
> Architecture: Dual ESP32-CAM (Master / Slave) + Python AI Listener + Firebase

---

## 1. Current System Workflow

```
┌──────────────────────────────────────────────────────────────────────────┐
│  User opens Web App → assignMachineToUser() → status: "READY"           │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────┐
                    │  Master ESP32  (side / label cam)  │
                    │  • Detects bottle via sensor        │
                    │  • Captures label image             │
                    │  • POST /uploadBottleImage  (CF)    │
                    └─────────────────┬─────────────────┘
                                      │  CF writes:
                                      │    status = "ready"
                                      │    last_capture.label_storage_path
                                      │
                    ┌─────────────────▼─────────────────┐
                    │  Slave ESP32   (top / cap cam)     │
                    │  • Captures cap image independently │
                    │  • Writes last_capture.            │
                    │    cap_storage_path  (async)       │
                    │  Arrives within ~0–1.5 s of Master │
                    └─────────────────┬─────────────────┘
                                      │
                    ┌─────────────────▼─────────────────┐
                    │  listener.py  (Python AI service)  │
                    │                                     │
                    │  1. Detects status = "ready"        │
                    │  2. Claims doc (transaction):       │
                    │       → "processing_ai"             │
                    │  3. Downloads label image           │
                    │  4. Waits ≤ 1.5 s for cap image    │
                    │  5. detect_bottle(label, cap|None)  │
                    │  6. Writes result:                  │
                    │       status → PROCESSING | REJECTED│
                    │       result → 1 | 2 | 3            │
                    │       (deletes cap_storage_path)    │
                    └─────────────────┬─────────────────┘
                                      │
                    ┌─────────────────▼─────────────────┐
                    │  Master ESP32  (reads result)      │
                    │  Polls every 400 ms (10 s timeout) │
                    │                                     │
                    │  PROCESSING → solenoid OPEN        │
                    │               bottle drops through  │
                    │                                     │
                    │  REJECTED   → solenoid CLOSED      │
                    │               hold for 1.2 s        │
                    └─────────────────┬─────────────────┘
                                      │
                    ┌─────────────────▼─────────────────┐
                    │  Master ESP32  (slot sensor)       │
                    │  Bottle physically drops           │
                    │  firestoreSlotEvent("SMALL")       │
                    │    → session_score += 1            │
                    │    → status = "READY"              │
                    └────────────────────────────────────┘
```

**Key rule:** Slave ESP32 is upload-only. It **never** reads Firestore status and never touches the solenoid.

---

## 2. Firestore Schema — `machines/{machineId}`

### Top-level fields

| Field | Type | Set by | Description |
|---|---|---|---|
| `status` | string | All layers | See state machine below |
| `current_user` | string | Web | Firebase Auth UID of active user |
| `session_id` | string | Web | UUID, new per session |
| `session_score` | number | Master ESP32 | Increments by 1 per accepted bottle |
| `result` | number | listener.py | `1` / `2` / `3` — written on PROCESSING only |
| `updatedAt` | timestamp | All layers | Server timestamp |

### `last_capture` sub-map (new dual-cam fields)

| Field | Type | Set by | Description |
|---|---|---|---|
| `label_storage_path` | string | Cloud Function | GCS path to Master (side/label) image |
| `cap_storage_path` | string | Slave ESP32 | GCS path to Slave (top/cap) image — **deleted by listener.py after each scan** |
| `path` | string | Cloud Function | Full `gs://` URI (legacy) |
| `captured_at` | timestamp | Cloud Function | When Master uploaded |
| `valid` | bool | listener.py | `true` = accepted |
| `ai_label` | string | listener.py | label_model top class (e.g. `"lipo_cap"`) |
| `ai_conf` | float | listener.py | label_model confidence 0.0–1.0 |
| `cap_name` | string | listener.py | cap_model top class, or `"no_image"` if Slave offline |
| `cap_conf` | float | listener.py | cap_model confidence, or `0.0` if Slave offline |
| `dual_cam` | bool | listener.py | `true` = both cameras used; `false` = single-cam fallback |
| `reason` | string | listener.py | Human-readable decision explanation |

### Status state machine

```
"IDLE"           ← resetMachine() / resetStaleSessions watchdog
    │
    ▼  assignMachineToUser()
"READY"          ← also set by: firestoreSlotEvent(), ESP32 after reject hold
    │
    ▼  Cloud Function uploadBottleImage
"ready"          (lowercase — Python listener trigger)
    │
    ▼  _claim_if_ready() transaction
"processing_ai"  (Python working — anti-double-process lock)
    │
    ├──▶  "PROCESSING"  ← AI accepted  → Master opens solenoid
    │                                     slot sensor → "READY"
    │
    └──▶  "REJECTED"    ← AI rejected  → solenoid stays closed
                                          ESP32 waits 1.2 s → "READY"

"COMPLETED"      ← Web end-session button → summary page → "IDLE"
```

---

## 3. AI Decision Logic (`ai_server/listener.py`)

### Model files

| File | Purpose | Handles |
|---|---|---|
| `models/label_model.pt` | Primary decision | Reads bottle label (side view) |
| `models/cap_model.pt` | Validator / veto | Reads bottle cap (top view) |

Both models share the same 7 classes:
`cvitt_cap`, `ginseng_cap`, `lipo_cap`, `m-sport_cap`, `m150_cap`, `peptein_cap`, `shark_cap`

### Class mappings

**Accepted → ESP32 result code**

| Class | Result | Brand | Physical slot |
|---|---|---|---|
| `lipo_cap` | **1** | Lipoviton | Small — sorts first |
| `cvitt_cap` | **2** | C-Vitt | Medium — sorts second |
| `m150_cap` | **3** | M-150 | Large — sorts last |

**Rejected (negative filter) — always REJECTED**

`ginseng_cap` · `m-sport_cap` · `peptein_cap` · `shark_cap`

### `detect_bottle(label_bytes, cap_bytes | None)` — decision priority

```
Step 1  label image cannot be decoded          → REJECTED
Step 2  label_model detects REJECT class       → REJECTED  (negative filter)
Step 3  cap_model detects REJECT class         → REJECTED  (validator veto — dual-cam only)
Step 4  label_model detects ACCEPT class       → PROCESSING  +  result 1/2/3
Step 5  anything else                          → REJECTED
```

### Graceful degradation

| Condition | `dual_cam` | Behaviour |
|---|---|---|
| Both images arrive within 1.5 s | `true` | Steps 2+3 both active |
| Slave timeout / offline | `false` | Step 3 skipped — label model decides alone |
| Cap image decode fails | `false` | Logged as warning, treated as single-cam |

### Confidence threshold

Default `0.5`. Set `AI_CONFIDENCE_THRESHOLD=0.6` in `.env` for a stricter demo.
Applies to both accept (Step 4) and reject (Steps 2–3) paths.

---

## 4. Cleanup Logic

### `cap_storage_path` auto-deletion

Every time `process_machine` writes a detection result back to Firestore, it
includes `"last_capture.cap_storage_path": firestore.DELETE_FIELD` in the same
update. The stale Slave path is gone before the Master reads the result.

**Why this is safe:** The Cloud Function already replaces the entire `last_capture`
map (not dot notation) on each new Master upload, which would clear the old
`cap_storage_path` anyway. The `DELETE_FIELD` is a belt-and-suspenders guard for
the race window between "CF writes new label path" and "Slave writes new cap path".

### Double-processing prevention

`_claim_if_ready` runs inside a **Firestore transaction**. It checks
`status == "ready"` and immediately sets `status = "processing_ai"` atomically.
Any concurrent or duplicate call finds a different status and exits immediately.
No external locks, no session-ID matching required.

### Stale machine watchdog

`resetStaleSessions` (Cloud Function, runs every 5 min) resets any machine stuck
in `READY / PROCESSING / REJECTED / COMPLETED / ready / processing_ai` for more
than 10 minutes back to `IDLE`.

---

## 5. Environment Variables (`ai_server/.env`)

| Variable | Default | Description |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | *(required)* | Path to service account JSON |
| `FIREBASE_STORAGE_BUCKET` | `glooprvm.firebasestorage.app` | GCS bucket name |
| `AI_CONFIDENCE_THRESHOLD` | `0.5` | Min YOLO confidence for accept/reject |
| `CAP_WAIT_SECONDS` | `1.5` | Max seconds to wait for Slave image |

---

## 6. Pending Firmware Tasks

These changes are needed in the ESP32 `.ino` / upload logic to match the Python service.
The Python side is already ready for them.

### Master ESP32 (`gloop_esp32.ino` / `uploadFrameToCloudFunction`)

- [ ] **Rename the upload field written to Firestore.**
  The Cloud Function currently sets `last_capture.storage_path` (legacy).
  Update it to set `last_capture.label_storage_path` so listener.py reads
  the correct field without falling back to the legacy name.

  In `functions/index.js` change:
  ```js
  // current
  last_capture: {
    path: gsUri,
    storage_path: storagePath,
    captured_at: FieldValue.serverTimestamp(),
  }

  // target
  last_capture: {
    path: gsUri,
    label_storage_path: storagePath,   // ← rename this field
    captured_at: FieldValue.serverTimestamp(),
  }
  ```

- [ ] **Verify the Master is the only device calling `firestoreSlotEvent`.**
  Confirm `SLOT_PIN_SMALL` interrupt and score increment are on the Master only.

- [ ] **No solenoid logic changes needed.**
  The Master already polls for `status == "PROCESSING"` and calls `startSolenoid()`.
  This is correct and unchanged.

### Slave ESP32 (new firmware — not yet written)

- [ ] **Create a minimal sketch** that:
  1. Connects to WiFi
  2. Captures a JPEG from the top/cap camera
  3. Uploads it to Firebase Storage at path:
     `captures/{MACHINE_ID}/{sessionId}/{timestamp}_cap.jpg`
  4. Writes the path to Firestore using dot notation:
     ```
     PATCH machines/{MACHINE_ID}
     Body: { "last_capture.cap_storage_path": "<path>" }
     ```
  5. Does **nothing else** — no status reads, no solenoid, no score tracking.

- [ ] **Trigger the Slave capture at the right moment.**
  The Slave should take its photo at approximately the same time as the Master
  (within ~500 ms). Options:
  - Hardware sync wire from Master to Slave (trigger pin)
  - Both devices react to the same physical sensor event independently
  - Master sends a UDP broadcast on the local network

- [ ] **Authentication for Slave Firestore write.**
  The Slave needs its own Firebase machine account (email + password) with
  Firestore write permission for the `machines` collection.
  Create a new account: `machine-slave-gloop01@yourdomain.com`
  and add credentials to the Slave's `config.h`.

---

## 7. File Map

```
glooprvm/
├── ai_server/
│   ├── listener.py          ← Main AI service (Dual-cam, graceful degradation)
│   ├── server.py            ← Alternative: local HTTP server via ngrok
│   ├── models/
│   │   ├── label_model.pt   ← Primary YOLO model (side camera)
│   │   └── cap_model.pt     ← Validator YOLO model (top camera)
│   ├── requirements.txt     ← Python dependencies
│   └── .env.example         ← Environment variable template
│
├── esp32/
│   ├── gloop_esp32/
│   │   └── gloop_esp32.ino  ← Master ESP32 firmware (complete)
│   ├── config.h             ← Live credentials (gitignored)
│   ├── config.example.h     ← Credential template (tracked)
│   └── firebase_cert.h      ← Google root CA cert
│
├── functions/
│   └── index.js             ← Cloud Functions: uploadBottleImage + resetStaleSessions
│
├── web/src/
│   ├── app/dashboard/       ← Live machine status + sorting history
│   ├── app/summary/         ← Session end + score save
│   ├── lib/machine.ts       ← Firestore reads/writes (assignMachine, subscribeToMachine)
│   └── types/machine.ts     ← MachineStatus type: IDLE|READY|PROCESSING|REJECTED|COMPLETED
│
├── SYSTEM_SYNC_LOG.md       ← Full field reference + state machine + setup guide
└── TECHNICAL_HANDOVER.md    ← This file
```

> **Note:** `ai_server/` is gitignored at the root level to protect the service
> account JSON and `.pt` model files. To track `listener.py` and `requirements.txt`
> without exposing secrets, add an `ai_server/.gitignore`:
> ```
> # keep secrets and models out
> *.json
> *.pt
> .env
> __pycache__/
> .venv/
> training_results/
> ```
> Then remove the `ai_server/` line from the root `.gitignore` and re-add the
> directory to git tracking.
