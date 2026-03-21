# WhaTime — UX/Product Audit & Improvement Plan

## Context

This is a comprehensive UX/product audit of a local-first macOS Electron app for WhatsApp message scheduling. The app works (Electron 33 + React 18 + SQLite + node-schedule + AppleScript automation) and has solid reliability foundations (sleep/wake resync, retry backoff, tray runtime). The goal is to move from "works for the builder" to "works effortlessly for daily use" — fixing real friction, adding missing guardrails, and planning a path to data safety.

---

## 1) Current-State Snapshot

1. **Functional local scheduler** — 6 recurrence types, in-process node-schedule, AppleScript send via `whatsapp://send` + `keystroke return`. Works.
2. **Sleep/wake resync** — `powerMonitor.resume` cancels and re-registers all jobs, catches up missed recurring runs (one-shot per schedule). Solid.
3. **Close-to-tray + start-at-login** — Window hides on close, tray icon persists, single-instance lock prevents duplicates. Good lifecycle.
4. **Retry with exponential backoff** — 10s → 30s → 90s, non-retryable errors excluded. `max_retries` in DB but **no UI control**.
5. **Dashboard groups schedules by timeline buckets** — Useful for small counts, but **no search, filter, or sort** once schedules exceed ~10.
6. **Calendar shows planned fires only** — Green/yellow/gray dots for schedule state, but **no execution outcome overlay** (success/failure per day).
7. **Activity Logs have basic status filter** — No date range, no per-schedule drill-down, no pagination (hardcoded 200 limit), truncated error messages.
8. **No keyboard shortcuts** — All interactions require mouse. No `Cmd+N`, `Cmd+S`, `Escape` bindings.
9. **No first-run onboarding** — Users land on empty dashboard, may create a schedule before granting Accessibility permission → cryptic failure on first send.
10. **No dark mode** — `darkMode: 'class'` configured in Tailwind but no `.dark` CSS variables defined. Glaring white on macOS Dark Mode.
11. **No conflict detection** — Two schedules for same phone at same minute both fire → duplicate messages.
12. **No undo for destructive actions** — Delete is permanent (CASCADE wipes run_logs). 2-stage confirm exists but no soft-delete/undo.
13. **No message templates** — Users re-type identical messages across yearly birthday schedules.
14. **No export/import/backup** — Single point of failure: one SQLite file, no way to back up or migrate.
15. **App stops scheduling if force-killed** — No LaunchAgent keepalive. Scheduler lives only in Electron process memory.

---

## 2) UX + Efficiency Audit Table

| # | Area | Current Issue | Why It Hurts | Sev | Effort | Recommended Fix | Success Metric |
|---|------|--------------|-------------|-----|--------|----------------|----------------|
| 1 | Dashboard | No search or filter | 10+ schedules → manual scanning | H | S | Search input filtering on `contactName`, `phoneNumber`, `message` in `Dashboard.tsx` | Find schedule in <2s vs ~15s scanning |
| 2 | Onboarding | No first-run guidance | Users fail on first send (missing Accessibility permission) | H | S | 3-step wizard modal: permissions → test schedule → done. New `OnboardingWizard.tsx` | First-time send success >90% |
| 3 | Reliability | No LaunchAgent keepalive | Force-kill or crash = scheduler dead until manual relaunch | H | M | Write macOS LaunchAgent plist on first run, register via `launchctl` | Scheduler uptime >99.5% across reboots |
| 4 | Dashboard | No bulk operations | Pausing 8 schedules for vacation = 8 clicks | H | M | Select mode + sticky action bar for bulk pause/resume/delete | Bulk op on N schedules = 3 clicks instead of 2N |
| 5 | Safety | No conflict detection | Same phone + same minute = duplicate message sent | M | M | Pre-save query for overlapping phone + fire time. Warning banner in `ScheduleForm.tsx` | Zero accidental duplicate sends |
| 6 | Calendar | No execution outcomes | Dots show plan, not results — can't spot failure patterns | M | M | Query `run_logs` for visible month, overlay red/green indicators per day | Failure patterns visible without switching to Logs |
| 7 | Logs | No date range or schedule filter | Scanning 200 entries to find Tuesday's failure | M | M | Date range quick-select + schedule dropdown + offset/limit pagination | Relevant log found in <5s |
| 8 | Settings | No max_retries UI | Power users can't tune retry behavior without DB hacking | M | S | Numeric input (1–10) with `DebouncedInput` in `Settings.tsx` | Setting controllable from UI |
| 9 | Dark mode | Not implemented | White app on macOS Dark Mode is jarring | M | S | `.dark` CSS variables in `index.css` + theme toggle in Settings | App respects system appearance |
| 10 | Keyboard | No shortcuts | Power users forced to mouse for every action | M | S | `Cmd+N` (new), `Escape` (close modal), `Cmd+,` (settings) in `App.tsx` | Core flows keyboard-accessible |
| 11 | Delete safety | No undo | Accidental confirm = permanent data loss (CASCADE deletes logs) | M | M | Soft-delete (`deleted_at` column), undo toast (5s), auto-purge after 30 days | Zero accidental permanent data loss |
| 12 | Productivity | No message templates | Re-typing "Happy Birthday" for 20 yearly schedules | L | M | `message_templates` table + CRUD UI + template picker in form | Schedule creation time drops for repeated patterns |
| 13 | Logs | No retry chain visualization | `retry_attempt` and `retry_of` fields exist but aren't shown | L | S | Indented sub-entries with "Retry 1/3" label + link to original run | Retry behavior transparent to user |
| 14 | Diagnostics | No "why didn't it send?" panel | Debugging failures requires raw log scanning | M | L | Per-schedule health view: last 5 runs, system state at fire time, retry chain | Support burden for "it didn't send" → near zero |

