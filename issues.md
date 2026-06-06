# Issues Audit

## Project Intent and Artifact Map

What this is: WhatTime is a local-first macOS Electron desktop app, not a website, backend, mobile app, extension, ML project, or cloud system. The renderer is React 18 + Vite/electron-vite, the main process owns SQLite persistence, scheduling, IPC, and AppleScript automation, and packaged output is produced with electron-builder.

Problem it tries to solve: schedule WhatsApp messages from a Mac without using a cloud backend or unofficial WhatsApp API. Contact sends use `whatsapp://send` plus AppleScript Enter automation. Group sends use WhatsApp UI search and clipboard paste automation.

Primary user/operator: a single local macOS user who keeps the app running in the background, grants Accessibility permission, optionally grants Contacts permission, and trusts the app to fire scheduled sends while the Mac is unlocked and WhatsApp Desktop is available.

Main workflows:

- Create, edit, duplicate, pause/resume, delete, and test schedules from `src/pages/Dashboard.tsx`.
- View planned send dates from `src/pages/Calendar.tsx`.
- Review send outcomes from `src/pages/Logs.tsx`.
- Configure permissions, retries, dry-run, login item, theme, group scheduling, call-aware holds, and send queue behavior from `src/pages/Settings.tsx`.
- Main-process scheduling, catch-up, retry, and queue behavior lives in `electron/services/scheduler.service.ts` and `electron/services/sendQueue.ts`.
- WhatsApp and Contacts automation lives in `electron/services/whatsapp.service.ts`, `electron/ipc/contacts.ipc.ts`, and `electron/utils/applescript.ts`.
- Local data source of truth is the SQLite schema and mappers in `electron/services/db.service.ts`; shared renderer/main contracts are intended to be `shared/types.ts`.

Major source-of-truth files:

- Product/docs: `README.md`, `CLAUDE.md`, `notes/00_overview.md`, `notes/03_architecture.md`, `notes/05_database_schema.md`, `notes/06_api_contracts.md`, `notes/07_user_flows.md`, `notes/10_deployment.md`, `notes/11_known_issues.md`, `notes/13_prompt_context.md`, `notes/14_ux_audit.md`.
- Build/config: `package.json`, `package-lock.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.web.json`, `tsconfig.node.json`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `.gitignore`.
- Main process: `electron/main.ts`, `electron/preload.ts`, `electron/ipc/*.ipc.ts`, `electron/services/*.ts`, `electron/utils/*.ts`.
- Renderer: `src/App.tsx`, `src/contexts/ScheduleContext.tsx`, `src/hooks/*.ts`, `src/pages/*.tsx`, `src/components/*.tsx`, `src/components/ui/*.tsx`, `src/index.css`.
- Tests: `tests/*.test.ts`.
- Assets/artifacts: tracked app/docs assets live under `resources/`, `src/assets/`, and `docs/images/`. Ignored generated artifacts currently exist under `out/` and `dist/`; `node_modules/` is present locally but ignored.

Current, stale, generated, or ambiguous files:

- Current active runtime files appear to be `electron/`, `src/`, `shared/`, and `package.json`.
- `out/` and `dist/` are ignored generated artifacts. `dist/WhatTime-1.0.0-arm64.dmg` exists locally, while `out/renderer` and `out/main` have different modification times, so the local DMG should not be treated as a current source of truth without rebuilding.
- Several notes are stale: `notes/02_design_system.md`, `notes/11_known_issues.md`, `notes/14_ux_audit.md`, and `notes/01_features.md` still claim dark tokens are missing even though `src/index.css` defines `.dark` tokens.
- `CLAUDE.md` says `notes/` has 17 design docs, but the repository currently has 15 markdown files in `notes/`.
- `tests/ipc-validation.test.ts` duplicates validation logic instead of importing the real handler logic, making it a secondary source of truth.

Architectural assumptions:

- No cloud backend, no account system, no HTTP API, no auth/RBAC, no Supabase/RLS, and no multi-user model.
- Scheduling is process-local. If Electron is not running, schedules cannot fire.
- Send correctness depends on a live, unlocked macOS UI session and the current WhatsApp Desktop UI.
- The database stores message content locally in plaintext SQLite.
- Renderer access to privileged functionality is intentionally through `window.api`, but the IPC surface is broad because this is a desktop app.
- Build and release are local/manual; no CI or release workflow exists in the repo.

## Critical Issues

No evidence of Critical issues found in this pass.

## High Issues

### H-1 - The advertised typecheck script gives a false green while real source configs fail

