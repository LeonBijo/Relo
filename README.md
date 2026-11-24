# RELO — YouTube Bridge

RELO is a cross-device YouTube remote control system. Pair your phone (via web browser or Android APK) with your desktop Chrome browser to search YouTube, control playback, and manage open YouTube tabs over a local or hosted WebSocket relay.

## Architecture

| Package | Path | Description |
| :--- | :--- | :--- |
| **Relay API** | `services/api` | Node.js HTTP + WebSocket relay server (`:8787`) handling pairing PINs, authorization, YouTube search/autocomplete, and real-time command/state sync. |
| **Phone Remote & Android App** | `apps/web` | React + Vite + TypeScript mobile UI (`:5173`) wrapped with Capacitor (`apps/web/android`) to build `RELO-debug.apk`. |
| **Chrome Extension** | `apps/extension` | Chrome Manifest V3 extension that connects to the relay, lists open YouTube tabs, and executes playback/tab commands. |

---

## Features

- **6-Digit PIN Pairing**: Pair a phone remote to a desktop receiver with explicit confirmation and favorite-device support.
- **Playback Controls**: Play/pause, seek bar, skip forward/back, volume & mute, playback speed, captions, and fullscreen toggle.
- **YouTube Search & Autocomplete**: Search YouTube directly from the phone and play results on the active or selected desktop tab.
- **Tab Management**: View all open YouTube tabs on the paired desktop, switch active target tab, focus a tab, or close a tab remotely.
- **Mobile & Android Ready**: Sticky top header with live connection/authorization status and custom centered RELO launcher icon.

---

## Prerequisites

- **Node.js** `22+` (uses native `--experimental-strip-types` / Node test runner for TypeScript tests) and `npm`
- **Google Chrome** (for loading `apps/extension`)
- **YouTube Data API v3 Key** (optional, for YouTube search in `services/api`)
- **Android Studio / JDK 21 + Android SDK** (only needed to compile the Android APK)

---

## Setup & Running Locally

### 1. Relay Server (`services/api`)

```bash
cd services/api
cp .env.example .env
# Edit .env and add your YOUTUBE_API_KEY
npm install
npm start
```

- Runs on `http://localhost:8787` (HTTP + WebSocket).
- Runtime pairing state is stored locally in `services/api/data/relay-state.json` (gitignored).

### 2. Chrome Extension (`apps/extension`)

```bash
cd apps/extension
npm install
npm run build
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/dist`.
4. Open the RELO extension popup to connect to your relay server and pair with your phone.

### 3. Phone Web App (`apps/web`)

```bash
cd apps/web
npm install
npm run dev
```

- Runs on `http://0.0.0.0:5173` so phones on the same Wi-Fi network can open it directly.

### 4. Android APK (`apps/web/android`)

```bash
cd apps/web
npm run android:sync
cd android
./gradlew assembleDebug
```

- Output APK: `apps/web/android/app/build/outputs/apk/debug/RELO-debug.apk`
- You can also open `apps/web/android` in Android Studio (`npm run android:open`) to run on a device or generate a signed release bundle/APK.

---

## Scripts & Testing

Run typechecks and unit tests for each workspace:

```bash
# Relay API
cd services/api && npm run typecheck && npm test

# Chrome Extension
cd apps/extension && npm run typecheck && npm test

# Phone Web App
cd apps/web && npm run typecheck && npm run build
```

---

## Repository Notes

- Sensitive files (`services/api/.env`, `services/api/data/`, `*.keystore`, `*.jks`) and build artifacts (`node_modules/`, `dist/`, `*.apk`, Android `build/` and `.gradle/`) are excluded via `.gitignore`.
- Copy `services/api/.env.example` to `services/api/.env` when setting up a fresh clone.
