# 05 — Database Schema

## Purpose
Document the implemented local database model and behavior used by the app.

## Status
- Last updated: 2026-03-21
- **Confirmed from code**: SQLite schema/mappings in `electron/services/db.service.ts`.
- Runtime `SCHEMA` in `db.service.ts` is the canonical source in this repo.

## Confirmed from code

### Engine and location
- Engine: SQLite via `better-sqlite3`.
- Open mode: WAL enabled and foreign keys enabled at init.
- DB file path: `join(app.getPath('userData'), 'schedules.db')`.

### Table: `schedules`
Columns implemented in runtime SCHEMA:
- `id TEXT PRIMARY KEY`
- `phone_number TEXT NOT NULL`
- `contact_name TEXT NOT NULL DEFAULT ''`
- `message TEXT NOT NULL`
- `schedule_type TEXT NOT NULL`
- `scheduled_at TEXT`
- `time_of_day TEXT`
- `day_of_week INTEGER`
- `day_of_month INTEGER`
- `month_of_year INTEGER`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `dry_run INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL DEFAULT datetime('now','localtime')`
- `updated_at TEXT NOT NULL DEFAULT datetime('now','localtime')`
- `last_fired_at TEXT` (migration-added)

Usage notes:
- One-time schedules use `scheduled_at`.
- Daily/weekly use `time_of_day`; weekly also uses `day_of_week`.
- Quarterly/half-yearly/yearly use `day_of_month` and `month_of_year`.

### Table: `run_logs`
Columns implemented in runtime SCHEMA/migrations:
- `id TEXT PRIMARY KEY`
- `schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE`
- `status TEXT NOT NULL CHECK(status IN ('success','failed','dry_run','skipped'))`
- `error_message TEXT`
- `fired_at TEXT NOT NULL`
- `completed_at TEXT`
- `execution_duration INTEGER` (migration)
- `scheduled_time TEXT` (migration)
- `retry_attempt INTEGER DEFAULT 0` (migration)
- `retry_of TEXT` (migration)

Indexes:
- `idx_run_logs_schedule(schedule_id)`
- `idx_run_logs_fired_at(fired_at DESC)`

### Table: `settings`
- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`

Seeded default keys:
- `global_dry_run = '0'`
- `default_country_code = '+1'`
- `send_delay_ms = '3000'`
- `whatsapp_app = 'WhatsApp'`
- `open_at_login = '0'`
- `max_retries = '3'`

### Relationships and ownership
- `schedules (1) -> (many) run_logs` via `schedule_id`, cascade delete enabled.
- No user/account ownership columns (single local-user model).

### Migrations and retention
- Startup `ALTER TABLE` attempts for legacy DB compatibility.
- Startup log pruning: deletes run logs older than 90 days.
- DB integrity check runs at startup.

## Important details
- App-level camelCase mapping is handled by `rowToSchedule` and `rowToRunLog`.
- Settings values are stored as text and parsed to booleans/numbers at read time.
- `updateSetting` now enforces a key whitelist (`VALID_SETTINGS_KEYS`).
- DB file permissions are tightened to owner-only (`chmod 600`) where possible.

## Open issues / gaps
- SQL does not enforce full schedule-type/field compatibility (validation is mostly in IPC/app logic).
- No migration version table/history; migrations are opportunistic `ALTER TABLE ... try/catch`.
- No encryption at rest for SQLite file.

## Recommended next steps
1. Add DB-level constraints for core recurrence validity where practical.
2. Introduce migration version tracking for safer schema evolution.
3. Add optional encrypted backup/export flow for portability + privacy.