---

## 3) UI Improvements (Screen-by-Screen)

### Dashboard (`src/pages/Dashboard.tsx`)

**Top usability issues:**
- No search/filter — unsustainable past 10 schedules
- No sort options (next fire, contact A-Z, recently created)
- Action buttons are identical ghost icons — easy to misclick (edit vs delete)
- No link from a schedule card to its execution history

**Proposed UI changes:**
1. **Search bar** below header — `<Input>` with search icon, `useMemo` filter on `contactName + phoneNumber + message`
2. **Sort dropdown** next to search — "Next fire (soonest)" | "Contact A–Z" | "Recently created" | "Recently updated"
3. **Count badges** on bucket headers — "Upcoming (Next 30 days) — 5 schedules"
4. **"View history" button** per card (clock icon) — sets context and switches tab to Logs pre-filtered by `scheduleId`
5. **Compact table view toggle** for 20+ schedules — contact | message | type | next fire | toggle | actions
6. **Today summary card** at top — "3 sent, 1 failed, 2 upcoming" with expandable detail

**Keyboard/accessibility:**
- `Cmd+N` opens ScheduleModal
- Cards: `role="listitem"`, bucket groups: `role="list"`
- Toggle: `aria-label="Enable schedule for {contactName}"`
- Destructive confirm: auto-focus "Cancel" not "Confirm"

**Expected impact:** Daily monitoring becomes glanceable. Schedule management scales to 50+ entries.

---

### Calendar (`src/pages/Calendar.tsx`)

**Top usability issues:**
- Shows plan, not outcomes — can't see which days had failures
- Daily schedules fill every cell with identical green dots — visual noise
- Popover positioning uses manual rect math — can overflow viewport

**Proposed UI changes:**
1. **Execution outcome overlay** — New IPC `logs:getByDateRange(start, end)` returning aggregated status per day. Red "x" badge on failure days, green checkmark on success days.
2. **Daily schedule bar** instead of 30 individual dots — horizontal green bar with red segments on failure days
3. **"Today's upcoming" panel** below calendar — schedules firing today with countdown timers
4. **Fix popover** — use `position: fixed` with viewport boundary clamping

**Keyboard/accessibility:**
- Arrow keys navigate between cells
- `Enter` opens popover or create modal
- `Escape` closes popover

**Expected impact:** Calendar becomes a monitoring tool, not just a planning view.

---

### Activity / Logs (`src/pages/Logs.tsx`)

**Top usability issues:**
- Flat 200-entry list with only status filter
- No date range filtering
- Error messages truncated to 200px, right-aligned — hard to read
- `retry_attempt` and `retry_of` data exists but not rendered

