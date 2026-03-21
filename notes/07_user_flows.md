# 07 — User Flows

## Purpose
Describe real user flows and where they are complete vs incomplete.

## Status
- Last updated: 2026-03-21
- **Confirmed from code** for implemented flows below.

## Confirmed from code

### 1) App open / landing
1. App initializes DB, IPC handlers, and scheduler in main process.
2. Scheduler registers enabled jobs and performs missed-run checks.
3. Window opens with sidebar tabs; default tab is Schedules.
4. Renderer loads schedules + next fire times through context refresh.

### 2) Create schedule
1. User opens New Schedule modal from Schedules tab or Calendar empty date.
2. User enters recipient (manual phone or Contacts search), message, schedule type.
3. For one-time: pick future datetime.
4. For daily/weekly: pick time/day.
5. For quarterly/half-yearly/yearly: configure recurrence via Extended Schedule dialog.
6. Optional dry-run toggle.
7. Submit -> IPC `schedule:create` (validation) -> DB insert -> job registration -> UI refresh + toast.

### 3) Edit schedule
1. User clicks edit on a schedule card or calendar event popover.
2. Modal opens with prefilled values.
3. Submit -> `schedule:update` -> DB update -> reschedule job -> refresh + toast.

### 4) Duplicate schedule
1. User clicks duplicate.
2. Frontend sends copied payload as new create request.
3. New schedule is inserted and shown after refresh.

### 5) Toggle enable/disable
1. User flips switch on schedule card.
2. `schedule:toggle` updates DB and registers/cancels in-memory job.

### 6) Manual test send
1. User clicks play icon.
2. If schedule dry-run is off, UI asks confirmation.
3. Confirm -> `schedule:testSend` executes scheduler send path.
4. Renderer gets `SendResult`; activity logs update via `schedule:executed`.

### 7) Calendar interaction
1. Calendar expands recurrence occurrences into visible month grid.
2. Click empty day -> create modal prefilled with selected date.
3. Click day with schedules -> popover list, then edit existing or add new.

### 8) Activity log flow
1. Activity tab loads latest logs.
2. User filters by status and can clear logs with confirmation.
3. Log list auto-refreshes when `schedule:executed` event arrives.

### 9) Settings flow
1. Settings tab loads app settings from DB.
2. User can check accessibility/contacts permission status.
3. User updates global dry-run, default country code, send delay, app name, and start-at-login.
4. Settings save via immediate switches and debounced inputs.

### 10) Background runtime flow
1. User closes window.
2. App hides to tray instead of quitting.
3. Scheduler continues in main process.
4. User can restore window from tray click/menu or quit explicitly from tray menu.

## Important details
- Login/signup/admin flows are not present by design (single local-user app).
- On wake from sleep, scheduler re-sync runs automatically.
- One-time schedules are auto-disabled after execution attempt.

## Open issues / gaps
- No first-run guided onboarding for permissions and reliability constraints.
- No UI control for `max_retries` despite backend support.
- No sync/backup workflow for restoring schedules across devices.

## Recommended next steps
1. Add a startup checklist flow (permissions, WhatsApp running, dry-run recommendation).
2. Add retry settings control + explanation in Settings.
3. Add export/import + optional auto-backup flow.