- Severity: High
- Category: Maintainability and Testing; Deployment and Operational Risks
- Location: `package.json:15`, `tsconfig.json:1`, `tsconfig.json:2`, `tsconfig.json:3`, `tsconfig.web.json:18`, `tsconfig.node.json:18`, `src/hooks/useSettings.ts:5`, `electron/ipc/settings.ipc.ts:80`, `electron/services/scheduler.service.ts:744`, `electron/services/scheduler.service.ts:754`
- Issue: `npm run typecheck` runs `tsc --noEmit` against a root config that has `"files": []` and project references, but without `tsc -b` it did not typecheck the referenced web/node projects during this audit.
- Evidence: `npm run typecheck` exited successfully. Running the referenced configs directly exposed real errors: `src/hooks/useSettings.ts(5,7)` is missing five required `AppSettings` fields; `electron/ipc/settings.ipc.ts(80,49)` fails the `exec` overload; `electron/services/scheduler.service.ts(744,32)` and `:754:30` call `toDate()` on a value typed as `Date`.
- Impact: The release gate can pass while source code is type-invalid. `npm run build` and `npm run dist:*` also do not run tests or typecheck, so packaged artifacts can be produced from code that the actual project configs reject.
- Suggested direction: Make `typecheck` use `tsc -b --noEmit` or explicit `tsc -p tsconfig.web.json --noEmit && tsc -p tsconfig.node.json --noEmit`, then fix the reported source errors and wire typecheck into packaging.

### H-2 - The Electron runtime and tooling tree has current high-severity advisories

- Severity: High
- Category: Security and Privacy; Deployment and Operational Risks
- Location: `package.json:37`, `package-lock.json:4214`, `package-lock.json:4215`, `package-lock.json:4216`, `package-lock.json:8513`, `package-lock.json:8514`, `package-lock.json:8515`
- Issue: The app is pinned to Electron 33.4.11 and Vite 5.4.21 in the lockfile. A full `npm audit --json` reported 8 vulnerabilities total, including 5 high-severity findings, with Electron itself affected by multiple advisories.
- Evidence: `npm audit --omit=dev --json` reported no production dependency vulnerabilities, but full `npm audit --json` reported high-severity issues for `electron`, `vite`, `@xmldom/xmldom`, `lodash`, and `picomatch`. Electron is in `devDependencies`, but for an Electron app that version is the packaged runtime source.
- Impact: Treating Electron as "dev only" hides runtime security exposure. The packaged desktop app can ship an outdated browser/runtime security surface even when production-only audit appears clean.
- Suggested direction: Track Electron as a runtime release risk, upgrade Electron and affected build tooling, rebuild native modules, rerun the app smoke tests, and document a recurring audit cadence.

### H-3 - Missed recurring catch-up can mark a run handled before the recovery send actually happens

- Severity: High
- Category: Project Logic and Correctness
- Location: `electron/services/scheduler.service.ts:149`, `electron/services/scheduler.service.ts:150`, `electron/services/scheduler.service.ts:151`, `electron/services/scheduler.service.ts:153`, `electron/services/scheduler.service.ts:158`, `electron/services/scheduler.service.ts:160`
- Issue: When a recurring run is missed, the scheduler writes a skipped log and calls `updateLastFiredAt(s.id)` before the catch-up `executeJob` actually runs. Group catch-ups are delayed with `setTimeout`, making the window for loss explicit.
- Evidence: `detectAndCatchUpMissedRuns()` inserts a skipped log at line 150, updates `last_fired_at` at line 151, and only then either schedules a delayed group execution at lines 158-164 or launches contact catch-up asynchronously at lines 166-169.
- Impact: If the app quits, crashes, or is force-killed after `last_fired_at` advances but before the catch-up send completes, the next launch can believe the missed run has already been handled. The user can lose a scheduled message while seeing misleading bookkeeping.
- Suggested direction: Record "pending catch-up" separately or advance `last_fired_at` only after the recovery send path reaches a terminal outcome.

### H-4 - Group sends can target the wrong chat and still report success

- Severity: High
- Category: Correctness; Security and Privacy; UX and App Behavior
- Location: `electron/services/whatsapp.service.ts:194`, `electron/services/whatsapp.service.ts:195`, `electron/services/whatsapp.service.ts:196`, `electron/services/whatsapp.service.ts:203`, `electron/services/whatsapp.service.ts:211`, `electron/services/whatsapp.service.ts:230`, `electron/services/whatsapp.service.ts:238`, `electron/services/whatsapp.service.ts:239`, `notes/11_known_issues.md:70`, `notes/11_known_issues.md:74`, `notes/11_known_issues.md:78`
- Issue: Group delivery selects the first WhatsApp search result using Down/Down/Enter, pastes the message, presses Enter, and returns `{ success: true }` without verifying the selected chat header.
- Evidence: The group flow executes Down x2 plus Enter at lines 194-207, pastes the message at lines 209-219, sends at lines 227-237, then logs and returns success at lines 238-239. The known-issues doc explicitly says there is "No post-selection verification" and "Wrong-chat risk".
- Impact: A group name collision, search ordering change, or slow WhatsApp UI can send a private message to a contact or a different group while the app records success. This is the highest product-trust risk in the repository.
- Suggested direction: Before pasting or pressing Enter, verify the selected chat name through Accessibility data or a safer confirmation step; keep group schedules dry-run by default until verification exists.

### H-5 - Core scheduling still depends entirely on the Electron process staying alive

