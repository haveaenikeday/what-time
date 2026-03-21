# 10 — Deployment

## Purpose
Document how this project is built and distributed.

## Status
Last updated: 2026-03-21

## Build & Package

### Prerequisites
- macOS (Apple Silicon or Intel)
- Node.js 18+
- npm dependencies installed (`npm install`)

### Commands
```bash
# Development
npm run dev

# Build (compile main + preload + renderer)
npm run build

# Package as DMG (arm64)
npm run dist:dmg

# Or build + package in one step
npm run dist
```

### What `dist` produces
- `dist/WA Scheduler-{version}-arm64.dmg` — drag-to-Applications installer
- `dist/mac-arm64/WA Scheduler.app` — standalone app bundle

### Packaging config
- **appId:** `com.veer.wa-scheduler`
- **productName:** `WA Scheduler`
- **Native modules:** `better-sqlite3` excluded from ASAR via `asarUnpack`
- **Resources:** tray icons and app icon copied via `extraResources`
- **Single instance:** enforced via `app.requestSingleInstanceLock()`

## Post-Install Requirements
1. **WhatsApp Desktop** installed and logged in
2. **Accessibility permission** granted (System Settings > Privacy > Accessibility)
3. **Contacts permission** (optional) for contact search

## Runtime Behavior
- App starts hidden if launched at login (`openAsHidden: true`)
- Window close hides to tray (scheduler keeps running)
- Tray icon provides Show/Quit controls
- Sleep/wake triggers full scheduler resync
- Uncaught exceptions logged but don't kill the process

## Smoke Test Checklist
After packaging, verify on a clean install:
1. DMG opens and app drags to /Applications
2. App launches without errors
3. Tray icon appears in menu bar
4. Create a schedule (dry-run mode)
5. Verify schedule fires at expected time
6. Check Activity tab shows execution log
7. Close window — tray icon persists, scheduler still runs
8. Quit via tray menu — app exits cleanly

## Known Limitations
- Code signing/notarization not configured (personal distribution only)
- No auto-update channel
- arm64 only (add `x64` to `mac.target.arch` for Intel support)