**Proposed UI changes:**
1. **Date range quick-select** — Today | Last 7 days | Last 30 days | Custom picker
2. **Schedule filter dropdown** — populated from schedules list, pre-selectable via Dashboard "View history" link
3. **Retry chain rendering** — indented sub-entries for retries with "Retry 1/3" labels
4. **Full error display** — collapsible red banner below entry with full text, not truncated corner
5. **"Re-run" button** on failed entries — calls `testSend` for the associated schedule
6. **Export to CSV** — download visible entries for debugging

**Keyboard/accessibility:**
- Filter controls keyboard-navigable
- Log entries: `role="article"` with descriptive aria-labels

**Expected impact:** Debugging drops from "scan 200 entries" to "filter + 2 clicks."

---

### Settings (`src/pages/Settings.tsx`)

**Top usability issues:**
- `max_retries` missing from UI
- No dark mode toggle
- No app version / DB stats
- No data export/import

**Proposed UI changes:**
1. **max_retries control** — numeric input (1–10) with description
2. **Dark mode toggle** — Switch adding/removing `.dark` class on `<html>`. Persist as `theme` setting (`system` | `light` | `dark`)
3. **About section** — app version (`app.getVersion()` via IPC), DB path, schedule count, total log entries
4. **Export/Import buttons** — JSON file via `dialog.showSaveDialog` / `dialog.showOpenDialog`
5. **Grouped sections** — Permissions | Behavior | Appearance | Data | Advanced | About

**Keyboard/accessibility:**
- `Cmd+,` opens Settings tab
- All toggles get visible focus rings (`focus-visible:ring-2`)

**Expected impact:** Settings becomes a comprehensive control panel. Power users can tune all behavior.

---

## 4) Workflow Improvements

### Flow 1: First-Run Onboarding

**Current pain:** User installs → empty dashboard → creates schedule → send fails because Accessibility permission not granted. Trust broken on first interaction.

**Better flow:**
1. On launch, if `schedules` table empty AND `onboarding_completed !== '1'`: show wizard modal
2. **Step 1 — Welcome**: "WhaTime automates sending WhatsApp messages at times you choose."
3. **Step 2 — Permissions**: Inline Accessibility check. Green ✓ if granted, CTA "Grant Permission" → `openAccessibilitySettings()`. Poll every 2s. Cannot proceed until granted. Optional Contacts check.
4. **Step 3 — First Schedule**: Embedded `ScheduleForm` with dry-run pre-checked. "Create a test schedule to verify everything works."
5. **Step 4 — Success**: Dry-run test send succeeds → "You're all set!"
6. Set `onboarding_completed = '1'`

**Edge cases:**
- User dismisses wizard → persistent banner "Setup incomplete" with "Resume setup" button
- Accessibility revoked later → periodic check (every 5 min) with tray notification
- User skips to step 3 → validation catches missing fields, test send fails with informative error

**Files:** New `src/components/OnboardingWizard.tsx`, `src/App.tsx`, `electron/services/db.service.ts` (new setting key)

---

### Flow 2: Create/Edit Schedule

**Current pain:** Extended types (quarterly/half_yearly/yearly) require opening a separate `ExtendedScheduleDialog`. No preview of next fire times. No template reuse.

**Better flow:**
1. **Inline extended fields** — show month/day/time directly in `ScheduleForm.tsx` when type is quarterly/half_yearly/yearly. Remove `ExtendedScheduleDialog.tsx`.
2. **"Next 3 fires" preview** — below schedule config, compute using new IPC `schedule:previewFireTimes` (build rule, call `job.nextInvocation()` 3x without registering)
3. **Template picker** — dropdown above message textarea. Selecting fills textarea.
4. **Edit diff summary** — on update, show "Changed: time 09:00 → 10:00" before confirming

**Edge cases:** Already handled — past date validation, day clamped to 28, country code auto-fill on focus.

---

### Flow 3: Failure Handling/Recovery

**Current pain:** Failure → macOS notification with brief error → user opens app → switches to Activity → scans 200 entries. No clear retry path.

