# 12 — Roadmap

## Purpose
Provide a practical, repo-specific plan of improvements aligned with current architecture.

## Status
- Last updated: 2026-03-21
- Items below are **proposed next steps** after the recent reliability hardening pass.

## Recently completed (current branch/code state)
1. `testSend` IPC contract aligned to `SendResult`.
2. Retry/backoff support added with `max_retries` setting.
3. Recurring missed-run catch-up added for startup/wake.
4. Settings key whitelist enforcement added.
5. Tray runtime, start-at-login sync, single-instance lock, and structured logging added.
6. Baseline automated tests added (scheduler logic, IPC contract/validation, type mapping).

## Next priority (high impact)
1. Add first-run onboarding checklist (Accessibility, Contacts, WhatsApp readiness, reliability notes).
2. Expose retry policy in Settings (`max_retries` control + safe value bounds).
3. Add diagnostics panel (“why didn’t it send?” with last run details and actionable fixes).

## Better UI (focused improvements)
1. Add global quick actions in header (New, Pause All, Dry-Run All).
2. Add richer log cards (retry chain grouping, copy error details, filter by schedule).
3. Add calendar execution overlays (sent/failed/skipped markers by day).
4. Add compact mode / dense list for heavy schedule volumes.
5. Add full dark theme token set (currently only light tokens are complete).

## Better workflow
1. Add templates/snippets for repeated messages.
2. Add bulk operations (pause/resume/delete multiple schedules).
3. Add guardrails in create flow (conflict warning for same recipient/time).
4. Add import/export (JSON) with validation + preview before apply.
5. Add undo window for destructive actions (delete schedule, clear logs).

## Sync strategy (phased)
1. **Phase 1 (safe/local):** Manual export/import backups with schema versioning.
2. **Phase 2 (semi-auto):** Optional auto-backup folder (iCloud/Dropbox-compatible file path).
3. **Phase 3 (advanced):** Optional multi-device sync adapter with conflict resolution policy.

## Medium-term engineering
1. Standardize IPC response envelope for typed error handling in UI.
2. Add migration version table + explicit migration files.
3. Add end-to-end smoke tests for scheduler lifecycle (startup/wake/retry paths).
4. Add release checklist automation for packaging validation.

## Long-term options
1. Optional LaunchAgent/background service mode for stronger always-on reliability.
2. Optional signed/notarized distribution workflow for broader sharing.
3. Optional plugin/provider model for additional messaging channels.

## Recommended next steps
1. Convert “Next priority” into tracked issues with acceptance criteria.
2. Build onboarding + diagnostics first (highest user-friction reduction).
3. Start sync with manual export/import before attempting live multi-device sync.
