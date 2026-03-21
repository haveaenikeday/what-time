# 00 — Overview

## Purpose
Document what this repository currently ships: a local macOS desktop scheduler for WhatsApp messages.

## Status
- Last updated: 2026-03-21
- **Confirmed from code** for core runtime behavior.
- Current maturity: solid personal utility with reliability hardening, logging, and packaging support.

## Confirmed from code
- Product type: Electron desktop app (`electron/main.ts`) with React renderer (`src/App.tsx`).
- Core capability: schedule WhatsApp sends via `whatsapp://` + AppleScript Enter automation (`electron/services/whatsapp.service.ts`).
- Scheduling engine: in-process `node-schedule` jobs (`electron/services/scheduler.service.ts`).
- Persistence: local SQLite via `better-sqlite3` (`electron/services/db.service.ts`).
- Supported recurrence: `one_time`, `daily`, `weekly`, `quarterly`, `half_yearly`, `yearly`.
- Reliability additions: recurring missed-run catch-up, retry backoff, screen-lock skip detection, single-instance lock.
- Runtime resilience: close-to-tray behavior, optional open-at-login, wake resync, uncaught exception logging.
- UI surface: tabbed app with Schedules, Calendar, Activity, Settings.
- No cloud/backend HTTP service and no account/auth model in runtime code.

## Repo reality
| Area | Reality in this repo |
|---|---|
| Scheduling | Implemented and active in main process |
| Message delivery | Implemented via local UI automation |
| Logs/history | Implemented in SQLite + Activity tab |
| Calendar visualization | Implemented |
| Contacts lookup | Implemented via AppleScript to macOS Contacts |
| Authentication | Not implemented (single local-user model) |
| Cloud backend/API | Not found in repository |
| Automated tests | Implemented (`tests/*`, Vitest) |

## Open issues / gaps
- Scheduler still depends on app process availability (tray mitigates this but force-quit still stops timers).
- AppleScript automation still depends on unlocked macOS session + permission grants.
- No sync/backup flow for schedules across devices.
- No template/bulk-send workflow yet.

## Recommended next steps
1. Add first-run preflight onboarding (permissions, WhatsApp readiness, reliability expectations).
2. Add import/export + optional sync strategy (local backup first, then optional cloud provider adapters).
3. Continue expanding test coverage around IPC validation, retries, and DB migrations.