- Severity: High
- Category: Correctness; Deployment and Operational Risks
- Location: `electron/services/scheduler.service.ts:34`, `electron/services/scheduler.service.ts:35`, `electron/main.ts:62`, `electron/main.ts:63`, `electron/main.ts:64`, `electron/main.ts:65`, `electron/main.ts:66`, `notes/11_known_issues.md:11`, `notes/11_known_issues.md:20`, `notes/13_prompt_context.md:55`, `notes/13_prompt_context.md:56`
- Issue: All jobs live in an in-memory `Map<string, schedule.Job>`. Closing the window hides it to tray, and start-at-login helps after login, but force-quit, crash, logout, OS restart before login, or killed background process means no sends can fire.
- Evidence: The scheduler state is module-level memory in `scheduler.service.ts`. `electron/main.ts` hides the window on close but does not install an external scheduler/daemon. `notes/11_known_issues.md` still lists "force-killed process = lost schedules until relaunch".
- Impact: The product promise is time-based sending. Users can believe a schedule is reliable after closing the window, but any process exit outside the app's graceful tray path prevents execution until the next launch.
- Suggested direction: Decide whether this remains an explicit personal-use limitation or add LaunchAgent/launchd based recovery with clear user-facing reliability status.

### H-6 - A renderer-exposed "Rebuild App" IPC runs a shell build command from the app

- Severity: High
- Category: Security and Privacy; Deployment and Operational Risks
- Location: `electron/preload.ts:26`, `electron/ipc/settings.ipc.ts:77`, `electron/ipc/settings.ipc.ts:78`, `electron/ipc/settings.ipc.ts:80`, `electron/ipc/settings.ipc.ts:85`, `electron/ipc/settings.ipc.ts:86`, `src/pages/Settings.tsx:470`, `src/pages/Settings.tsx:481`, `src/pages/Settings.tsx:484`
- Issue: The app exposes `rebuildApp()` to the renderer and always registers `app:rebuild`, which executes `npm run build` with `shell: true` from `app.getAppPath()`, then relaunches and quits on success.
- Evidence: `preload.ts` exposes `rebuildApp`; `settings.ipc.ts` registers `ipcMain.handle('app:rebuild')` and calls `exec('npm run build', { cwd: projectRoot, shell: true }, ...)`; the normal Settings page renders a Developer section with "Rebuild & Restart".
- Impact: In a packaged app this is likely broken because the app path is not a writable source checkout with npm tooling. In a compromised renderer, this is also a privileged command-execution primitive, even though the command string is currently constant.
- Suggested direction: Remove this from production builds or gate it behind explicit dev-only checks; prefer an external developer command rather than a renderer-callable shell operation.

## Medium Issues

### M-1 - `schedule:update` bypasses the validation used for creation

- Severity: Medium
- Category: Project Logic and Correctness; Security and Privacy
- Location: `electron/ipc/schedule.ipc.ts:15`, `electron/ipc/schedule.ipc.ts:64`, `electron/ipc/schedule.ipc.ts:65`, `electron/ipc/schedule.ipc.ts:86`, `electron/ipc/schedule.ipc.ts:87`, `electron/ipc/schedule.ipc.ts:88`, `electron/services/db.service.ts:321`, `electron/services/db.service.ts:344`, `electron/services/db.service.ts:350`, `electron/services/db.service.ts:351`, `electron/services/db.service.ts:352`, `electron/services/db.service.ts:353`, `electron/services/db.service.ts:354`
- Issue: Create requests call `validateCreateInput`, but update requests pass the patch straight to `db.updateSchedule`. The DB update then merges undefined fields with existing values, which can preserve stale fields across schedule-type or recipient-type changes.
- Evidence: `schedule:create` validates at lines 64-68; `schedule:update` directly calls `db.updateSchedule(id, data)` at lines 86-89. `db.updateSchedule` uses existing values when patch fields are undefined, including `scheduled_at`, `time_of_day`, day/month recurrence fields, recipient, and message fields.
- Impact: A renderer bug, future form change, or direct IPC call can persist invalid recurrence state or stale recipient data. It also makes create/update behavior inconsistent, which is risky for the scheduler and conflict detection.
- Suggested direction: Share a single create/update validator that validates the final merged schedule shape and clears fields that no longer apply to the selected schedule/recipient type.

### M-2 - Schedule/settings/log load failures collapse into normal empty/default UI

- Severity: Medium
- Category: UX and App Behavior; Correctness
- Location: `src/contexts/ScheduleContext.tsx:24`, `src/contexts/ScheduleContext.tsx:26`, `src/contexts/ScheduleContext.tsx:32`, `src/contexts/ScheduleContext.tsx:35`, `src/pages/Dashboard.tsx:383`, `src/pages/Dashboard.tsx:388`, `src/pages/Dashboard.tsx:390`, `src/hooks/useSettings.ts:20`, `src/hooks/useSettings.ts:25`, `src/hooks/useLogs.ts:9`, `src/hooks/useLogs.ts:14`
- Issue: When IPC reads fail, hooks log to the console and clear loading state, but no user-visible error state is stored. The dashboard can then render "No schedules yet" even if the DB or IPC call failed.
- Evidence: `ScheduleProvider.refresh()` catches errors with `console.error` and then sets `loading` false. The Dashboard empty state says "No schedules yet" based only on `schedules.length === 0`. `useSettings` and `useLogs` follow the same console-only pattern.
- Impact: A DB/read failure can look like data loss or an empty install. Users may create duplicate schedules, change settings based on defaults, or clear logs without understanding the app is degraded.
- Suggested direction: Add explicit error state to schedule/settings/log hooks and render recovery actions instead of empty/default screens when IPC fails.

### M-3 - Settings triggers Contacts access despite copy saying it is only prompted on search

