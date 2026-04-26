# 11 — Known Issues

## Purpose
Track current risks/defects prioritized by severity using repository evidence.

## Status
Last updated: 2026-04-25

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

### 11) Group messaging: search bar targeting (simple macOS flow)
- **Status:** Working — simple flow restored.
- **The flow (macOS-only, what actually works on the user's machine):**
  1. Activate WhatsApp + press Escape twice to dismiss any stale dialog.
  2. `Cmd+F` to open WhatsApp's search bar.
  3. Type the group name; wait for results to populate.
  4. Down arrow ×2 + Enter to select and open the first result.
  5. Paste the message via the clipboard (`Cmd+V` — handles emoji/unicode safely).
  6. Press Enter to send (skipped on dry-run); optional `Cmd+W` to close.
- **History (do not regress again):**
  - A previous iteration tried to be cross-version-portable by adding a 3-tier AX-path → `Cmd+K` → `Cmd+F` fallback plus a defensive Cmd+A + Delete clear-field step plus `AXFocusedUIElement` diagnostic probes. This added latency and broke the working keystroke sequence on the user's environment. The over-engineering was reverted.
  - The simple `Cmd+F` keystroke is what works on macOS WhatsApp Desktop — there is no need for AX paths or the `Cmd+K` global-search shortcut here.
- **Diagnostics:** Each phase logs `[phase N]` so the dev console traces which step failed. This is intentional and should stay; it does not interfere with the keystroke sequence.

### 14) "Test Send" toast always reported "Schedule not found"
- **Status:** FIXED
- **Symptom:** Clicking the "Test Send" button on any existing schedule produced the toast "Schedule not found", even when the schedule was clearly visible in the Dashboard.
- **Root cause:** Commit `c00c35d` ("smart scheduling safeguards") introduced a serialized send queue and routed `executeJob` through it whenever `enable_send_queue=1` (the default). The queue is fire-and-forget, so when called from `testSendSchedule`, `executeJob` enqueued the send and **returned `null` synchronously**. The IPC handler at `electron/ipc/schedule.ipc.ts:122` then collapsed any `null` return into the literal string `'Schedule not found'`. The actual send still proceeded via the queue and wrote a real `run_log`, but the user only saw the misleading toast.
- **Fixes:**
  1. Added a `bypassQueue` parameter to `executeJob`. `testSendSchedule` now passes `bypassQueue=true` so the manual test path falls through to the inline `performSend(...)` call and returns a real `RunLog`. Scheduled cron triggers continue to use the queue exactly as before.
  2. The IPC `schedule:testSend` handler now does a `db.getScheduleById(id)` existence check first. If the schedule truly doesn't exist → `'Schedule not found'`. If it exists but `testSendSchedule` still returned `null` (a real mutex/race) → `'Send is already in progress for this schedule — check the Logs tab'`.
  3. Per-step IPC logging (`testSend invoked`, `does not exist`, `returned null`, `→ status`) so the dev console shows the exact reason for any future failure.
- **Regression coverage:** `tests/scheduler-testsend.test.ts` locks both the source structure (`bypassQueue` parameter, queue branch gated on `!bypassQueue`, IPC existence check) and the runtime behavior (`testSendSchedule` returns a non-null `RunLog` with `enableSendQueue=true`; does not call `enqueueSend`; scheduled timer callbacks still take the queue path).

### 13) Smart-scheduling call-aware hold: false positives blocked all sends
- **Status:** FIXED
- **Symptom:** After commit c00c35d ("smart scheduling safeguards") shipped, group sends started silently failing in normal use. Holds were invisible in the Logs UI for up to `callMaxWaitMs` (default 30 min).
- **Root causes (compounding):**
  1. `WhatsApp` was on the `CALL_APPS` list. WhatsApp Desktop is the very app we send through, so it is *always* running during a send. Combined with system-wide `pmset cnt_audio_in_use > 0` (Bluetooth headset mic, Voice Memos, browser tab with mic permission, etc.), this produced `inCall: true` for every send.
  2. `pmset` audio-in detection had no app correlation — any system audio-input assertion satisfied the "audio active" condition.
  3. The first call-hold path in `executeJob` only called `log.info`; no `run_log` row was inserted, so the user saw nothing in the Logs tab while sends sat held.
- **Fixes:**
  1. Removed `WhatsApp` from `CALL_APPS`. WhatsApp voice/video calls are still detected via the `CALL_WINDOW_PATTERNS` list (`"is calling"`, `"Ongoing call"`, `"Call with"`).
  2. Tightened `inCall` rule: `inCall = matchedWindow != null OR (audioInUse AND frontApp ∈ runningCallApps)`. Audio-in alone with a non-call front app no longer fires.
  3. `executeJob` writes a `skipped` `run_log` row on the first call-hold ("Held: call in progress …") and another when the hold resolves ("Resumed after Xs call hold") so the lifecycle is visible immediately.
  4. Added a "Test call detection" button in Settings (Smart Scheduling section) that calls `system:probeCallState` and surfaces the full diagnostic payload (verdict, reason, frontApp, runningCallApps, audioInUse).

### 12) Group messaging: inherent UI automation fragility
- **Status:** Known limitation (inherent to AppleScript approach)
- Group sends require 6-phase UI automation (~5+ seconds of active UI control).
- **AX path fragility:** Element paths (`text field 1 of group 1 of window 1`) are WhatsApp-version-dependent. May break on WhatsApp updates.
- **Wrong-chat risk:** No post-selection verification. If search returns a contact instead of the group, message goes to the wrong recipient.
- **Timing dependency:** Fixed `sendDelayMs` wait (3000ms) between search typing and result selection. Fails if WhatsApp is slow to populate results.
- **Reliability ceiling:** ~85-90% for personal use. Cannot guarantee correct group targeting.
- **Mitigations in place:** feature-flagged (off by default), auto dry-run for new group schedules, staggered catch-ups (8s apart), structured phase logging.
- **Recommended next hardening step:** add post-selection chat verification (read AX chat header, compare to group name, abort on mismatch).

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

### 9) Dark mode styling is incomplete
- **Status:** Partially addressed — design debt remains
- Theme picker added to Settings (system/light/dark) and persisted in DB.
- Tailwind dark mode enabled, but dark token overrides (colors, borders, backgrounds) are not fully defined.
- Light mode is fully styled; dark mode will show unstyled/inverted elements.

### 10) Packaging/signing readiness unclear
- **Status:** Improved
- `asarUnpack` configured for `better-sqlite3` native module.
- `extraResources` configured for tray/app icons.
- Resource paths resolve correctly in both dev and packaged builds.
- Code signing/notarization still not configured (acceptable for personal distribution).

## Remaining risks
- Force-killed process = lost schedules until relaunch.
- AppleScript automation depends on WhatsApp Desktop UI stability.
- Group messaging can send to wrong chat if group name matches a contact name (no verification yet).
- No structured reliability SLO documented for users.
