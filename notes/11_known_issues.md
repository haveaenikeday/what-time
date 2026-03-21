# 11 — Known Issues

## Purpose
Track current risks/defects prioritized by severity using repository evidence.

## Status
Last updated: 2026-03-21 (production hardening sweep)

## Critical

### 1) Scheduling stops when app is not running
- **Status:** Mitigated
- Scheduler lives in main-process memory (`node-schedule` map).
- **Mitigations now in place:**
  - Window hides on close (scheduler stays running via tray icon)
  - Start-at-login setting (`app.setLoginItemSettings` with `openAsHidden`)
  - Sleep/wake resync rebuilds all jobs and catches missed runs
  - Single instance lock prevents duplicate processes
  - Uncaught exception handlers prevent silent crashes
- **Remaining risk:** if process is force-killed, schedules are lost until next launch.

### 2) Automation requires unlocked/permissioned macOS session
- **Status:** Known limitation (inherent to AppleScript approach)
- Send path relies on System Events keystroke automation.
- Screen lock detection skips sends gracefully (logged as `skipped`).
- Accessibility permission check available in Settings tab.

### 3) Contract mismatch for test send
- **Status:** FIXED
- Backend `testSend` handler now converts `RunLog` to `SendResult` format at the IPC boundary.
- Frontend receives `{ success, error?, dryRun }` as expected.

## Medium

### 4) No retry/backoff on failed sends
- **Status:** FIXED
- Exponential backoff implemented: 10s → 30s → 90s (configurable `max_retries`).
- Non-retryable errors (Accessibility, screen lock) excluded from retry.
- Retry metadata tracked in `run_logs` (retry_attempt, retry_of columns).

### 5) Recurring missed-run replay not implemented
- **Status:** FIXED
- `detectAndCatchUpMissedRuns()` fires one immediate catch-up execution per missed recurring schedule on startup/wake.
- Uses `getMostRecentExpectedFire()` to compute what should have fired.

### 6) Duplicate schema source drift risk
- **Status:** Resolved
- Single source of truth is the `SCHEMA` constant in `db.service.ts`.
- No separate `schema.sql` file exists — migrations use ALTER TABLE with try/catch.

### 7) Settings update accepts arbitrary key strings
- **Status:** FIXED
- `VALID_SETTINGS_KEYS` whitelist enforced in `updateSetting()`.
- Invalid keys throw an error.

## Low

### 8) No automated tests in repository
- **Status:** FIXED
- 19+ tests across scheduler logic, IPC contracts, and type mapping.
- IPC input validation tests added.

### 9) Dark mode config is incomplete
- **Status:** Known — design debt
- Tailwind dark mode enabled but no dark token overrides defined.
- Low priority for personal use.

### 10) Packaging/signing readiness unclear
- **Status:** Improved
- `asarUnpack` configured for `better-sqlite3` native module.
- `extraResources` configured for tray/app icons.
- Resource paths resolve correctly in both dev and packaged builds.
- Code signing/notarization still not configured (acceptable for personal distribution).

## Remaining risks
- Force-killed process = lost schedules until relaunch.
- AppleScript automation depends on WhatsApp Desktop UI stability.
- No structured reliability SLO documented for users.
