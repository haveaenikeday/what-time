# 13 — Prompt Context

## Purpose
Reusable context for future coding agents working on this repository.

## Status
- Last updated: 2026-03-21
- **Confirmed from code** baseline.
- Keep this file updated whenever architecture/contracts materially change.

## Confirmed from code

### What this app is
- Local macOS Electron utility that schedules WhatsApp messages.
- Uses local SQLite + in-process scheduler + AppleScript automation.
- No cloud backend, no account system, no web auth flow.

### Non-negotiable product goals
- Stay local-first and privacy-preserving.
- Preserve reliable scheduling behavior within app-runtime constraints.
- Keep UX simple for single-user operation.

### Stack summary
- Electron main/preload + React renderer (TypeScript).
- `better-sqlite3` for persistence.
- `node-schedule` for recurrence.
- Tailwind + local UI primitives.
- AppleScript via `osascript` for send automation and Contacts lookup.

### Architecture rules
- Use preload bridge (`window.api`) for renderer-main communication; no direct Node calls from renderer.
- Keep `shared/types.ts` as contract source for shared shapes.
- When changing DB fields, update: SCHEMA/migrations -> row mappers -> shared types -> IPC/preload -> renderer consumers.
- Preserve event-driven refresh behavior based on `schedule:executed`.

### Reliability behavior to preserve
- One-time missed schedules become `skipped` and auto-disable at startup.
- Recurring missed runs trigger one immediate catch-up execution on startup/wake.
- Failed sends can retry with exponential backoff (respect `max_retries`).
- Close-to-tray behavior keeps scheduler alive unless explicitly quit.

### Design rules
- Maintain current desktop shell pattern (sidebar + tab content).
- Reuse existing UI primitives and utility classes for consistency.
- Keep macOS traffic-light top padding behavior intact unless title bar model changes.

### Things to preserve
- Recurrence support across all 6 schedule types.
- Dry-run semantics (schedule-level and global override).
- Local-only data model unless explicit product direction changes.
- Permission checks and user-facing guidance in Settings.

## Current weak points
- In-process scheduler still depends on process uptime (force-quit risk).
- No first-run onboarding/checklist.
- No sync/portable backup workflow.
- No standardized IPC error envelope.

## Nonexistent systems agents should not assume
- HTTP backend
- Auth provider/session middleware
- Cloud DB/RLS
- Multi-user permission model

## Validation baseline
- Tests currently exist for scheduler logic, IPC channel completeness, IPC input validation, and type mapping.
- Minimum pre-merge check: `npm run test` and `npm run build`.

## Recommended next steps for future agents
1. Validate current behavior against `electron/services/*`, `electron/ipc/*`, and `shared/types.ts`.
2. If changing contracts, update both types and runtime handlers in the same PR.
3. Keep docs in `notes/` aligned whenever runtime behavior changes.
4. Avoid introducing cloud dependencies unless explicitly requested.
