# Gloop - Smart Reverse Vending Machine

This repository contains:
- `web/`: Next.js (App Router) frontend with HeroUI, Firebase Auth, and Firestore realtime machine-state UI.
- `edge/`: Raspberry Pi Python service for bottle validation, solenoid control, and scoring while session is active.

## Firestore Document
Collection: `machines`  
Document: `Gloop_01`

Fields:
- `status`: `IDLE | READY | PROCESSING | REJECTED | COMPLETED`
- `current_user`: string UID
- `session_score`: number

## Setup

### Web
1. `cd web`
2. `npm install`
3. Copy `.env.example` to `.env.local` and set Firebase values.
4. `npm run dev`

### Edge (Raspberry Pi)
1. `cd edge`
2. `python -m venv .venv`
3. Activate venv and install deps: `pip install -r requirements.txt`
4. Export service account path and machine config env vars (optional defaults included)
5. `python rvm_service.py`