- Severity: Medium
- Category: UX and App Behavior; Security and Privacy
- Location: `src/pages/Settings.tsx:55`, `src/pages/Settings.tsx:56`, `src/pages/Settings.tsx:57`, `src/pages/Settings.tsx:159`, `src/pages/Settings.tsx:160`, `src/pages/Settings.tsx:161`, `electron/ipc/contacts.ipc.ts:80`, `electron/ipc/contacts.ipc.ts:81`, `electron/ipc/contacts.ipc.ts:83`
- Issue: Opening Settings immediately calls `checkContacts()`, which runs an AppleScript against Contacts. The UI text says macOS will prompt automatically the first time the user searches.
- Evidence: The Settings `useEffect` calls `checkContacts()` on mount. `contacts:checkAccess` runs `tell application "Contacts" count of every person`. The UI copy states Contacts access is optional and prompted on first search.
- Impact: Users can receive a privacy permission prompt earlier than the app says, reducing trust in a local-first utility.
- Suggested direction: Make Contacts checks user-initiated, or update the copy to disclose that opening Settings checks Contacts permission.

### M-4 - Renderer hardening is incomplete for a privileged Electron app

- Severity: Medium
- Category: Security and Privacy
- Location: `electron/main.ts:50`, `electron/main.ts:51`, `electron/main.ts:52`, `electron/main.ts:56`, `electron/main.ts:57`, `electron/main.ts:58`, `src/index.html:3`, `src/index.html:4`, `src/index.html:10`
- Issue: The BrowserWindow explicitly disables renderer sandboxing, there is no Content-Security-Policy in the renderer HTML, and `setWindowOpenHandler` opens any requested URL externally without a protocol allowlist.
- Evidence: `webPreferences` sets `sandbox: false`; `src/index.html` has no CSP meta tag; `shell.openExternal(url)` is called on every window-open request.
- Impact: The app does not load remote content today, so this is not an immediate web exploit path. Still, this renderer has access to privileged IPC methods for schedules, logs, settings, rebuild, and macOS automation, so defense-in-depth matters if any renderer injection or future external content appears.
- Suggested direction: Add a restrictive CSP, explicitly document Electron web preferences, prefer sandbox-compatible preload if feasible, and allowlist external URL protocols before calling `shell.openExternal`.

### M-5 - Calendar recurrence dots can misrepresent what actually existed or executed

- Severity: Medium
- Category: UX and App Behavior; Correctness
- Location: `src/pages/Calendar.tsx:33`, `src/pages/Calendar.tsx:42`, `src/pages/Calendar.tsx:43`, `src/pages/Calendar.tsx:44`, `src/pages/Calendar.tsx:46`, `src/pages/Calendar.tsx:123`, `src/pages/Calendar.tsx:131`, `src/pages/Calendar.tsx:132`, `src/pages/Calendar.tsx:133`, `src/pages/Calendar.tsx:284`, `src/pages/Calendar.tsx:285`, `src/pages/Calendar.tsx:286`, `notes/14_ux_audit.md:16`, `notes/14_ux_audit.md:39`
- Issue: The calendar expands recurring schedules across the visible range without checking `createdAt`, `lastFiredAt`, logs, or actual outcomes. Daily schedules appear on every date in the month view, including dates before the schedule existed.
- Evidence: `getScheduleDatesInRange()` returns every day in range for daily schedules and similar range-derived dates for weekly/extended schedules. The UI renders status dots from planned schedule state only. The UX audit notes "Calendar shows planned fires only" and "no execution outcome overlay".
- Impact: The calendar can imply that a send was planned or should have happened on dates where the schedule did not exist, and it cannot show whether planned sends succeeded or failed.
- Suggested direction: Bound recurrence expansion by creation date and schedule state, and add log-backed outcome overlays or clearly label the view as future plan only.

### M-6 - Delete and log-clear actions permanently destroy operational history

- Severity: Medium
- Category: UX and App Behavior; Data and Privacy
- Location: `electron/services/db.service.ts:119`, `electron/services/db.service.ts:121`, `electron/services/db.service.ts:363`, `electron/services/db.service.ts:364`, `electron/services/db.service.ts:489`, `electron/services/db.service.ts:495`, `src/pages/Dashboard.tsx:163`, `src/pages/Dashboard.tsx:164`, `src/pages/Dashboard.tsx:299`, `src/pages/Dashboard.tsx:304`, `src/pages/Logs.tsx:18`, `src/pages/Logs.tsx:19`, `src/pages/Logs.tsx:60`, `src/pages/Logs.tsx:62`
- Issue: Schedule deletion is a hard delete and `run_logs` has `ON DELETE CASCADE`; log clearing deletes all rows when called without an age filter. The UI has confirmation buttons, but no undo, soft delete, archive, or export.
- Evidence: `deleteSchedule()` executes `DELETE FROM schedules WHERE id = ?`; `clearLogs()` executes `DELETE FROM run_logs` with no filter when `olderThanDays` is absent; Dashboard and Logs call these destructive paths directly.
- Impact: A user can permanently remove future schedules and their audit trail. This is especially risky because run logs are the only evidence of missed, failed, skipped, and retry behavior.
- Suggested direction: Add soft-delete/undo for schedules and scoped log-clearing or export-before-clear for operational history.

