<div align="center">
  <img src="RELO_Antigravity_First_Task/RELO_Logo_Assets/relo-wordmark-dark.png" alt="RELO Logo" width="260" />

  <h1>RELO — YouTube Bridge</h1>
  <p><strong>Turn your phone into a real-time remote control for desktop YouTube.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/status-beta-ff0033?style=for-the-badge" alt="Status: Beta" />
    <img src="https://img.shields.io/badge/node-22%2B-181818?style=for-the-badge&logo=node.js" alt="Node 22+" />
    <img src="https://img.shields.io/badge/platform-Web%20%7C%20Android%20%7C%20Chrome-262626?style=for-the-badge" alt="Platform" />
  </p>
</div>

---

## The Story — Why RELO?

YouTube is built for a keyboard and mouse on desktop, and for a touchscreen on mobile—but **when you're watching YouTube on your laptop, desktop monitor, or TV-connected browser from across the room**, neither works well:

- You're settled in on the couch or bed, and an ad, loud volume spike, or long intro hits—and your mouse is across the room.
- You have three YouTube tabs open (a podcast, a music mix, and a tutorial) and want to switch tabs, scrub back 15 seconds, toggle captions, or search for the next video **without getting up**.
- Existing remote apps either require installing heavy desktop agents, forcing you onto the same OS ecosystem, or mirroring your entire screen just to click Pause.

**RELO solves this super-niche problem cleanly** by turning your phone into a dedicated, zero-clutter YouTube remote for your desktop Chrome browser:

1. **Open the Chrome Extension** on your desktop to generate a **6-digit pairing PIN**.
2. **Open RELO on your phone** (mobile web app or native Android APK) and enter the PIN.
3. **Confirm pairing once**—and your phone instantly becomes a live hardware-style YouTube controller for playback, search, volume, captions, and tab switching.

### Pictorial Storyline

![RELO — 4-Panel Comic Storyline](RELO_Antigravity_First_Task/RELO_Logo_Assets/relo-storyline-comic.jpg)

```mermaid
flowchart LR
    S1["1. Across the Room\nWatching YouTube on Desktop/TV\nMouse & keyboard out of reach"] --> S2["2. Pair in Seconds\nOpen Chrome Extension for 6-digit PIN\nEnter PIN in RELO Phone/Android App"]
    S2 --> S3["3. Approve & Link\nConfirm pairing once\nLive WebSocket Relay locks in"]
    S3 --> S4["4. Full Remote Control\nPlay/Pause, Seek, Volume, Captions\nSearch, Queue & Switch YouTube Tabs"]
```

### Where RELO Shines
- **Couch / Bed Viewing**: Pause, scrub, mute, or toggle fullscreen on your monitor or TV-connected PC without touching a mouse.
- **Multi-Tab Control**: See every open YouTube tab on your desktop, switch which tab you're controlling, bring a tab into focus, or close finished tabs from your phone.
- **Hands-Free Queueing**: Search YouTube with live autocomplete right from your phone and launch the next video directly into your desktop browser.

---

## Architecture

```mermaid
flowchart LR
    Phone["Phone Remote\n(Web / Android APK)\napps/web"] <-->|"HTTP + WebSocket\n:8787"| Relay["Relay API\n(Pairing, Search, Sync)\nservices/api"]
    Relay <-->|"WebSocket\nCommands & State"| Ext["Chrome Extension\n(Manifest V3)\napps/extension"]
    Ext <-->|"Content Script"| YT["Desktop YouTube Tabs"]
```

| Package | Path | Role |
| :--- | :--- | :--- |
| **Relay API** | `services/api` | Node.js HTTP + WebSocket server (`:8787`) managing 6-digit PIN pairing, authorization, YouTube Data API search/autocomplete, and live state sync. |
| **Phone & Android App** | `apps/web` | React 19 + Vite + TypeScript mobile remote (`:5173`) wrapped with Capacitor (`apps/web/android`) to produce `RELO-debug.apk`. |
| **Chrome Extension** | `apps/extension` | Manifest V3 extension that connects to the relay, tracks open YouTube tabs, and executes playback and tab commands. |

---

## Features

- **6-Digit PIN Pairing & Authorization**: Explicit desktop confirmation with favorite-device support so trusted phones reconnect cleanly.
- **Full Playback Control**: Play/pause, interactive seek bar, skip forward/backward, volume & mute, playback speed, captions, and fullscreen toggle.
- **YouTube Search & Autocomplete**: Search YouTube directly from your phone and launch videos onto your active or selected desktop tab.
- **Multi-Tab Management**: Inspect all open YouTube tabs on your desktop, switch the active control target, focus a tab, or close tabs remotely.
- **Android APK Ready**: Custom centered adaptive launcher icon, sticky top status header, and `RELO-debug.apk` Gradle build output.

