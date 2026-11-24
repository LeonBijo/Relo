# RELO Chrome Extension (Desktop Receiver Milestone)

RELO lets a phone control YouTube playback in one designated desktop browser tab. This milestone implements the local desktop receiver and **Local receiver test** controls in a Chrome Manifest V3 extension.

## Build & Verify (CLI)

```bash
cd "apps/extension"
npm install
npm run typecheck
npm test
npm run build
```

The production unpacked extension is output to `apps/extension/dist/` with:
- `manifest.json` (MV3)
- `popup.html` + bundled React/Tailwind/Roboto assets
- `background.js` (service worker)
- `content.js` (YouTube content script)
- `icons/` and `fonts/OFL.txt`

## Manifest Permissions

- `tabs`: Query open YouTube tabs for designation, create/update the designated receiver tab, and detect tab closure or navigation away from YouTube.
- `storage`: Persist the designated `tabId` and `lastCompletedVideoId` across popup reopenings and service-worker suspension.
- `scripting`: Inject `content.js` into an already-open YouTube tab if the extension was loaded or reloaded after the tab was opened.
- `host_permissions` (`https://www.youtube.com/*`, `https://youtube.com/*`, `https://m.youtube.com/*`): Scope content-script injection and tab access strictly to YouTube.

## Loading in Dia (macOS)

Verified installed browser: **Dia 1.58.1 (build 91403)** (`/Applications/Dia.app`, Chromium-based via `ArcCore.framework`).

1. Open **Dia**.
2. Navigate to `dia://extensions` (or `chrome://extensions` — Dia maps Chromium's extensions manager).
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select:
   ```text
   <workspace-root>/apps/extension/dist
   ```
5. If Dia or macOS prompts for folder access (e.g., *"Dia would like to access files in your Documents folder"*), click **Allow**.
6. Confirm **RELO** appears in the extensions list with no manifest errors, and pin it to the toolbar if desired so the popup is easy to open.

## Live Browser Verification Checklist (Dia)

Run these checks manually in Dia after loading `apps/extension/dist`:

1. **Tab selection (multiple YouTube tabs)**
   - Open 2+ YouTube tabs (e.g., two different videos).
   - Open the RELO popup and verify the **Designated YouTube tab** dropdown lists each YouTube tab with its title, `Active` / `Audio` tags, and `#tabId`.
   - Select one tab and confirm the status badge turns **Connected** (green).
2. **Link validation & tab reuse**
   - Test an invalid or lookalike link (e.g., `https://evilyoutube.com/watch?v=dQw4w9WgXcQ` or `http://youtube.com/watch?v=dQw4w9WgXcQ`) and verify an inline error appears without opening or changing any tab.
   - Paste a valid `youtu.be/ID` or `youtube.com/shorts/ID` link and click **Play video**. Confirm the designated tab loads `https://www.youtube.com/watch?v=<ID>` while other tabs remain untouched.
   - Paste a second valid link and click **Play video**. Confirm the **same** designated tab is reused (no duplicate tab created).
   - Clear designation (✕), paste a valid link, and click **Play video**. Confirm one new YouTube tab is created and automatically designated.
3. **Playback controls & two-way synchronization**
   - In **Local receiver test**, test Play/Pause, Rewind 10 s, Forward 10 s, seek slider scrubbing, and Volume/Mute.
   - Pause, play, seek, or change volume directly on the YouTube page and verify the popup updates to match.
   - Let a short video finish (or seek to the end) and verify the popup shows **Completed** / `Video completed · Ready for next queued item`.
4. **Popup reopening & service-worker persistence**
   - Close the popup, wait a few seconds, and reopen it. Confirm the designated tab and current playback state are restored.
5. **Receiver closure, navigation, and missing-player states**
   - Navigate the designated tab to `https://www.youtube.com/` (homepage): confirm the popup reports **No player** (`missing_player`).
   - Open a fresh YouTube video without clicking inside the page if autoplay is blocked: confirm clicking Play in the popup surfaces the autoplay-blocked guidance.
   - Navigate the designated tab away from YouTube (e.g., `https://example.com`): confirm designation clears with an explanatory notice.
   - Re-designate a YouTube tab and close it: confirm designation clears and reports that the tab was closed.
