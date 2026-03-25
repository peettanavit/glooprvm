# Gloop RVM — System Sync Log

> Last audited: 2026-03-25 (Pass 4 — telemetry, EMI fixes, FastAPI, dynamic config)
> Auditor: Claude Code (Lead Systems Engineer mode)

---

## 1. Architecture Overview

```
[User presses Start on Web]
        │ assignMachineToUser()  →  status: "READY"
        ▼
[Master ESP32 trigger_source set by web/button]
        │ handleBottleInsert()
        │ captures label JPEG → POST /uploadBottleImage (Cloud Function)
        │   CF writes: status = "ready"
        │              last_capture.label_storage_path = "<path>"
        ▼
[Slave ESP32 — optional, currently offline]
        │ uploads cap image → writes last_capture.cap_storage_path
        │ (arrives 0–CAP_WAIT_SECONDS after Master)
        ▼
[listener.py detects status: "ready"]
        │ Transaction claim      →  status: "processing_ai"
        │ Downloads label image  (Master — always required)
        │ Waits up to CAP_WAIT_SECONDS for cap_storage_path  ← now 0s (Slave offline)
        │ Downloads cap image    (Slave — optional)
        │
        │ detect_bottle(label_bytes, cap_bytes | None,
        │               conf_threshold, safety_lock_threshold)
        │   Step 1: label image decode fail              → REJECTED
        │   Step 2: ai_conf < safety_lock (0.35)         → REJECTED (hard floor)
        │   Step 3: label_model detect REJECT class      → REJECTED (negative filter)
        │   Step 4: cap_model detect REJECT class        → REJECTED (dual-cam veto)
        │   Step 5: ai_conf >= threshold                 → PROCESSING (master accepts)
        │   Step 6: ai_conf < threshold + slave agrees   → PROCESSING (slave rescue)
        │   Step 7: anything else                        → REJECTED
        │
        ├── Accepted  →  status: "PROCESSING"  +  result: 1|2|3
        └── Rejected  →  status: "REJECTED"
        ▼
[Master ESP32 polls Firestore every 200 ms (10 s timeout)]
        ├── "PROCESSING" → startSolenoid() — 600ms pulse
        └── "REJECTED"   → hold 1.2s → status: "READY"
        ▼
[Master waits SLOT_GUARD_MS (1000ms), then accepts slot interrupts]
        │ firestoreSlotEvent("SMALL|MEDIUM|LARGE")
        │   → slotCounts.<SIZE> += 1
        │   → session_score += 1|2|3
        │   → status: "READY"
        ▼
[User presses End Session on Web]
        │ forceSetStatus("COMPLETED")
        ▼
[Summary page] → persistUserSessionScore() → resetMachine() → status: "IDLE"
```

### Graceful Degradation

| Scenario | Behaviour |
|---|---|
| Both cameras online | `dual_cam=true` — cap_model validates, slave rescue available |
| Slave offline / `CAP_WAIT_SECONDS=0` | `dual_cam=false` — label_model decides alone |
| Camera hardware fails at boot | REJECTED every bottle — no blind accepts |
| Cap image decode fails | Logs warning, treats as single-cam |
| label_storage_path missing | Pipeline raises, writes REJECTED as fail-safe |

---

## 2. Firestore `machines/{machineId}` — Field Reference