### M-7 - Activity logs hide important debugging dimensions

- Severity: Medium
- Category: UX and App Behavior; Operations
- Location: `src/hooks/useLogs.ts:12`, `electron/services/db.service.ts:462`, `electron/services/db.service.ts:469`, `electron/services/db.service.ts:475`, `electron/services/db.service.ts:483`, `src/pages/Logs.tsx:14`, `src/pages/Logs.tsx:49`, `src/pages/Logs.tsx:54`, `src/pages/Logs.tsx:141`, `src/pages/Logs.tsx:142`, `shared/types.ts:52`, `shared/types.ts:53`, `notes/14_ux_audit.md:90`, `notes/14_ux_audit.md:92`, `notes/14_ux_audit.md:96`
- Issue: The log UI fetches a hardcoded latest 200 entries, filters only by status, truncates/narrows error display, and does not render retry chain fields even though `retryAttempt` and `retryOf` exist.
- Evidence: `useLogs()` calls `api.getLogs(200)`; DB has `LIMIT ?` for all logs and `LIMIT 50` for per-schedule logs; Logs page only exposes a status `Select` and displays error text in a `max-w-[200px]` right-aligned block. The UX audit documents the same gaps.
- Impact: When a scheduled message fails, the user may have to scan a flat list and cannot easily isolate a schedule, date range, retry lineage, or full error context.
- Suggested direction: Add date range and schedule filters, retry-chain rendering, full expandable errors, and pagination or virtualized history.

### M-8 - Group send overwrites the user's clipboard and never restores it

- Severity: Medium
- Category: UX and App Behavior; Security and Privacy
- Location: `electron/services/whatsapp.service.ts:209`, `electron/services/whatsapp.service.ts:210`, `electron/services/whatsapp.service.ts:211`, `electron/services/whatsapp.service.ts:212`, `electron/services/whatsapp.service.ts:216`, `notes/11_known_issues.md:40`
- Issue: Group sends use the macOS clipboard to paste the message into WhatsApp, but the previous clipboard value is not saved or restored.
- Evidence: Phase 5 runs AppleScript `set the clipboard to "${escapedMessage}"` and then Cmd+V. There is no code before or after this block that reads or restores the prior clipboard contents.
- Impact: Scheduled background sends can silently replace whatever the user copied, which is surprising and can expose message text if the user later pastes elsewhere.
- Suggested direction: Preserve and restore the clipboard where possible, or at minimum warn users that group sends temporarily take over the clipboard.

### M-9 - Settings save failures are unhandled in the UI

- Severity: Medium
- Category: UX and App Behavior; Correctness
- Location: `src/pages/Settings.tsx:31`, `src/pages/Settings.tsx:35`, `src/pages/Settings.tsx:37`, `src/hooks/useSettings.ts:36`, `src/hooks/useSettings.ts:37`, `src/hooks/useSettings.ts:38`, `electron/ipc/settings.ipc.ts:23`, `electron/ipc/settings.ipc.ts:27`, `electron/ipc/settings.ipc.ts:30`
- Issue: Several settings are saved through debounced or blur callbacks that do not await/catch `updateSetting`. If IPC validation rejects a value, there is no toast, inline error, or rollback.
- Evidence: `DebouncedInput` calls `onSave(v)` inside `setTimeout` and `onSave(local)` on blur. `useSettings.updateSetting` returns a promise that can reject when `settings:update` throws validation errors for numeric bounds.
- Impact: Users can type invalid or temporarily empty values and receive no visible failure. The field can appear saved locally while the database remains unchanged.
- Suggested direction: Make settings saves explicit async operations with per-field pending/error state and normalize values before saving.

### M-10 - Send success means "automation ran", not "WhatsApp delivered", but the UI overstates it

- Severity: Medium
- Category: Correctness; UX and App Behavior
- Location: `electron/services/whatsapp.service.ts:92`, `electron/services/whatsapp.service.ts:99`, `electron/services/whatsapp.service.ts:104`, `electron/services/whatsapp.service.ts:107`, `electron/services/scheduler.service.ts:488`, `electron/services/scheduler.service.ts:490`, `electron/services/scheduler.service.ts:495`, `src/pages/Dashboard.tsx:176`, `src/pages/Dashboard.tsx:179`, `electron/main.ts:183`, `electron/main.ts:184`, `electron/main.ts:185`
- Issue: Contact sends return success immediately after the AppleScript Enter keystroke succeeds. The UI and notification labels say "Message sent" or "Message Sent to..." even though there is no WhatsApp-side delivery confirmation.
- Evidence: `sendWhatsAppMessage()` returns `{ success: true, dryRun: false }` after `runAppleScript(sendScript)`. The scheduler turns that into `status = 'success'`, Dashboard toasts "Message sent", and native notifications title it "Message Sent to {recipient}".
- Impact: Users may believe a WhatsApp message was delivered when the app only knows that local automation completed without throwing.
- Suggested direction: Rename status/copy to "send attempted" or "automation completed" unless a real delivery confirmation mechanism exists.

### M-11 - SQLite migrations are opportunistic and have no version history

