# Gloop RVM — Technical Handover Document

> Last updated: 2026-03-25 (Pass 4 — telemetry, EMI fixes, FastAPI, dynamic config)
> Architecture: Dual ESP32-S3 (Master / Slave) + Python AI Listener + Firebase

---

## 1. Current System Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User opens Web App → assignMachineToUser() → status: "READY"          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │  Master ESP32  (label cam)     │
                 │  • trigger_source set by web   │
                 │  • Captures label JPEG         │
                 │  • POST /uploadBottleImage     │
                 │    CF: status="ready"          │
                 │        label_storage_path=...  │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │  Slave ESP32  (cap cam)        │
                 │  CURRENTLY OFFLINE             │
                 │  When online: uploads cap img  │
                 │  → cap_storage_path (async)    │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │  listener.py  (AI service)     │
                 │                                │
                 │  1. Sees status="ready"        │
                 │  2. Claims → "processing_ai"   │
                 │  3. Downloads label image      │
                 │  4. Waits ≤ CAP_WAIT_SECONDS   │
                 │     for cap image (now=0s)     │
                 │  5. detect_bottle(...)         │
                 │  6. Writes result + telemetry  │
                 │     → PROCESSING | REJECTED    │
                 │     → inference_ms, all_scores │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │  Master ESP32  (reads result)  │
                 │  Polls every 200ms (10s max)   │
                 │                                │
                 │  PROCESSING → solenoid 600ms   │
                 │  REJECTED   → hold 1.2s        │
                 └───────────────┬───────────────┘
                                 │ (after SLOT_GUARD_MS = 1000ms)
                 ┌───────────────▼───────────────┐
                 │  Limit Switch fires            │
                 │  firestoreSlotEvent(SIZE)      │
                 │  → score++, slotCounts++       │
                 │  → status = "READY"            │
                 └────────────────────────────────┘
```

**Key rules:**
- Slave ESP32 is upload-only. Never reads status, never touches solenoid.
- PROCESSING stays until a **limit switch** confirms the bottle physically dropped.
- Camera failure → REJECT every bottle (no blind accepts).

---

## 2. File Map

```
glooprvm/
├── ai_server/
│   ├── listener.py          ← Main AI service (Firestore listener + YOLO inference)
│   ├── api.py               ← NEW FastAPI wrapper: /health + /status endpoints
│   ├── config_manager.py    ← NEW Dynamic config from Firestore system_configs
│   ├── server.py            ← Legacy: local HTTP server via ngrok (not used in production)
│   ├── models/
│   │   ├── label_model.pt   ← Primary YOLO model (side/label camera)
│   │   └── cap_model.pt     ← Validator YOLO model (top/cap camera)
│   ├── requirements.txt     ← Python deps (includes fastapi, uvicorn)
│   └── .env.example         ← Env var template
│
├── esp32/
│   ├── Master_ESP32/
│   │   └── Master_ESP32.ino ← Master firmware (label cam + solenoid + scoring)
│   ├── Slave_ESP32/
│   │   └── Slave_ESP32.ino  ← Slave firmware (cap cam upload only)
│   ├── config.h             ← Master credentials (gitignored)
│   │     GPIO: SOLENOID=38, SLOT_SMALL=14, SLOT_MEDIUM=2, SLOT_LARGE=3
│   ├── config.example.h     ← Master credential template (tracked)
│   ├── config_slave.h       ← Slave credentials (gitignored)
│   ├── config_slave.example.h ← Slave template (tracked)
│   └── firebase_cert.h      ← Google root CA cert
│
├── functions/
│   └── index.js             ← uploadBottleImage + resetStaleSessions
│
├── web/src/
│   ├── app/dashboard/       ← Live machine status + sorting history
│   ├── app/summary/         ← Session end + score save
│   ├── app/admin/           ← Reset machine + slot counts + restart slave
│   ├── lib/machine.ts       ← Firestore helpers
│   └── types/machine.ts     ← MachineStatus type
│
├── firestore.rules          ← Security rules (admin can write machines)
├── SYSTEM_SYNC_LOG.md       ← Full field reference + state machine + setup guide
└── TECHNICAL_HANDOVER.md   ← This file
```

---

## 3. Firestore Schema

### `machines/{machineId}` — key fields

| Field | Set by | Notes |
|---|---|---|
| `status` | All layers | See state machine in SYSTEM_SYNC_LOG |
| `current_user` | Web | Firebase Auth UID |
| `session_score` | Master ESP32 | +1/+2/+3 per slot event |
| `slotCounts.SMALL/MEDIUM/LARGE` | Master ESP32 | Cumulative bottle counts per slot |
| `result` | listener.py | 1=lipo / 2=cvitt / 3=m150 |
| `last_capture.inference_ms` | listener.py | YOLO latency (NEW) |
| `last_capture.dual_cam` | listener.py | `true` when Slave online |

### `logs/{logId}` — inference log (written for every bottle since Pass 4)

Key new fields: `inference_ms`, `label_all_scores`, `cap_all_scores`, `rescued_by_slave`, `conf_threshold`

### `system_configs/global` — live config (NEW)

| Field | Current Value | Description |
|---|---|---|
| `AI_CONFIDENCE_THRESHOLD` | 0.5 | Minimum YOLO confidence |
| `AI_SAFETY_LOCK_THRESHOLD` | 0.35 | Hard floor below which always reject |
| `CAP_WAIT_SECONDS` | **0** | Slave wait time (0 = Slave disabled) |

Changes here take effect within 60 seconds — no code deploy needed.

### `admins/{uid}` — admin access control

| UID | Email |
|---|---|
| `j9whcXFUD2MYbSn7CjEaqucqFa13` | `tanavit.parn@gmail.com` |

---

## 4. AI Decision Logic

### Decision priority (`detect_bottle`)

```
Step 1  Label image decode fails              → REJECTED
Step 2  ai_conf < safety_lock_threshold       → REJECTED  (hard floor)
Step 3  label_model detects REJECT class      → REJECTED  (negative filter)
Step 4  cap_model detects REJECT class        → REJECTED  (dual-cam veto, if Slave online)
Step 5  ai_conf >= conf_threshold             → PROCESSING (master confident)
Step 6  ai_conf < conf_threshold              → PROCESSING (slave rescue — Slave agrees)
        AND Slave online AND cap same class
        AND cap_conf >= conf_threshold
