# Gloop - Smart Reverse Vending Machine

This repository contains:
- `web/`: Next.js (App Router) frontend with HeroUI, Firebase Auth, and Firestore realtime machine-state UI.
- `edge/`: Raspberry Pi Python service for bottle validation, solenoid control, and scoring while session is active.

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
- Python 3.10+
- Firebase project with Authentication and Firestore

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