- Severity: Medium
- Category: Maintainability and Testing; Data and Privacy
- Location: `electron/services/db.service.ts:101`, `electron/services/db.service.ts:228`, `electron/services/db.service.ts:232`, `electron/services/db.service.ts:234`, `electron/services/db.service.ts:245`, `electron/services/db.service.ts:249`, `electron/services/db.service.ts:251`, `notes/05_database_schema.md:91`, `notes/05_database_schema.md:93`
- Issue: Schema setup is a `CREATE TABLE IF NOT EXISTS` string plus a list of `ALTER TABLE ... ADD COLUMN` statements that ignore all caught errors as "already exists". There is no migration version table or applied migration history.
- Evidence: `initDb()` runs `db.exec(SCHEMA)` then loops migrations, logging every catch as "already exists - skipped". The schema notes call out "No migration version table/history".
- Impact: A syntax error, incompatible existing column, partial legacy migration, or failed ALTER can be misclassified as a harmless existing column. Future data changes will be hard to audit and recover.
- Suggested direction: Add a migration table with named, ordered migrations and distinguish "duplicate column" from other migration failures.

### M-12 - Message content is stored plaintext with no backup/export safety net

- Severity: Medium
- Category: Security and Privacy; Data and Privacy
- Location: `electron/services/db.service.ts:20`, `electron/services/db.service.ts:21`, `electron/services/db.service.ts:101`, `electron/services/db.service.ts:104`, `electron/services/db.service.ts:106`, `electron/services/db.service.ts:257`, `electron/services/db.service.ts:259`, `notes/05_database_schema.md:91`, `notes/05_database_schema.md:94`, `notes/07_user_flows.md:75`, `notes/07_user_flows.md:77`
- Issue: Scheduled message text is stored in a local SQLite file as plaintext. File permissions are tightened to `0600`, but there is no encryption-at-rest, export, import, or backup workflow.
- Evidence: DB path is `app.getPath('userData')/schedules.db`; schema stores `message TEXT NOT NULL`; code only applies `chmodSync(dbPath, 0o600)`. Notes explicitly list "No encryption at rest" and "No sync/backup workflow".
- Impact: The app stores potentially sensitive personal messages locally with no built-in portability or recovery story. A lost or corrupted SQLite file is a single point of failure.
- Suggested direction: Add explicit privacy documentation plus optional encrypted export/backup before pursuing sync.

### M-13 - Conflict detection failures are silently treated as "no conflicts"

- Severity: Medium
- Category: Correctness; UX and App Behavior
- Location: `electron/ipc/schedule.ipc.ts:164`, `electron/ipc/schedule.ipc.ts:185`, `electron/ipc/schedule.ipc.ts:186`, `electron/ipc/schedule.ipc.ts:187`, `src/components/ScheduleForm.tsx:219`, `src/components/ScheduleForm.tsx:221`, `src/components/ScheduleForm.tsx:236`, `src/components/ScheduleForm.tsx:237`
- Issue: If conflict detection fails, the IPC handler returns an empty array and the form also proceeds when its conflict-check call throws.
- Evidence: `schedule:checkConflicts` catches errors, logs them, and returns `[]`. `ScheduleForm` catches conflict-check failure and comments "proceed with save".
- Impact: A DB or IPC error can suppress duplicate warnings exactly when the app should be most cautious about duplicate sends.
- Suggested direction: Surface conflict-check failures to the user and require an explicit "save without conflict check" decision.

### M-14 - Log IPC accepts unbounded or destructive parameters from the renderer

- Severity: Medium
- Category: Performance and Efficiency; Security and Privacy
- Location: `electron/ipc/logs.ipc.ts:8`, `electron/ipc/logs.ipc.ts:10`, `electron/ipc/logs.ipc.ts:26`, `electron/ipc/logs.ipc.ts:28`, `electron/services/db.service.ts:462`, `electron/services/db.service.ts:469`, `electron/services/db.service.ts:471`, `electron/services/db.service.ts:489`, `electron/services/db.service.ts:490`, `electron/services/db.service.ts:495`
- Issue: `logs:getAll` forwards any renderer-provided `limit` to SQLite, and `logs:clear` forwards optional days without IPC-level validation.
- Evidence: `logs:getAll` calls `db.getLogs(limit)` directly; `getLogs()` uses `LIMIT ?`; `clearLogs()` deletes all logs when `olderThanDays` is absent and uses the provided number otherwise.
- Impact: Normal UI calls `getLogs(200)`, but a compromised renderer or future UI bug can request far more rows or invoke broad deletion. This is local-only, but the IPC surface is privileged.
- Suggested direction: Clamp log limits and validate clear ranges at the IPC boundary.

### M-15 - Tests duplicate critical logic and miss the current type/build failures

- Severity: Medium
- Category: Maintainability and Testing
- Location: `tests/ipc-validation.test.ts:5`, `tests/ipc-validation.test.ts:6`, `tests/ipc-validation.test.ts:7`, `tests/ipc-validation.test.ts:35`, `tests/ipc-validation.test.ts:207`, `tests/ipc-validation.test.ts:209`, `tests/ipc-contracts.test.ts:21`, `tests/ipc-contracts.test.ts:46`, `tests/scheduler-testsend.test.ts:22`, `tests/scheduler-testsend.test.ts:30`
- Issue: Some tests assert copied logic or source-string patterns rather than importing the real runtime path. The test suite passed during this audit even though direct project typechecking failed.
- Evidence: `ipc-validation.test.ts` says it replicates validation because the function is not exported, then defines its own `validateCreateInput`. Several tests read source files and assert regex/string presence. `npm test -- --run` passed 95 tests, while direct `tsc -p` checks failed.
- Impact: The suite can give confidence that text still exists without exercising the real IPC validation or compile gates that packaging depends on.
- Suggested direction: Move pure validation logic into importable shared modules and add a CI/test script that runs real web/node typechecks.