**Better flow:**
1. **Actionable notifications** — failure notification includes "Retry Now" action button (Electron `Notification` with actions on macOS)
2. **Rich failure entries** — full error message (collapsible), retry chain visualization, "Retry" button calling `testSend`, "Diagnose" expandable section (screen locked? WhatsApp running? Accessibility granted?)
3. **Auto-pause on consecutive failures** — if last 3 consecutive runs of a recurring schedule failed, auto-disable + notify: "Schedule for {contact} paused after 3 failures. Check your setup."

**Edge cases:**
- Screen locked → logged as "skipped" (correct), diagnostics shows "Screen was locked"
- WhatsApp not installed → pre-flight check on app launch, warn via tray notification
- Retry of a retry → already tracked via `retryOf` field

---

### Flow 4: Daily Monitoring

**Current pain:** No at-a-glance "how did today go?" — must check Dashboard for upcoming, Calendar for visual, Logs for outcomes. Three tabs for one question.

**Better flow:**
1. **"Today" summary card** at top of Dashboard — "3 sent, 1 failed, 2 upcoming today." Click to expand.
2. **Tray tooltip** — "WhaTime — 3 sent today, 1 failed" instead of static title
3. **Tray icon badge** — green (all good) / red dot (failures today) via `tray.setImage()` variant

**Edge cases:**
- No schedules today → "No messages scheduled for today"
- All dry run → "2 dry runs completed today"

---

## 5) Feature Opportunities (WhatsApp Scheduling POV)

### Reliability

| Feature | User Problem | Feas. | Complexity | Dependencies | Priority |
|---------|-------------|-------|------------|--------------|----------|
| LaunchAgent keepalive | Scheduler dies on force-kill/crash | A | M | macOS launchd plist, `launchctl` registration | 5 |
| Pre-flight health check | No way to verify system readiness before critical send | A | S | New IPC `system:healthCheck` → { accessibility, whatsappInstalled, screenUnlocked } | 4 |
| Consecutive failure auto-pause | Recurring schedule fails silently forever | A | S | Counter in `scheduler.service.ts`, threshold check after each failure | 4 |
| WhatsApp process watcher | App doesn't know if WhatsApp crashed mid-send | A | M | `pgrep WhatsApp` poll every 30s | 2 |
| Delivery confirmation | No way to know if message was actually delivered | B | L | WhatsApp Business API with read receipts | 1 |

### Productivity

| Feature | User Problem | Feas. | Complexity | Dependencies | Priority |
|---------|-------------|-------|------------|--------------|----------|
| Message templates | Re-typing identical messages | A | M | New `message_templates` table, CRUD, picker in form | 4 |
| Bulk import from CSV | 20 birthday schedules one by one | A | M | CSV parser, validation, batch create IPC | 3 |
| Schedule tags/groups | No organization by purpose | A | M | New `tags` column or junction table, filter on Dashboard | 3 |
| Quick duplicate with date bump | Duplicate copies same date (useless for one-time) | A | S | Modify `handleDuplicate` in `Dashboard.tsx` to add 1 week | 3 |
| Contact groups / multi-recipient | Send same message to N contacts on one schedule | A | L | New `schedule_recipients` table, sequential send with delays | 2 |

### Safety / Guardrails

| Feature | User Problem | Feas. | Complexity | Dependencies | Priority |
|---------|-------------|-------|------------|--------------|----------|
| Conflict detection | Same phone + same time = duplicate message | A | M | Pre-save SQL overlap query, warning in form | 5 |
| Rate limiting queue | 50 messages in 1 min → WhatsApp anti-spam | A | S | In-memory queue in `scheduler.service.ts`, configurable min-interval (default 30s) | 4 |
| Soft delete + undo | Accidental delete = permanent | A | M | `deleted_at` column, undo toast, auto-purge cron | 4 |
| Message length warning | WhatsApp may truncate >4096 chars | A | S | Warning badge in `ScheduleForm.tsx` at 4096 chars | 3 |
| Quiet hours | 3 AM sends wake recipients | A | S | Settings: quiet_hours_start/end, scheduler defers | 2 |

### Analytics / Insights

