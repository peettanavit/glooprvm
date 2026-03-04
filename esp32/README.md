# Gloop ESP32 Edge Service

This folder replaces the Raspberry Pi edge loop with ESP32 firmware.

The sketch:
- authenticates with Firebase using a dedicated machine email/password
- reads `machines/{MACHINE_ID}` from Firestore
- waits for active session (`READY` or `PROCESSING` with non-empty `current_user`)
- validates inserted bottle (placeholder logic)
- sets `REJECTED` or updates `PROCESSING` + `session_score`

## 1) Arduino IDE Setup

Install:
- ESP32 board package (`esp32 by Espressif Systems`)
- Library `ArduinoJson` (v7+)

Select board:
- `ESP32S3 Dev Module` (or your exact ESP32-S3 variant)

## 2) Configure Secrets

1. Copy:
   - `esp32/config.example.h` -> `esp32/config.h`
2. Set values in `config.h`:
   - `WIFI_SSID`, `WIFI_PASSWORD`
   - `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`
   - `MACHINE_EMAIL`, `MACHINE_PASSWORD` (create this user in Firebase Auth)
   - `MACHINE_ID` (default `Gloop_01`)
   - pins and sensor polarity

`esp32/config.h` is ignored by git.

## 3) Firebase Requirements

1. Enable Firebase Authentication (Email/Password provider).
2. Create machine user (example `machine-gloop01@example.com`).
3. Ensure machine email starts with `machine-` (matches default Firestore rules in this repo).
4. Ensure document exists:
   - `/machines/Gloop_01`
   - fields: `status`, `current_user`, `session_score`

After editing rules, deploy:
- `firebase deploy --only firestore:rules`

## 4) Upload and Run

Open:
- `esp32/gloop_esp32/gloop_esp32.ino`

Upload and monitor Serial at `115200`.

## Notes

- Bottle validation is still placeholder random logic, same as current Python edge prototype.
- Firestore updates are direct REST calls from ESP32.
- This is enough to replace Pi for current mockup workflow.