### M-16 - No CI or release workflow is represented in the repository

- Severity: Medium
- Category: Deployment and Operational Risks; Maintainability and Testing
- Location: repository root; `package.json:13`, `package.json:14`, `package.json:15`, `package.json:16`
- Issue: There is no `.github/workflows/`, release script, signing script, or automated gate that combines tests, typecheck, build, packaging, and audit.
- Evidence: Repository discovery found no CI files. `package.json` has local scripts for `dist`, `dist:dmg`, `typecheck`, and `test`, but no script composes them into a release gate.
- Impact: A local packaged DMG can be produced without tests, without the real typecheck, and without dependency audit review.
- Suggested direction: Add a minimal local release script or CI workflow that runs tests, real typecheck, audit, build, and packaging checks in order.

## Low Issues

### L-1 - Documentation claims about dark mode and design tokens are stale

- Severity: Low
- Category: Project Intent and Artifact Discrepancies; Stale, Dead, or Debug Code
- Location: `src/index.css:27`, `src/index.css:28`, `src/index.css:45`, `notes/02_design_system.md:18`, `notes/02_design_system.md:46`, `notes/11_known_issues.md:110`, `notes/11_known_issues.md:113`, `notes/14_ux_audit.md:20`, `notes/14_ux_audit.md:42`, `notes/01_features.md:59`
- Issue: Multiple docs say `.dark` CSS token overrides are missing or incomplete, but `src/index.css` now defines `.dark` variables. `notes/02_design_system.md` also lists a primary token value that no longer matches the CSS.
- Evidence: `src/index.css` defines `.dark` from lines 27-45 and `--primary: 175 77% 26%` in `:root`; docs still claim dark overrides are not defined and list `--primary: 142 71% 45%`.
- Impact: Future work can be guided by stale design debt and duplicate already-solved work.
- Suggested direction: Update notes to distinguish remaining dark-mode visual QA from missing token definitions.

### L-2 - Repository docs overstate the note count

- Severity: Low
- Category: Project Intent and Artifact Discrepancies
- Location: `CLAUDE.md:79`, `CLAUDE.md:238`, `CLAUDE.md:239`
- Issue: `CLAUDE.md` says `notes/` contains 17 design docs, but the repository currently has 15 markdown files in `notes/`.
- Evidence: `CLAUDE.md` states "notes/ # 17 design docs" and "17 files covering architecture, UX, known issues, roadmap"; repository file discovery found 15 `notes/*.md` files.
- Impact: Low direct product risk, but it is another sign that documentation is not reliably updated alongside code.
- Suggested direction: Correct the count or remove counts that will drift.

### L-3 - Custom dialogs lack standard modal accessibility behavior

- Severity: Low
- Category: UX and App Behavior
- Location: `src/components/ui/dialog.tsx:11`, `src/components/ui/dialog.tsx:14`, `src/components/ui/dialog.tsx:17`, `src/components/ui/dialog.tsx:21`, `src/components/ui/dialog.tsx:22`, `src/components/ui/dialog.tsx:38`
- Issue: The local Dialog component renders a visual modal but does not set `role="dialog"`, `aria-modal`, labelled-by relationships, focus trap, initial focus, focus restoration, or Escape handling.
- Evidence: `Dialog` returns plain `div` wrappers and a close button. There is no keyboard handler or ARIA modal metadata.
- Impact: Keyboard and assistive-technology users can have a confusing modal experience, especially in schedule creation and destructive confirmations.
- Suggested direction: Add accessible modal semantics and focus management or replace the primitive with a tested dialog implementation.

### L-4 - Lazy page loading uses a blank fallback

- Severity: Low
- Category: UX and App Behavior
- Location: `src/App.tsx:1`, `src/App.tsx:3`, `src/App.tsx:4`, `src/App.tsx:5`, `src/App.tsx:6`, `src/App.tsx:127`
- Issue: All major tabs are lazy-loaded, but Suspense uses `fallback={null}`.
- Evidence: `Dashboard`, `CalendarPage`, `Logs`, and `Settings` are imported via `lazy(...)`, and the content area wraps them in `<Suspense fallback={null}>`.
- Impact: On slower machines or after cache misses, tab switches can show a blank content pane rather than a loading state.
- Suggested direction: Use a small skeleton or status region that matches the tab being loaded.

### L-5 - AppleScript helper leaves timeout timers alive after successful completion