Step 7  Anything else                         → REJECTED
```

### Accepted classes

| Class | Alias | Result | Slot |
|---|---|---|---|
| `lipo_cap` | `lipo` | 1 | Small |
| `cvitt_cap` | `cvitt` | 2 | Medium |
| `m150_cap` | `m150` | 3 | Large |

### Reject classes (negative filter)

`ginseng_cap` · `m-sport_cap` · `peptein_cap` · `shark_cap`

---

## 5. Hardware — Master ESP32-S3

### GPIO assignments

| GPIO | Function | Wiring |
|---|---|---|
| 38 | Solenoid relay IN | Active-low: LOW=open, HIGH=closed |
| 14 | Limit switch SMALL | Switch → GND. `INPUT_PULLUP`, `FALLING` interrupt |
| 2 | Limit switch MEDIUM | Switch → GND. `INPUT_PULLUP`, `FALLING` interrupt |
| 3 | Limit switch LARGE | Switch → GND. `INPUT_PULLUP`, `FALLING` interrupt |
| 4–18 | OV5640 camera | Do not use for GPIO |

### Arduino IDE settings

```
Board:  ESP32S3 Dev Module
PSRAM:  OPI PSRAM   ← REQUIRED (camera DMA malloc fails without this)
Flash:  16MB
```

### Critical wiring notes

- Limit switches must be physically connected before power-on. Floating `INPUT_PULLUP`
  pins are antenna for EMI — relay switching causes spurious `FALLING` interrupts that
  prematurely set PROCESSING → READY without a bottle dropping.
- `SLOT_GUARD_MS = 1000` ms: slot interrupts are silently ignored for 1 second after
  solenoid fires as a secondary EMI suppression guard.
- GPIO 47 (`READY_BUTTON_PIN`) has been **removed from firmware** — do not connect
  anything to GPIO 47.

---

## 6. Known Constraints & Next Steps

| Item | Status | Notes |
|---|---|---|
| Slave ESP32 (cap camera) | Offline | `CAP_WAIT_SECONDS=0` in Firestore; dual_cam always false until reconnected |
| Limit switches | Not yet connected | Must connect GPIO 14/2/3 before testing slot scoring |
| `api.py` FastAPI service | Created, not yet running in production | Run `python api.py` alongside `listener.py` for `/health` endpoint |
| Admin UID mismatch | Fixed | `tanavit.parn@gmail.com` in admins collection; Firestore rules updated |
| Machine account email | Does not match `^machine-.*` pattern | Current workaround: slot-event rule grants active session owner write rights |

---

## 7. Quick Start (New Assistant)

```bash
# 1. Start AI service
cd ai_server
.venv\Scripts\activate
python api.py              # starts Firestore listener + FastAPI on :8000

# 2. Verify health
curl http://localhost:8000/health
# → {"ok": true, "listener_alive": true, "uptime_s": ...}

# 3. Check active config
curl http://localhost:8000/status
# → shows current conf_threshold, CAP_WAIT_SECONDS, last detection

# 4. Deploy Firestore rules after any rules change
firebase deploy --only firestore:rules

# 5. Deploy web after any web change
firebase deploy --only hosting

# 6. Tune thresholds (no restart needed)
# Go to Firebase Console → Firestore → system_configs/global
# Edit AI_CONFIDENCE_THRESHOLD / CAP_WAIT_SECONDS
# Takes effect within 60 seconds
```

---

## 8. Firestore Security Rules — Key Notes

`isAdmin()` checks `admins/{uid}` exists. Admin accounts are created manually
in Firebase Console — they cannot be written from client code.

Since Pass 4, admins can update any machine document unconditionally (first condition
in the machines `allow update` rule). This allows the admin panel to reset stuck
machines regardless of who owns the current session.

The machine account email (`Tanavit.parn@gmail.com`) does NOT match the
`isMachineClient()` pattern (`^machine-.*@.*$`). Slot events are authorized via a
separate rule allowing the active session owner to write
`status / session_score / slotCounts / lastSlotEvent / updatedAt`.