| Feature | User Problem | Feas. | Complexity | Dependencies | Priority |
|---------|-------------|-------|------------|--------------|----------|
| Success rate widget | No aggregate reliability view | A | M | SQL aggregation, new Dashboard component | 3 |
| Per-schedule sparkline | No visual reliability trend | A | M | Last 30 runs as mini bar chart on card | 2 |
| Export logs to CSV | Can't share debugging data | A | S | Format `run_logs` join → CSV, `dialog.showSaveDialog` | 3 |
| Weekly digest notification | No proactive summary | A | M | Scheduled weekly check, native Notification with stats | 2 |

---

## 6) Sync Strategy (Phased)

### Option 1: Manual Export/Import (Ship First)

**Architecture:** Two IPC endpoints in new `electron/ipc/data.ipc.ts`:
- `data:export` → reads all schedules + settings from SQLite, serializes to `{ version: 1, exportedAt, checksum: sha256, schedules: [...], settings: {...} }`
- `data:import` → validates JSON schema, runs in transaction. User chooses "Merge (skip existing IDs)" or "Replace all."

**Conflict strategy:** Merge uses schedule `id` as dedup key. Colliding IDs with different content → skip + log warning.

**Security/privacy:** Plain JSON. Warn user: "This file contains phone numbers and messages. Store securely." No encryption (rely on macOS disk encryption).

**UI:** Two buttons in Settings: "Export Data" → `dialog.showSaveDialog`, "Import Data" → `dialog.showOpenDialog`.

**Rollout:** First. Unblocks backup immediately.

---

### Option 2: Auto-Backup to User Folder (Ship Second)

**Architecture:** On every schedule create/update/delete, write full export JSON to `~/Library/Application Support/WhaTime/backups/backup-{ISO-timestamp}.json`. Keep last 10, prune older on startup.

**Conflict strategy:** N/A — write-only snapshots. Restore = Phase 1 import with "Replace all."

**Security/privacy:** Files in macOS-protected app support dir (chmod 700). Settings toggle "Auto-backup: On/Off."

**Rollout:** Second. Depends on Phase 1 export format being stable.

---

### Option 3: True Multi-Device Sync (Ship Third — Future)

**Architecture:** iCloud Drive file sync — write export JSON to `~/Library/Mobile Documents/com~veer~wa-scheduler/`. Other devices read on launch, compare `updated_at` timestamps.

**Conflict strategy:** Per-record last-write-wins via `updated_at`. Conflicting edits (same schedule ID, both modified since last sync) → surface diff view to user.

**Security/privacy:** iCloud provides E2E encryption. Phone numbers transit Apple infrastructure.

**Rollout:** Third. Only after Phase 1 + 2 are stable. Needs extensive edge-case testing (offline edits on two devices, partial sync).

---

## 7) Prioritized Roadmap

### Quick Wins (1–2 weeks)

| # | Item | Rationale | Files |
|---|------|-----------|-------|
| 1 | Dashboard search + sort | Highest ROI/effort. Pure frontend. Unblocks daily use at 10+ schedules. | `src/pages/Dashboard.tsx` |
| 2 | max_retries Settings UI | One-liner. Closes documented gap. | `src/pages/Settings.tsx` |
| 3 | Dark mode | Infrastructure ready. Only CSS vars + toggle. <2h. | `src/index.css`, `src/pages/Settings.tsx`, `electron/services/db.service.ts` |
| 4 | Keyboard shortcuts | `Cmd+N`, `Escape`, `Cmd+,`. Register in `App.tsx` `useEffect`. | `src/App.tsx` |
| 5 | Conflict detection warning | Simple pre-save SQL query + yellow banner in form. Prevents duplicate sends. | `electron/ipc/schedule.ipc.ts`, `src/components/ScheduleForm.tsx` |

### Near Term (1–2 months)

| # | Item | Files |
|---|------|-------|
| 6 | First-run onboarding wizard | New `src/components/OnboardingWizard.tsx`, `src/App.tsx` |
| 7 | Soft delete + undo toast | `electron/services/db.service.ts`, `electron/ipc/schedule.ipc.ts`, `src/pages/Dashboard.tsx` |
| 8 | Calendar execution overlay | `electron/ipc/logs.ipc.ts`, `src/pages/Calendar.tsx` |
| 9 | Logs date range + schedule filter + pagination | `src/pages/Logs.tsx`, `src/hooks/useLogs.ts`, `electron/ipc/logs.ipc.ts` |
| 10 | Message templates | `electron/services/db.service.ts`, new `electron/ipc/templates.ipc.ts`, `src/components/ScheduleForm.tsx` |
| 11 | Manual export/import (Sync Phase 1) | New `electron/ipc/data.ipc.ts`, `src/pages/Settings.tsx` |