- Severity: Low
- Category: Performance and Efficiency
- Location: `electron/utils/applescript.ts:7`, `electron/utils/applescript.ts:9`, `electron/utils/applescript.ts:13`, `electron/utils/applescript.ts:40`, `electron/utils/applescript.ts:41`, `electron/utils/applescript.ts:42`
- Issue: `runAppleScript()` creates a manual `setTimeout` to kill the process after `timeoutMs + 1000`, but never clears that timeout after `execFile` completes.
- Evidence: The helper uses both `execFile(..., { timeout: timeoutMs }, callback)` and a separate `setTimeout(() => proc.kill(), timeoutMs + 1000)`.
- Impact: Each successful AppleScript call leaves an unnecessary timer alive until timeout. The cost is low, but group sends and probes can issue many AppleScript calls.
- Suggested direction: Store the timeout handle and clear it in the `execFile` callback.

### L-6 - Distribution is Apple Silicon only and unsigned/not notarized

- Severity: Low
- Category: Deployment and Operational Risks
- Location: `package.json:72`, `package.json:75`, `package.json:77`, `package.json:79`, `notes/10_deployment.md:72`, `notes/10_deployment.md:73`, `notes/10_deployment.md:75`, `README.md:91`
- Issue: The current mac target only packages `arm64`, and the docs note signing/notarization are not configured.
- Evidence: `package.json` sets the DMG target arch to `arm64`; deployment notes list "Code signing/notarization not configured" and "arm64 only"; README says the config produces an Apple Silicon DMG.
- Impact: This is acceptable for personal distribution as documented, but it blocks a smooth install experience for Intel Macs or broader sharing.
- Suggested direction: Keep the limitation explicit, or add x64/universal packaging plus signing/notarization before wider release.

## Project Logic and Correctness

Findings in this category: H-3, H-4, H-5, M-1, M-2, M-5, M-10, M-13.

No additional correctness issues were confirmed beyond the detailed findings above.

## Security and Privacy

Findings in this category: H-2, H-4, H-6, M-1, M-3, M-4, M-8, M-12, M-14.

No secrets, API keys, private keys, `.env` files, cloud auth, public HTTP handlers, Supabase policies, uploads, unsafe deserialization, `dangerouslySetInnerHTML`, `eval`, or `new Function` usage were found in this pass.

## UX and App Behavior

Findings in this category: H-4, H-5, M-2, M-3, M-5, M-6, M-7, M-8, M-9, M-10, M-13, L-3, L-4.

No additional confirmed responsive layout breakage was tested in a live browser because this is an Electron app and the requested audit forbids source changes; visual runtime verification was not needed to establish the code-level findings above.

## Performance and Efficiency

Findings in this category: M-7, M-14, L-5.

No evidence of oversized renderer chunks above 500 KB was found in the existing generated `out/renderer/assets` files inspected during this pass. `resources/icon.png` and `resources/icon.icns` are multi-megabyte assets, but they are plausible app icon resources, so they were not reported as standalone issues.

## Stale, Dead, or Debug Code

Findings in this category: L-1, L-2.

No unused active source files were confirmed. `out/`, `dist/`, `node_modules/`, `.claude/`, and local `.DS_Store` artifacts exist in the working tree but are ignored by `.gitignore`; only the tracked source/doc files were treated as repository source of truth.

## Maintainability and Testing

Findings in this category: H-1, M-11, M-15, M-16.

Test command result: `npm test -- --run` passed 8 files and 95 tests. This does not clear H-1 because direct referenced TypeScript project checks failed.

## Deployment and Operational Risks

Findings in this category: H-1, H-2, H-5, H-6, M-16, L-6.

`npm run build` and packaging commands were not run because they write generated output under `out/` and `dist/`, and the audit instruction allowed only `issues.md` to be created or updated.

## Data, Notebook, and ML Issues

Data-related findings: M-6, M-11, M-12.

No notebooks, datasets, model files, feature pipelines, training code, inference services, or ML metrics were found in this repository. No evidence of ML-specific issues found in this pass.

## Open Questions Needing Human Confirmation

- Is WhatTime intended to remain personal/local-only, or is broader distribution planned? This determines whether L-6 becomes a release-blocking issue.
- Are ignored `dist/` DMGs ever shared with users directly from the working tree? If yes, generated artifact freshness needs a formal release checklist.
- What user-visible reliability promise should the app make for force-quit, logout, restart, locked-screen, and call-hold cases?
- Should group scheduling be allowed to send live messages before chat-header verification exists, or should it remain dry-run-only?
- Should message history be treated as sensitive enough to require encrypted export/backup before v1.0 distribution?
- Should the Developer "Rebuild & Restart" button exist in packaged builds at all?

## Audit Coverage Notes

Inspected repository structure, tracked files, ignored generated artifacts, package/config files, docs, notes, Electron main/preload, IPC handlers, DB/scheduler/WhatsApp services, renderer app shell, hooks, pages, UI primitives, tests, assets, gitignore, and package lockfile.

Commands run for evidence included read-only file discovery/search, `git status --short --branch`, `npm ls --depth=0 --json`, `npm test -- --run`, `npm run typecheck`, direct referenced TypeScript checks with `npx tsc -p tsconfig.web.json --noEmit --pretty false` and `npx tsc -p tsconfig.node.json --noEmit --pretty false`, and `npm audit --omit=dev --json` plus full `npm audit --json`.

The direct `tsc -p` checks created ignored TypeScript build-info files under `out/`; those generated audit artifacts were removed immediately so the only intended repository change is this `issues.md` file.
