# 09 — Dev Setup

## Purpose
Provide a reliable local setup guide tied to the current repo.

## Status
- Last updated: 2026-03-21
- **Confirmed from code**: scripts, dependencies, packaging config, and runtime prerequisites.

## Confirmed from code

### Runtime prerequisites
- macOS required (AppleScript + System Events + Contacts integration).
- Node.js 18+ recommended.
- WhatsApp Desktop installed and logged in.
- Accessibility permission needed for live sends.
- Contacts permission optional but required for contact search.

### Install and run
```bash
npm install
npm run rebuild
npm run dev
```

### Test and verify
```bash
npm run test
npm run test:watch
```

### Build/package
```bash
npm run build
npm run dist
npm run dist:dmg
```

### Key scripts (`package.json`)
- `dev`: `electron-vite dev`
- `build`: `electron-vite build`
- `preview`: `electron-vite preview`
- `dist`: build + mac packaging
- `dist:dmg`: build + DMG packaging
- `test`: `vitest run`
- `test:watch`: `vitest`
- `postinstall`: `electron-builder install-app-deps`
- `rebuild`: `electron-rebuild -f -w better-sqlite3`

### Environment variables
- **Confirmed from code**: no app-required `.env` variables for core behavior.
- Runtime configuration is persisted in SQLite settings table.

### Paths and aliases
- Renderer alias `@ -> src`.
- Shared alias `@shared -> shared` for node/renderer.
- DB path resolves under Electron `userData`, not project root.

## Important details
- `better-sqlite3` is native; rebuild is required after Electron/dependency updates.
- App close hides to tray in normal usage; explicit quit is needed to stop scheduler.
- Start-at-login behavior is controlled by persisted `open_at_login` setting.

## Open issues / gaps
- No automated preflight command for checking permissions/WhatsApp readiness.
- No lint script configured yet.

## Recommended next steps
1. Add a `preflight` dev script (permissions + app presence checks).
2. Add lint/format scripts if team workflow expands.
3. Keep setup docs synced with script changes.