---

## Design System & Brand Assets

RELO uses a dark-first, high-contrast media interface inspired by theater and remote-control ergonomics.

### Logo Lockup & Marks

| Mark | Preview | Usage |
| :--- | :---: | :--- |
| **Full Wordmark** | <img src="RELO_Antigravity_First_Task/RELO_Logo_Assets/relo-wordmark-dark.png" alt="RELO Wordmark" width="140" /> | Primary header lockup (`relo-wordmark-dark.png` / `relo-wordmark-transparent.png`). |
| **Compact Symbol** | <img src="RELO_Antigravity_First_Task/RELO_Logo_Assets/relo-symbol-dark.png" alt="RELO Symbol" width="72" /> | Android adaptive launcher icon and compact placements (`relo-symbol-dark.png`). |
| **Extension Icon** | <img src="RELO_Antigravity_First_Task/RELO_Logo_Assets/icons/relo-icon-128.png" alt="RELO Icon" width="48" /> | Browser toolbar and favicon slots (`16`, `32`, `48`, `128` px). |

See [`RELO_LOGO_GUIDELINES.md`](RELO_Antigravity_First_Task/RELO_Logo_Assets/RELO_LOGO_GUIDELINES.md) for full asset usage rules.

### Color Palette & Tokens (`apps/web/src/theme.css`)

| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--background` | `#080808` | App canvas and sticky header backdrop |
| `--card` / `--popover` | `#181818` | Elevated control surfaces and device cards |
| `--primary` | `#ff0033` | Primary brand red, active states, and live indicators |
| `--secondary` | `#262626` | Secondary buttons and pill controls |
| `--muted` | `#242424` | Subtle containers and inactive tracks |
| `--muted-foreground` | `#b8b8bd` | Secondary labels and timestamps |
| `--border` | `#414141` | Hairline dividers and card outlines |
| `--ring` | `#9cc4ff` | Keyboard and accessibility focus ring |

- **Typography**: `Roboto` variable font (`apps/web/src/fonts/Roboto-Variable.ttf`, weights `100–900`).
- **Border Radii**: `6px` (`sm`), `8px` (`md`), `12px` (`lg`), `16px` (`xl`).

---

## Prerequisites

- **Node.js `22+`** and `npm`
- **Google Chrome** (for loading the unpacked extension)
- **YouTube Data API v3 Key** (optional, for YouTube search in `services/api`)
- **Android Studio / JDK 21 + Android SDK** (only needed for building the Android APK)

---

## Setup & Running Locally

### 1. Relay Server (`services/api`)

```bash
cd services/api
cp .env.example .env
# Add your YOUTUBE_API_KEY in .env
npm install
npm start
```

- Runs on `http://localhost:8787` (HTTP + WebSocket).
- Runtime pairing state is saved locally in `services/api/data/relay-state.json` (excluded from Git).

### 2. Chrome Extension (`apps/extension`)

```bash
cd apps/extension
npm install
npm run build
```

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Click **Load unpacked** and choose `apps/extension/dist`.
3. Open the RELO extension popup to connect to the relay and generate your pairing PIN.

### 3. Phone Web App (`apps/web`)

```bash
cd apps/web
npm install
npm run dev
```

- Runs on `http://0.0.0.0:5173` so any phone on the same Wi-Fi network can access it.

### 4. Android APK (`apps/web/android`)

```bash
cd apps/web
npm run android:sync
cd android
./gradlew assembleDebug
```

- Outputs `apps/web/android/app/build/outputs/apk/debug/RELO-debug.apk`.
- Or run `npm run android:open` from `apps/web` to open the project in Android Studio.

---

## Testing & Verification

```bash
# Relay API
cd services/api && npm run typecheck && npm test

# Chrome Extension
cd apps/extension && npm run typecheck && npm test

# Phone Web App
cd apps/web && npm run typecheck && npm run build
```

---

## Repository Hygiene

- Secrets (`services/api/.env`), runtime pairing state (`services/api/data/`), signing keys (`*.keystore`, `*.jks`), `node_modules/`, `dist/`, and compiled `*.apk` artifacts are excluded via `.gitignore`.
- Use [`services/api/.env.example`](services/api/.env.example) as a template when setting up a new environment.
