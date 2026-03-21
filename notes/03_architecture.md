# 03 — Architecture

## Purpose
Describe runtime architecture, data movement, and platform dependencies.

## Status
- Last updated: 2026-03-21
- **Confirmed from code** for process boundaries, IPC, DB, scheduler, and automation.
- **Not found in repository**: external backend service, cloud API, or account system.

## Confirmed from code

### Frontend stack
- React 18 + TypeScript renderer built via Vite/electron-vite (`src/*`, `electron.vite.config.ts`).
- Tailwind CSS + local UI primitives in `src/components/ui`.
- App shell uses tab state, not URL router (`src/App.tsx`).

### Backend stack (local main process)
- Electron main process hosts persistence, scheduling, and automation services.
- SQLite (`better-sqlite3`) for schedules/logs/settings.
- `node-schedule` for in-memory recurrence jobs.
- AppleScript execution via `osascript` wrappers in `electron/utils/applescript.ts`.

### Process/data architecture diagram
```text
Renderer (React)                                    Main (Electron Node)
----------------                                    --------------------
Pages/Components/Hooks
  -> window.api (preload bridge)
     -> ipcRenderer.invoke(channel, ...args)
        -> ipcMain handlers (schedule/logs/settings/contacts)
           -> db.service (SQLite)
           -> scheduler.service (node-schedule job map)
           -> whatsapp.service (open whatsapp:// + AppleScript Enter)

Job execution path:
node-schedule fires -> executeJob(scheduleId)
  -> load schedule from DB
  -> sendWhatsAppMessage(...)
  -> insert run log
  -> update last_fired_at
  -> optional retry scheduling (transient failures)
  -> disable one-time when applicable
  -> emit schedule:executed to renderer
  -> show native Notification
```

### State management
- Shared schedule state managed by `ScheduleProvider` context.
- Logs/settings use focused hooks with IPC refresh calls.
- Event-driven refresh on `schedule:executed` prevents polling loops.

### App lifecycle + runtime resilience
- Close button hides window instead of quitting (tray mode keeps scheduler alive).
- Single instance lock prevents duplicate processes.
- Startup syncs login-item setting from DB (`open_at_login`).
- Wake from sleep triggers scheduler resync and missed-run detection.
- Uncaught exception/rejection handlers log errors without immediate process exit.

### Hosting/deployment model
- Local packaged desktop app (electron-builder).
- No deployed web frontend/backend separation.
- Local SQLite file in Electron user-data directory.

### Third-party/system dependencies
- WhatsApp Desktop app (deep link + foreground activation).
- macOS Accessibility permission for System Events keystrokes.
- macOS Contacts permission for contact lookup feature.

## Important details
- One-time missed schedules are skipped + auto-disabled at startup.
- Recurring missed schedules get a one-shot immediate catch-up execution.
- Retry backoff is implemented for retryable failures (respecting `max_retries`).
- Main process emits both IPC execution events and native notifications.

## Open issues / gaps
- Scheduler is still in-process (force-quit/kill means no execution until relaunch).
- No standardized success/error envelope across all IPC channels.
- Missed-run catch-up does not replay every missed interval; it catches up once per schedule.

## Recommended next steps
1. Decide whether app-runtime scheduling is sufficient or if LaunchAgent-style execution is needed.
2. Standardize IPC error envelopes for better UI diagnostics.
3. Add preflight/onboarding architecture for permissions and app-readiness checks.