| Field | Type | Set by | Values / Notes |
|---|---|---|---|
| `status` | string | All layers | See state machine below |
| `current_user` | string | Web | Firebase Auth UID |
| `session_id` | string | Web | `YYYYMMDD-HHMMSS-xxxx` |
| `session_score` | number | Master ESP32 | Incremented by 1/2/3 per slot event |
| `slotCounts.SMALL` | number | Master ESP32 | Cumulative small-slot count (Lipoviton) |
| `slotCounts.MEDIUM` | number | Master ESP32 | Cumulative medium-slot count (C-Vitt) |
| `slotCounts.LARGE` | number | Master ESP32 | Cumulative large-slot count (M-150) |
| `lastSlotEvent.size` | string | Master ESP32 | `"SMALL"` / `"MEDIUM"` / `"LARGE"` |
| `lastSlotEvent.timestamp` | timestamp | Master ESP32 | Server timestamp |
| `result` | number | listener.py | **1**=lipo / **2**=cvitt / **3**=m150 |
| `trigger_source` | string | Web / button | Consumed by ESP32 once per bottle cycle |
| `slave_restart` | bool | Web | Admin sets `true` → Slave restarts |
| `last_capture.label_storage_path` | string | Cloud Function | GCS path to label/side image |
| `last_capture.cap_storage_path` | string | Slave ESP32 | GCS path — **deleted by listener.py after scan** |
| `last_capture.valid` | bool | listener.py | `true` if accepted |
| `last_capture.ai_label` | string | listener.py | label_model top class |
| `last_capture.ai_conf` | float | listener.py | label_model confidence 0.0–1.0 |
| `last_capture.cap_name` | string | listener.py | cap_model top class, or `"no_image"` |
| `last_capture.cap_conf` | float | listener.py | cap_model confidence, or `0.0` |
| `last_capture.dual_cam` | bool | listener.py | `true` = both cameras used |
| `last_capture.reason` | string | listener.py | Human-readable decision explanation |
| `last_capture.inference_ms` | float | listener.py | **NEW** YOLO inference wall-clock latency |
| `updatedAt` | timestamp | All layers | Server timestamp |

---

## 3. `status` Field — Complete State Machine

