# Ledger — Trading Journal (free, on-device, installable)

Everything lives in your phone's browser storage. No account, no server,
no monthly cost. Screenshots and trade data never leave your device.

## Install on your phone (free, ~5 minutes)

A PWA needs to be served over HTTPS to be installable — this is a browser
requirement, not a cost. The two easiest free options:

### Option A — GitHub Pages (recommended, fully free forever)
1. Create a free GitHub account if you don't have one.
2. Create a new repository, e.g. `ledger-journal`.
3. Upload all files in this folder (index.html, style.css, app.js,
   manifest.json, service-worker.js, icon-192.png, icon-512.png).
4. Go to **Settings → Pages**, set source to the `main` branch, root folder.
5. GitHub gives you a URL like `https://yourname.github.io/ledger-journal/`.
6. Open that URL on your phone in Chrome (Android) or Safari (iPhone).
7. Android Chrome: tap the ⋮ menu → **Add to Home screen** / **Install app**.
   iPhone Safari: tap the Share icon → **Add to Home Screen**.
8. It now sits on your home screen with its own icon and opens full-screen,
   like a normal app — and works offline after the first load.

### Option B — Netlify Drop (no account needed, 1 minute)
1. Go to https://app.netlify.com/drop on a computer.
2. Drag this whole folder onto the page.
3. You get an instant HTTPS URL — open it on your phone and install as above.

Both are free with no card required, and fine for personal/solo use.

## Using it locally without hosting (quickest to just try)
You can open `index.html` directly on a computer to try the UI immediately.
Home-screen install and offline mode need HTTPS hosting (Option A or B above)
to work on an actual phone.

## Your data
- Stored in the browser's IndexedDB, on-device only.
- **Back it up**: Settings → Export backup (.json) — do this regularly.
  Clearing browser data, reinstalling, or switching phones wipes local
  storage, and the export is your only copy.
- Import a backup from Settings → Import backup on any device to restore it.

## About the "AI" insights
These are computed entirely on your device from your own trade history —
win rate by emotion tag, mistake-cost tracking, best/worst setups,
overtrading and revenge-trading pattern detection, etc. No API calls, no
cost, no data sent anywhere. If you later want true LLM-generated
commentary, that needs a paid API key plus a small backend (to avoid
exposing the key in the browser) — happy to help set that up when you're
ready to spend a little.
