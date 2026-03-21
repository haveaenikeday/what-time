import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { chmodSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { nanoid } from 'nanoid'
import { createLogger } from '../utils/logger'
import type {
  Schedule,
  CreateScheduleInput,
  UpdateScheduleInput,
  RunLog,
  RunStatus,
  AppSettings
} from '../../shared/types'

const log = createLogger('db')

let db: Database.Database

function getDbPath(): string {
  return join(app.getPath('userData'), 'schedules.db')
}

// Migrate DB from old "WA Scheduler" userData path to new "WhaTime" path
function migrateFromOldPath(): void {
  const oldDir = join(app.getPath('home'), 'Library', 'Application Support', 'WA Scheduler')
  const oldDb = join(oldDir, 'schedules.db')
  const newDb = getDbPath()

  if (!existsSync(oldDb)) return

  // If new DB exists, only skip migration if it already has data
  if (existsSync(newDb)) {
    try {
      const tempDb = new Database(newDb, { readonly: true })
      let count = 0
      try {
        const row = tempDb.prepare('SELECT COUNT(*) as count FROM schedules').get() as { count: number }
        count = row?.count ?? 0
      } catch {
        // Table doesn't exist yet — treat as empty
      }
      tempDb.close()
      if (count > 0) return // New DB has data — don't overwrite
      // count === 0: fall through to overwrite with old data
    } catch {
      return // Can't open new DB — leave it alone
    }
  }

  try {
    const newDir = app.getPath('userData')
    if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true })
    copyFileSync(oldDb, newDb)
    // Also copy WAL/SHM files if they exist
    if (existsSync(oldDb + '-wal')) copyFileSync(oldDb + '-wal', newDb + '-wal')
    if (existsSync(oldDb + '-shm')) copyFileSync(oldDb + '-shm', newDb + '-shm')
    log.info(`Migrated database from "${oldDir}" to "${newDir}"`)
  } catch (err) {
    log.error('Failed to migrate database from old path', err)
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id            TEXT PRIMARY KEY,
  phone_number  TEXT NOT NULL,
  contact_name  TEXT NOT NULL DEFAULT '',
  message       TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  scheduled_at  TEXT,
  time_of_day   TEXT,
  day_of_week   INTEGER,
  day_of_month  INTEGER,
  month_of_year INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  dry_run       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS run_logs (
  id            TEXT PRIMARY KEY,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK(status IN ('success', 'failed', 'dry_run', 'skipped')),
  error_message TEXT,
  fired_at      TEXT NOT NULL,
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_logs_schedule ON run_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_run_logs_fired_at ON run_logs(fired_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('global_dry_run', '0'),
  ('default_country_code', '+1'),
  ('send_delay_ms', '3000'),
  ('whatsapp_app', 'WhatsApp'),
  ('open_at_login', '0'),
  ('max_retries', '3'),
  ('theme', 'system');
`

const VALID_SETTINGS_KEYS = new Set([
  'global_dry_run',
  'default_country_code',
  'send_delay_ms',
  'whatsapp_app',
  'open_at_login',
  'max_retries',
  'theme'
])

// Map a DB row (snake_case) to a Schedule (camelCase)
function rowToSchedule(row: Record<string, unknown>): Schedule {
  return {
    id: row.id as string,
    phoneNumber: row.phone_number as string,
    contactName: row.contact_name as string,
    message: row.message as string,
    scheduleType: row.schedule_type as Schedule['scheduleType'],
    scheduledAt: row.scheduled_at as string | null,
    timeOfDay: row.time_of_day as string | null,
    dayOfWeek: row.day_of_week as number | null,
    dayOfMonth: row.day_of_month as number | null,
    monthOfYear: row.month_of_year as number | null,
    enabled: row.enabled === 1,
    dryRun: row.dry_run === 1,
    lastFiredAt: (row.last_fired_at as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function rowToRunLog(row: Record<string, unknown>): RunLog {
  return {
    id: row.id as string,
    scheduleId: row.schedule_id as string,
    status: row.status as RunStatus,
    errorMessage: row.error_message as string | null,
    firedAt: row.fired_at as string,
    completedAt: row.completed_at as string | null,
    executionDuration: row.execution_duration as number | undefined,
    scheduledTime: row.scheduled_time as string | undefined,
    retryAttempt: row.retry_attempt as number | undefined,
    retryOf: row.retry_of as string | undefined,
    phoneNumber: row.phone_number as string | undefined,
    contactName: row.contact_name as string | undefined,
    messagePreview: row.message_preview as string | undefined
  }
}

export function initDb(): void {
  migrateFromOldPath()
  const dbPath = getDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Integrity check on startup
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[]
  if (integrity[0]?.integrity_check !== 'ok') {
    log.error('Database integrity check failed', integrity)
  } else {
    log.info(`Database opened: ${dbPath}`)
  }

  db.exec(SCHEMA)

  // Add new columns to existing DBs (fails silently if column already exists)
  try { db.exec('ALTER TABLE schedules ADD COLUMN day_of_month INTEGER') } catch {}
  try { db.exec('ALTER TABLE schedules ADD COLUMN month_of_year INTEGER') } catch {}
  try { db.exec('ALTER TABLE run_logs ADD COLUMN execution_duration INTEGER') } catch {}
  try { db.exec('ALTER TABLE run_logs ADD COLUMN scheduled_time TEXT') } catch {}
  try { db.exec('ALTER TABLE schedules ADD COLUMN last_fired_at TEXT') } catch {}
  try { db.exec('ALTER TABLE run_logs ADD COLUMN retry_attempt INTEGER DEFAULT 0') } catch {}
  try { db.exec('ALTER TABLE run_logs ADD COLUMN retry_of TEXT') } catch {}

  // Set DB file permissions to owner-only
  try { chmodSync(dbPath, 0o600) } catch {}

  // Auto-prune logs older than 90 days on startup
  pruneOldLogs(90)
}

export function pruneOldLogs(olderThanDays: number): void {
  const result = db.prepare(
    `DELETE FROM run_logs WHERE fired_at < datetime('now', '-' || ? || ' days')`
  ).run(olderThanDays)
  if (result.changes > 0) {
    log.info(`Pruned ${result.changes} log entries older than ${olderThanDays} days`)
  }
}

// --- Schedules ---

export function getAllSchedules(): Schedule[] {
  const rows = db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all()
  return (rows as Record<string, unknown>[]).map(rowToSchedule)
}

export function getScheduleById(id: string): Schedule | null {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id)
  return row ? rowToSchedule(row as Record<string, unknown>) : null
}

export function createSchedule(input: CreateScheduleInput): Schedule {
  const id = nanoid()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO schedules (id, phone_number, contact_name, message, schedule_type, scheduled_at, time_of_day, day_of_week, day_of_month, month_of_year, dry_run, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.phoneNumber,
    input.contactName || '',
    input.message,
    input.scheduleType,
    input.scheduledAt || null,
    input.timeOfDay || null,
    input.dayOfWeek ?? null,
    input.dayOfMonth ?? null,
    input.monthOfYear ?? null,
    input.dryRun ? 1 : 0,
    now,
    now
  )
  return getScheduleById(id)!
}

export function updateSchedule(id: string, input: UpdateScheduleInput): Schedule {
  const existing = getScheduleById(id)
  if (!existing) throw new Error(`Schedule ${id} not found`)

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE schedules SET
      phone_number = ?,
      contact_name = ?,
      message = ?,
      schedule_type = ?,
      scheduled_at = ?,
      time_of_day = ?,
      day_of_week = ?,
      day_of_month = ?,
      month_of_year = ?,
      enabled = ?,
      dry_run = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.phoneNumber ?? existing.phoneNumber,
    input.contactName ?? existing.contactName,
    input.message ?? existing.message,
    input.scheduleType ?? existing.scheduleType,
    input.scheduledAt !== undefined ? input.scheduledAt || null : existing.scheduledAt,
    input.timeOfDay !== undefined ? input.timeOfDay || null : existing.timeOfDay,
    input.dayOfWeek !== undefined ? (input.dayOfWeek ?? null) : existing.dayOfWeek,
    input.dayOfMonth !== undefined ? (input.dayOfMonth ?? null) : existing.dayOfMonth,
    input.monthOfYear !== undefined ? (input.monthOfYear ?? null) : existing.monthOfYear,
    input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    input.dryRun !== undefined ? (input.dryRun ? 1 : 0) : (existing.dryRun ? 1 : 0),
    now,
    id
  )
  return getScheduleById(id)!
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
}

export function toggleSchedule(id: string, enabled: boolean): Schedule {
  return updateSchedule(id, { enabled })
}

/**
 * Find schedules that might conflict (same phone + overlapping fire time).
 * Returns matching schedule IDs (excluding the given excludeId).
 */
export function findConflicts(
  phoneNumber: string,
  scheduleType: string,
  scheduledAt: string | null,
  timeOfDay: string | null,
  dayOfWeek: number | null,
  excludeId?: string
): Schedule[] {
  const phone = phoneNumber.replace(/[\s\-()]/g, '')

  // Find schedules with same phone number (normalized)
  const rows = db.prepare(
    `SELECT * FROM schedules WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '(', ''), ')', '') = ? AND enabled = 1`
  ).all(phone) as Record<string, unknown>[]

  const candidates = rows.map(rowToSchedule).filter((s) => s.id !== excludeId)

  // Check for time overlap
  return candidates.filter((existing) => {
    // one_time vs one_time: exact datetime match
    if (scheduleType === 'one_time' && existing.scheduleType === 'one_time') {
      if (!scheduledAt || !existing.scheduledAt) return false
      return new Date(scheduledAt).getTime() === new Date(existing.scheduledAt).getTime()
    }

    // Both recurring with same timeOfDay
    if (timeOfDay && existing.timeOfDay && timeOfDay === existing.timeOfDay) {
      // daily overlaps with everything at that time
      if (scheduleType === 'daily' || existing.scheduleType === 'daily') return true

      // weekly: same day of week
      if (scheduleType === 'weekly' && existing.scheduleType === 'weekly') {
        return dayOfWeek === existing.dayOfWeek
      }
    }

    return false
  })
}

// --- Run Logs ---

export function insertRunLog(
  scheduleId: string,
  status: RunStatus,
  errorMessage?: string,
  executionDurationMs?: number,
  scheduledTime?: string,
  retryAttempt?: number,
  retryOf?: string
): RunLog {
  const id = nanoid()
  const firedAt = new Date().toISOString()
  const completedAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO run_logs (id, schedule_id, status, error_message, fired_at, completed_at, execution_duration, scheduled_time, retry_attempt, retry_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, scheduleId, status, errorMessage || null, firedAt, completedAt, executionDurationMs ?? null, scheduledTime || null, retryAttempt ?? 0, retryOf || null)

  return {
    id,
    scheduleId,
    status,
    errorMessage: errorMessage || null,
    firedAt,
    completedAt,
    executionDuration: executionDurationMs,
    scheduledTime: scheduledTime || undefined,
    retryAttempt: retryAttempt ?? 0,
    retryOf: retryOf || undefined
  }
}

export function updateLastFiredAt(scheduleId: string): void {
  db.prepare('UPDATE schedules SET last_fired_at = ? WHERE id = ?').run(new Date().toISOString(), scheduleId)
}

export function getLogs(limit = 100): RunLog[] {
  const rows = db
    .prepare(
      `SELECT l.*, s.phone_number, s.contact_name, substr(s.message, 1, 80) as message_preview
       FROM run_logs l
       LEFT JOIN schedules s ON l.schedule_id = s.id
       ORDER BY l.fired_at DESC
       LIMIT ?`
    )
    .all(limit)
  return (rows as Record<string, unknown>[]).map(rowToRunLog)
}

export function getLogsBySchedule(scheduleId: string): RunLog[] {
  const rows = db
    .prepare(
      `SELECT l.*, s.phone_number, s.contact_name, substr(s.message, 1, 80) as message_preview
       FROM run_logs l
       LEFT JOIN schedules s ON l.schedule_id = s.id
       WHERE l.schedule_id = ?
       ORDER BY l.fired_at DESC
       LIMIT 50`
    )
    .all(scheduleId)
  return (rows as Record<string, unknown>[]).map(rowToRunLog)
}

export function clearLogs(olderThanDays?: number): void {
  if (olderThanDays) {
    db.prepare(
      `DELETE FROM run_logs WHERE fired_at < datetime('now', '-' || ? || ' days')`
    ).run(olderThanDays)
  } else {
    db.prepare('DELETE FROM run_logs').run()
  }
}

// --- Settings ---

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value

  return {
    globalDryRun: map.global_dry_run === '1',
    defaultCountryCode: map.default_country_code || '+1',
    sendDelayMs: parseInt(map.send_delay_ms || '3000', 10),
    whatsappApp: map.whatsapp_app || 'WhatsApp',
    openAtLogin: map.open_at_login === '1',
    maxRetries: parseInt(map.max_retries || '3', 10),
    theme: (map.theme as 'system' | 'light' | 'dark') || 'system'
  }
}

export function updateSetting(key: string, value: string): void {
  if (!VALID_SETTINGS_KEYS.has(key)) {
    throw new Error(`Invalid settings key: ${key}`)
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function closeDb(): void {
  if (db) {
    // Checkpoint WAL for clean shutdown
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    db.close()
    log.info('Database closed')
  }
}
