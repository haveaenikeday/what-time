# WhatsApp Text Scheduler

A local macOS desktop app for scheduling WhatsApp messages. No cloud backend, no unofficial APIs — just local scheduling + macOS automation.

## How It Works

### Scheduling
- The Electron main process runs `node-schedule` jobs in-memory
- Schedules are persisted in a local SQLite database (`~/Library/Application Support/whatsapp-text-scheduler/schedules.db`)
- On app startup, all enabled schedules are loaded and registered as jobs
- Supports one-time, daily, and weekly recurring schedules
- One-time schedules auto-disable after firing

### WhatsApp Sending
1. Opens the WhatsApp chat via the `whatsapp://send?phone=NUMBER&text=MESSAGE` URL scheme
2. Waits a configurable delay (default 3s) for WhatsApp to load the chat
3. Uses AppleScript + System Events to press Enter, sending the pre-filled message
4. Logs the result (success/failed/dry-run) to the run history

### Dry Run Mode
- Per-schedule or global toggle
- Opens WhatsApp with the message pre-filled but does NOT press Enter
- Lets you visually verify the message before enabling live sends

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron + electron-vite |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui components |
| Database | SQLite via better-sqlite3 |
| Scheduling | node-schedule (in-process cron) |
| Automation | AppleScript via osascript (child_process) |

### Why Electron?
- Direct Node.js access for `child_process` (osascript), native SQLite, and in-process scheduling
- No Rust toolchain needed (unlike Tauri)
- Standard debugging via Chrome DevTools
- Bundle size is irrelevant for a personal local utility

## Prerequisites

- macOS (Apple Silicon or Intel)
- Node.js 18+
- WhatsApp Desktop installed and logged in
- **Accessibility permission** granted to the app (required for System Events keystrokes)

## Setup

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron
npm run rebuild

# Start in development mode
npm run dev
```

## Accessibility Permission

The app needs Accessibility permission to send keystrokes to WhatsApp via System Events.

1. Open **System Settings > Privacy & Security > Accessibility**
2. Click the lock icon to make changes
3. Add the Electron app (in dev mode, this is the Electron binary)
4. The Settings page in the app has a "Check" button and a link to open System Settings

## Usage

### Creating a Schedule
1. Click **New Schedule** on the Dashboard
2. Enter the recipient's phone number (with country code, e.g., +14155551234)
3. Type your message
4. Choose schedule type: One-time, Daily, or Weekly
5. Set the date/time
6. Optionally enable Dry Run
7. Click **Create**

### Testing Safely
1. Enable **Dry Run** on the schedule (or use Global Dry Run in Settings)
2. Click the **Play** button on any schedule to test immediately
3. WhatsApp will open with the message pre-filled, but won't send
4. Check the Activity tab for the dry-run log entry

### Managing Schedules
- **Toggle** the switch to enable/disable a schedule
- **Edit** (pencil icon) to modify
- **Duplicate** (copy icon) to create a copy
- **Delete** (trash icon) with confirmation

## Known Limitations

- **Mac must be unlocked** and logged in for automation to work
- **WhatsApp Desktop must be running** and logged in
- **App must be running** for schedules to fire (no background daemon)
- **UI automation is fragile** — may break if WhatsApp changes its interface layout
- **Group messages not supported** — the URL scheme targets phone numbers only
- **No encryption** of local data (SQLite is plaintext on disk)
- **Not a replacement** for WhatsApp Business API — this is personal use only
- **Single recipient per schedule** — no broadcast/bulk messaging

## Project Structure

```
electron/                  # Main process (Node.js)
  main.ts                  # App entry, window, lifecycle
  preload.ts               # IPC context bridge
  ipc/                     # IPC handlers (schedule, logs, settings)
  services/
    db.service.ts          # SQLite CRUD operations
    scheduler.service.ts   # node-schedule job management
    whatsapp.service.ts    # AppleScript bridge + URL scheme
  utils/
    applescript.ts         # osascript wrapper
src/                       # Renderer (React)
  pages/                   # Dashboard, Logs, Settings
  components/              # ScheduleForm, ScheduleModal, StatusBadge
  hooks/                   # useSchedules, useLogs, useSettings
  lib/                     # IPC client, utilities
shared/
  types.ts                 # TypeScript types shared across IPC
```

## Build

```bash
# Production build
npm run build
```