### Longer Term (2+ months)

| # | Item | Files |
|---|------|-------|
| 12 | LaunchAgent keepalive | New `electron/utils/launchagent.ts`, `electron/main.ts` |
| 13 | Rate limiting send queue | `electron/services/scheduler.service.ts` |
| 14 | Bulk operations (select mode) | `src/pages/Dashboard.tsx`, `electron/ipc/schedule.ipc.ts` |
| 15 | Auto-backup (Sync Phase 2) | `electron/services/db.service.ts` |
| 16 | Diagnostics panel | New `src/components/DiagnosticsPanel.tsx`, new IPC endpoints |

### Top 5 Next Actions

1. **Dashboard search + sort** — Highest ROI/effort ratio. Pure frontend, no backend. Unblocks daily use past 10 schedules.
2. **Dark mode** — Infrastructure is ready. Only CSS variables + toggle. Visible quality-of-life win.
3. **First-run onboarding** — Prevents the most common first-time failure (missing Accessibility permission).
4. **max_retries Settings UI** — Trivial. Closes a documented gap. No reason not to ship immediately.
5. **Conflict detection warning** — Prevents the most dangerous user error (duplicate sends). Simple SQL query + warning UI.

---

## 8) Metrics and Validation Plan

### UX Speed Targets

| Metric | Baseline | Target | How to Measure |
|--------|----------|--------|----------------|
| Time to find a schedule (20 schedules) | ~15s (visual scan) | <2s (search) | Manual task timing |
| Time to create a schedule (returning user) | ~45s (mouse-only) | <30s (keyboard shortcuts) | Stopwatch from `Cmd+N` to toast |
| Time to diagnose a failure | ~60s (open → Logs → scan) | <15s (filter + expand) | Manual task timing |
| Keyboard-only task completion | Impossible | Possible for all core flows | Manual testing |

### Reliability Targets

| Metric | Target | SQL Query |
|--------|--------|-----------|
| Send success rate (30-day) | >98% | `COUNT(status='success') / COUNT(status IN ('success','failed'))` |
| Missed schedule rate | <1% | `COUNT(status='skipped') / total fires` |
| Mean retry count (successful retries) | <1.5 | `AVG(retry_attempt) WHERE status='success' AND retry_attempt > 0` |
| Scheduler uptime | >99.5% | Track in logs: time between `initScheduler` and shutdown |

### Adoption/Usage Metrics (Local Only)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Active schedule count | Trending up | `COUNT(*) WHERE enabled=1` on launch |
| Search feature adoption | >30% of sessions within 2 weeks | Local counter in `analytics` table |
| Onboarding completion rate | >90% | `settings.onboarding_completed = '1'` |

### Accessibility Conformance

| Check | Method | Criteria |
|-------|--------|----------|
| Color contrast | Manual inspection (light + dark) | WCAG AA: 4.5:1 text, 3:1 large text |
| Keyboard navigation | Tab through all elements | All interactive elements reachable, focus rings visible |
| Screen reader | VoiceOver on macOS | Cards, buttons, status badges announce meaningful labels |
| Focus management | Modal open/close | Focus trapped in modal, returns to trigger on close |

### Regression Guardrails

| Guard | Implementation | Trigger |
|-------|---------------|---------|
| Type safety | `npm run build` (strict TS) | Every commit |
| Unit tests | `vitest run` (existing 4 test files) | Every commit; expand to new IPC handlers |
| IPC contract tests | Existing `tests/ipc-contracts.test.ts` | Every commit; add for new endpoints |
| Scheduler logic tests | Existing `tests/scheduler.logic.test.ts` | Every commit; add conflict detection, rate limiting |
| Manual smoke test | Create → test send (dry) → verify log → toggle → delete → calendar check | Before every `npm run dist` |
| Bundle size | `npm run build` output | Flag chunks >500kB |
