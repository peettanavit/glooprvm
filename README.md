# Gloop — Smart Reverse Vending Machine

Gloop is an IoT reverse vending machine (RVM) that rewards users with points for recycling bottles. An ESP32-S3 runs the machine loop, captures images via OV5640, and syncs state to Firebase in real time. A Next.js web app lets users track their session and redeem rewards.

## Repository Structure

| Directory | Description |
|-----------|-------------|
| `web/` | Next.js (App Router) frontend — Firebase Auth, Firestore real-time UI, HeroUI |
| `esp32/` | ESP32-S3 firmware — machine loop, OV5640 camera, Firestore & Cloud Storage sync |
| `functions/` | Firebase Cloud Functions — reward redemption, score aggregation |

## Web Routes

| Route | Description |
|-------|-------------|
| `/login` | Sign in / register with Firebase Auth |
| `/dashboard` | Live machine status and session score |
| `/summary` | Session summary after recycling |
| `/profile` | Total points and recent session history |
| `/rewards` | Rewards catalog and redemption |

## Firestore Schema

**Collection:** `machines` → **Document:** `Gloop_01`

| Field | Type | Values |
|-------|------|--------|
| `status` | string | `IDLE` \| `READY` \| `PROCESSING` \| `REJECTED` \| `COMPLETED` |
| `current_user` | string | Firebase UID of active user |
| `session_score` | number | Points earned in current session |

## Prerequisites

- Node.js 18+ and npm
- Arduino IDE 2.x with ESP32 board package installed
- Firebase project with Authentication, Firestore, and Cloud Storage enabled
- Firebase CLI (`npm install -g firebase-tools`)

## Setup

### Web App

```bash
cd web
npm install
cp .env.example .env.local   # fill in your Firebase config
npm run dev
```

### ESP32 Firmware

```bash
cd esp32
cp config.example.h config.h  # fill in Wi-Fi, Firebase, and machine credentials
```

> Machine accounts must use an email starting with `machine-`.

1. Open `gloop_esp32/gloop_esp32.ino` in Arduino IDE.
2. Select **ESP32S3 Dev Module** as the target board.
3. Upload to the device.
4. Deploy Firestore security rules:

```bash
firebase deploy --only firestore:rules
```

### Firebase Functions

```bash
cd functions
npm install
firebase deploy --only functions
```