| Value | Case | Set by | Read by |
|---|---|---|---|
| `"IDLE"` | UPPER | Web `resetMachine()`, `resetStaleSessions` | ESP32 (won't process), Web |
| `"READY"` | UPPER | Web `assignMachineToUser()`, ESP32 `firestoreSlotEvent()`, ESP32 after reject hold | ESP32 `handleBottleInsert()`, Web |
| `"PROCESSING"` | UPPER | listener.py (AI accepted) | ESP32 slot interrupts, Web |
| `"REJECTED"` | UPPER | listener.py (AI rejected / exception) | ESP32 `rejectUntil` guard, Web |
| `"COMPLETED"` | UPPER | Web end-session button | Web → navigates to /summary |
| `"ready"` | lower | Cloud Function `uploadBottleImage` | listener.py only |
| `"processing_ai"` | lower | listener.py (transaction claim) | `resetStaleSessions` watchdog |

> **Rule:** ESP32 only ever acts on UPPER-case statuses. Lower-case are internal
> Python/CF pipeline signals.

---

## 4. `logs` Collection — Field Reference

listener.py writes a log entry for **every bottle** (accepted AND rejected) since Pass 4.

| Field | Type | Notes |
|---|---|---|
| `machine_id` | string | e.g. `"Gloop_01"` |
| `bottle_type` | string | = `ai_label` — web SortingHistoryTable reads this |
| `result` | number \| null | 1/2/3 if accepted; `null` if rejected |
| `valid` | bool | `true` = accepted |
| `ai_label` | string | label_model top class |
| `ai_conf` | float | label_model confidence |
| `cap_name` | string | cap_model top class, or `"no_image"` |
| `cap_conf` | float | cap_model confidence |
| `dual_cam` | bool | Both cameras used? |
| `rescued_by_slave` | bool | `true` = slave rescue (Step 6) triggered |
| `reason` | string | Human-readable decision reason |
| `inference_ms` | float | **NEW** YOLO inference latency (ms) |
| `label_all_scores` | map | **NEW** `{class: conf}` for all label_model detections |
| `cap_all_scores` | map | **NEW** `{class: conf}` for all cap_model detections |
| `conf_threshold` | float | **NEW** active threshold at time of inference |
| `safety_lock_thr` | float | **NEW** active safety lock threshold |
| `user_id` | string | Firebase Auth UID |
| `session_id` | string | Session ID |
| `sorted_at` | timestamp | Server timestamp |

---

## 5. `system_configs` Collection — Dynamic Config (NEW Pass 4)

listener.py reads from Firestore every 60s. No restart needed to change thresholds.

| Document | Field | Default | Current | Description |
|---|---|---|---|---|
| `global` | `AI_CONFIDENCE_THRESHOLD` | 0.5 | 0.5 | Min confidence to accept |
| `global` | `AI_SAFETY_LOCK_THRESHOLD` | 0.35 | 0.35 | Hard floor — reject below this |
| `global` | `CAP_WAIT_SECONDS` | 1.5 | **0** | Seconds to wait for Slave image |
| `Gloop_01` | *(any field)* | — | — | Machine-specific override |

---

## 6. Result Codes

| `result` | YOLO label | Alias | Brand | Physical slot |
|---|---|---|---|---|
| `1` | `lipo_cap` | `lipo` | Lipoviton | Small (sorts first) |
| `2` | `cvitt_cap` | `cvitt` | C-Vitt | Medium (sorts second) |
| `3` | `m150_cap` | `m150` | M-150 | Large (sorts last) |

**Reject classes (negative filter):** `ginseng_cap` · `m-sport_cap` · `peptein_cap` · `shark_cap`

---

## 7. Hardware GPIO Map (Master ESP32-S3)

| GPIO | Function | Notes |
|---|---|---|
| 38 | `SOLENOID_PIN` | Active-low relay: LOW=open, HIGH=closed (safe default) |
| 14 | `SLOT_PIN_SMALL` | Limit switch — Lipoviton slot |
| 2 | `SLOT_PIN_MEDIUM` | Limit switch — C-Vitt slot |
| 3 | `SLOT_PIN_LARGE` | Limit switch — M-150 slot |
| 4–18 | Camera (OV5640) | Do not use for other GPIO |

All limit switches: `INPUT_PULLUP`, `FALLING` interrupt. Wire: GPIO → switch → GND.

> **Warning:** Floating (unconnected) limit switch pins trigger spurious interrupts
> continuously due to EMI noise on `INPUT_PULLUP` lines. Always disconnect wires
> from GPIO 14/2/3 if limit switches are not physically installed.

---

## 8. Changes Log

### Pass 1 — System sync + AI integration

| File | Change |
|---|---|
| `ai_server/listener.py` | `"finished"` → `"PROCESSING"`, `"rejected"` → `"REJECTED"` |
| `ai_server/listener.py` | Added `bottle_type` field to logs |
| `functions/index.js` | Added `"COMPLETED"` to `resetStaleSessions` query |

### Pass 2 — Dual ESP32-S3 firmware split + admin remote restart

| File | Change |
|---|---|
| `functions/index.js` | `storage_path` → `label_storage_path` |
| `esp32/Slave_ESP32/` | New slave firmware (cap camera upload only) |
| `web/src/app/admin/page.tsx` | Added "Restart Slave" button |

### Pass 3 — 3-slot support, camera quality, Firestore rules (2026-03-20)

| File | Change |
|---|---|
| `Master_ESP32.ino` | Added SLOT_PIN_MEDIUM (GPIO 2) + SLOT_PIN_LARGE (GPIO 3) |
| `Master_ESP32.ino` | `jpeg_quality=5`, 10×100ms warmup, gainceiling fix |
| `firestore.rules` | Added slot-event rule for active session owner |
| `web/src/app/admin/page.tsx` | Added slotCounts display card |

### Pass 4 — Telemetry, EMI fixes, FastAPI, dynamic config (2026-03-25)

| File | Change | Reason |
|---|---|---|
| `ai_server/config_manager.py` | **New** — fetches thresholds from Firestore `system_configs` with 60s TTL | Replace hardcoded `.env` thresholds with live-editable config |
| `ai_server/listener.py` | Fixed `NameError: _CAP_WAIT_S` — replaced with `_config.get_float()` | Caused crash on first bottle |
| `ai_server/listener.py` | Fixed `detect_bottle()` missing `conf_threshold` / `safety_lock_threshold` args | Would crash at runtime |
| `ai_server/listener.py` | Added inference latency `inference_ms`; written to `last_capture` and `logs` | Thesis telemetry |
| `ai_server/listener.py` | Logs now written for ALL bottles (valid + rejected) with full telemetry | Previously only accepted bottles had a log entry |
| `ai_server/listener.py` | `service_state` updated per bottle; exposed via `start_listener()` | Allows `api.py` to serve `/status` |
| `ai_server/api.py` | **New** FastAPI service — `/health` and `/status` endpoints | Dashboard can check AI service health |
| `ai_server/requirements.txt` | Added `fastapi`, `uvicorn` | Required for `api.py` |
| `Master_ESP32.ino` | Removed `READY_BUTTON_PIN` (GPIO 47) — variable, ISR, `pinMode`, `attachInterrupt`, loop handler | Floating unconnected pin caused spurious FALLING interrupts → premature PROCESSING→READY |
| `esp32/config.h` | Removed `#define READY_BUTTON_PIN 47` | Pin not connected |
| `Master_ESP32.ino` | Added `SLOT_GUARD_MS=1000` — ignores slot interrupts for 1s after solenoid fires | Relay EMI couples onto limit switch GPIO at moment of switching |
| `Master_ESP32.ino` | Camera/upload failure now → REJECTED (was unconditional PROCESSING) | Camera failure must not silently accept all bottles |
| `Master_ESP32.ino` | Poll interval 400ms → 200ms | Reduce latency from AI result to solenoid |
| `firestore.rules` | Added `isAdmin()` as first condition in machines `allow update` | Admin had no write permission on machines — could not reset stuck machine |
| `Firestore system_configs/global` | `CAP_WAIT_SECONDS = 0` | Slave not connected; eliminates 1.5s wait, cuts latency from ~5s to ~1–2s |

---

## 9. Local Setup

### Python AI Listener

```bash
cd ai_server
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt

cp .env.example .env
# Set: FIREBASE_SERVICE_ACCOUNT, FIREBASE_STORAGE_BUCKET, MACHINE_ID

python listener.py          # listener only
python api.py               # FastAPI + listener on :8000
```

### FastAPI endpoints

```
GET http://localhost:8000/health  → {"ok": true, "listener_alive": true, "uptime_s": ...}
GET http://localhost:8000/status  → uptime, last detection, active config snapshot
```

### ESP32 Arduino IDE settings

```
Board:  ESP32S3 Dev Module
PSRAM:  OPI PSRAM   ← REQUIRED — camera DMA malloc fails without this
Flash:  16MB
```

---

## 10. System Health Checklist (Demo Day)

### Python AI Listener
- [ ] `python api.py` running; `GET /health` returns `{"ok": true}`
- [ ] Firestore `system_configs/global.CAP_WAIT_SECONDS = 0` (Slave offline)
- [ ] First bottle log in Firestore `logs` collection has `inference_ms` field

### Master ESP32-S3
- [ ] Arduino IDE: PSRAM = "OPI PSRAM"
- [ ] Serial boot: `[CAM] OK — XXXXX bytes (800x600)`
- [ ] Serial: `[Auth] machine signed in`
- [ ] No idle spurious `[Slot] triggered` — if seen, disconnect floating GPIO wires
- [ ] Test bottle: `[RVM] AI accepted -> solenoid open`
- [ ] Solenoid physically clicks open
- [ ] After 1s guard, limit switch → `[Slot] MEDIUM +1 score+2, status->READY`
- [ ] Firestore: `session_score++`, `slotCounts.MEDIUM++`, `result: 2` present

### Limit Switches
- [ ] All 3 wired: GPIO 14/2/3 → switch → GND
- [ ] No floating wires on those GPIOs

### Web + Admin
- [ ] Dashboard shows live sorting history with correct labels
- [ ] Admin (`tanavit.parn@gmail.com`) can reset machine — no "no permission" error
- [ ] Slot counts display correctly in admin panel
