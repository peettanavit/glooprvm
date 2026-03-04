# Gloop - Smart Reverse Vending Machine

This repository contains:
- `web/`: Next.js (App Router) frontend with HeroUI, Firebase Auth, and Firestore realtime machine-state UI.
- `esp32/`: ESP32 firmware that replaces Raspberry Pi for machine loop and Firestore updates.
- `edge/`: Raspberry Pi Python service (legacy prototype path).

## Web Routes
- `/login`: login/register screen (Firebase Auth)
- `/dashboard`: live machine status and session score
- `/summary`: session summary screen
- `/profile`: user total points and recent sessions
- `/rewards`: rewards catalog view

## Firestore Document
Collection: `machines`  
Document: `Gloop_01`

Fields:
- `status`: `IDLE | READY | PROCESSING | REJECTED | COMPLETED`
- `current_user`: string UID
- `session_score`: number

## Prerequisites
- Node.js 18+
- npm
- Arduino IDE 2.x + ESP32 board package
- Firebase project with Authentication and Firestore

## Setup

### Web
1. `cd web`
2. `npm install`
3. Copy `.env.example` to `.env.local` and set Firebase values.
4. `npm run dev`

### Edge (ESP32 - Recommended)
1. `cd esp32`
2. Copy `config.example.h` -> `config.h`
3. Set Wi-Fi + Firebase + machine credentials in `config.h` (use machine email that starts with `machine-`)
4. Open `gloop_esp32/gloop_esp32.ino` in Arduino IDE
5. Upload to ESP32-S3
6. Deploy latest Firestore rules: `firebase deploy --only firestore:rules`

### Edge (Raspberry Pi - Legacy)
1. `cd edge`
2. `python -m venv .venv`
3. Activate venv and install deps: `pip install -r requirements.txt`
4. Export service account path and machine config env vars (optional defaults included)
5. `python rvm_service.py`
