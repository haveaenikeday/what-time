import * as schedule from 'node-schedule'
import { getAllSchedules, getScheduleById, getSettings, insertRunLog, toggleSchedule, updateLastFiredAt } from './db.service'
import { sendWhatsAppMessage } from './whatsapp.service'
import { runAppleScript } from '../utils/applescript'
import { createLogger } from '../utils/logger'
import type { Schedule, RunLog } from '../../shared/types'

const log = createLogger('scheduler')

// In-memory map of active node-schedule jobs
const jobs = new Map<string, schedule.Job>()

// Mutex: set of schedule IDs currently executing (prevents double-send)
const executing = new Set<string>()

// Pending retry timeouts per schedule ID
const pendingRetries = new Map<string, NodeJS.Timeout>()

// Callback for notifying the renderer when a job executes
let onExecutedCallback: ((log: RunLog) => void) | null = null

// Retry backoff intervals in ms (indexed by attempt number: 0→10s, 1→30s, 2→90s)
const RETRY_BACKOFF_MS = [10_000, 30_000, 90_000]

// Errors that should not be retried (non-transient)
const NON_RETRYABLE_PATTERNS = [
  'not allowed assistive access',
  'Accessibility permission',
  'Screen locked',
  'Screen saver is running'
]

export function setOnExecutedCallback(cb: (log: RunLog) => void): void {
  onExecutedCallback = cb
}

/**
 * Initialize scheduler: load all enabled schedules from DB, register jobs,
 * detect missed one-time schedules, and catch up missed recurring runs.
 */
export function initScheduler(): void {
  const schedules = getAllSchedules()
  const missedRecurring: Schedule[] = []

  for (const s of schedules) {
    if (!s.enabled) continue

    // Detect missed one-time schedules (past date, still enabled = app was closed)
    if (s.scheduleType === 'one_time' && s.scheduledAt) {
      const fireDate = new Date(s.scheduledAt)
      if (fireDate <= new Date()) {
        insertRunLog(s.id, 'skipped', 'Missed: app was not running at scheduled time', undefined, s.scheduledAt)
        toggleSchedule(s.id, false)
        log.info(`Missed one-time schedule ${s.id} — marked as skipped`)
        continue
      }
    }

    // Collect recurring schedules that may have missed runs
    if (s.scheduleType !== 'one_time') {
      missedRecurring.push(s)
    }

    registerJob(s)
  }

  // Detect and catch up missed recurring runs
  detectAndCatchUpMissedRuns(missedRecurring)

  log.info(`Scheduler initialized: ${jobs.size} active jobs`)
}

/**
 * For each recurring schedule, check if the most recent expected fire time
 * is after last_fired_at. If so, fire once immediately to catch up.
 */
function detectAndCatchUpMissedRuns(schedules: Schedule[]): void {
  const now = new Date()

  for (const s of schedules) {
    const expected = getMostRecentExpectedFire(s, now)
    if (!expected) continue

    const lastFired = s.lastFiredAt ? new Date(s.lastFiredAt) : null

    // If never fired, or last fired before the most recent expected fire time
    if (!lastFired || lastFired < expected) {
      const missedCount = lastFired ? 'at least 1' : 'unknown'
      insertRunLog(s.id, 'skipped', `Missed ${missedCount} run(s): app was not running`, undefined, expected.toISOString())
      log.info(`Catching up missed recurring schedule ${s.id} — firing now`)

      // Fire once immediately (async, don't await — let scheduler continue init)
      executeJob(s.id).catch((err) => {
        log.error(`Failed catch-up execution for ${s.id}`, err)
      })
    }
  }
}

/**
 * Compute the most recent time a recurring schedule should have fired
 * before `now`. Returns null if no expected fire time can be determined.
 */
export function getMostRecentExpectedFire(s: Schedule, now: Date): Date | null {
  if (!s.timeOfDay) return null
  const [hours, minutes] = s.timeOfDay.split(':').map(Number)

  if (s.scheduleType === 'daily') {
    const candidate = new Date(now)
    candidate.setHours(hours, minutes, 0, 0)
    if (candidate > now) {
      candidate.setDate(candidate.getDate() - 1)
    }
    return candidate
  }

  if (s.scheduleType === 'weekly') {
    if (s.dayOfWeek === null || s.dayOfWeek === undefined) return null
    const candidate = new Date(now)
    candidate.setHours(hours, minutes, 0, 0)
    // Go back to the most recent matching day of week
    const currentDay = candidate.getDay()
    let daysBack = (currentDay - s.dayOfWeek + 7) % 7
    if (daysBack === 0 && candidate > now) daysBack = 7
    candidate.setDate(candidate.getDate() - daysBack)
    return candidate
  }

  if (s.scheduleType === 'quarterly' || s.scheduleType === 'half_yearly' || s.scheduleType === 'yearly') {
    if (s.dayOfMonth === null || s.dayOfMonth === undefined) return null

    let targetMonths: number[]
    if (s.scheduleType === 'yearly') {
      if (s.monthOfYear === null || s.monthOfYear === undefined) return null
      targetMonths = [s.monthOfYear]
    } else if (s.scheduleType === 'half_yearly') {
      const start = s.monthOfYear ?? 0
      targetMonths = [start, (start + 6) % 12]
    } else {
      const start = s.monthOfYear ?? 0
      targetMonths = [0, 1, 2, 3].map(i => (start + i * 3) % 12)
    }

    // Sort target months and find the most recent one before now
    targetMonths.sort((a, b) => a - b)

    let best: Date | null = null
    const currentYear = now.getFullYear()

    // Check current year and previous year
    for (const year of [currentYear, currentYear - 1]) {
      for (const month of targetMonths) {
        const candidate = new Date(year, month, s.dayOfMonth, hours, minutes, 0, 0)
        if (candidate <= now && (!best || candidate > best)) {
          best = candidate
        }
      }
    }
    return best
  }

  return null
}

/**
 * Re-sync all jobs after sleep/wake. Cancels existing timers and re-registers
 * from DB state, also detecting any schedules missed during sleep.
 */
export function resyncAfterWake(): void {
  log.info('Resyncing scheduler after wake...')
  // Cancel all existing jobs (but not pending retries — they'll be re-evaluated)
  for (const [, job] of jobs) {
    job.cancel()
  }
  jobs.clear()

  // Re-initialize (also catches missed schedules)
  initScheduler()
}

/**
 * Register a node-schedule job for a given schedule.
 */
export function registerJob(s: Schedule): void {
  // Cancel existing job if any
  cancelJob(s.id)

  let rule: Date | string | schedule.RecurrenceRule

  if (s.scheduleType === 'one_time') {
    if (!s.scheduledAt) return
    const fireDate = new Date(s.scheduledAt)
    if (fireDate <= new Date()) return // Already past
    rule = fireDate
  } else if (s.scheduleType === 'daily') {
    if (!s.timeOfDay) return
    const [hours, minutes] = s.timeOfDay.split(':').map(Number)
    const r = new schedule.RecurrenceRule()
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'weekly') {
    if (!s.timeOfDay || s.dayOfWeek === null || s.dayOfWeek === undefined) return
    const [hours, minutes] = s.timeOfDay.split(':').map(Number)
    const r = new schedule.RecurrenceRule()
    r.dayOfWeek = s.dayOfWeek
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'quarterly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined) return
    const [hours, minutes] = s.timeOfDay.split(':').map(Number)
    const startMonth = s.monthOfYear ?? 0
    const r = new schedule.RecurrenceRule()
    r.month = [0, 1, 2, 3].map(i => (startMonth + i * 3) % 12)
    r.date = s.dayOfMonth
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'half_yearly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined) return
    const [hours, minutes] = s.timeOfDay.split(':').map(Number)
    const startMonth = s.monthOfYear ?? 0
    const r = new schedule.RecurrenceRule()
    r.month = [startMonth, (startMonth + 6) % 12]
    r.date = s.dayOfMonth
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'yearly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined || s.monthOfYear === null || s.monthOfYear === undefined) return
    const [hours, minutes] = s.timeOfDay.split(':').map(Number)
    const r = new schedule.RecurrenceRule()
    r.month = s.monthOfYear
    r.date = s.dayOfMonth
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else {
    return
  }

  const job = schedule.scheduleJob(rule, async () => {
    await executeJob(s.id)
  })

  if (job) {
    jobs.set(s.id, job)
  }
}

/**
 * Cancel and remove a job from the in-memory map.
 * Also clears any pending retry for this schedule.
 */
export function cancelJob(scheduleId: string): void {
  const existing = jobs.get(scheduleId)
  if (existing) {
    existing.cancel()
    jobs.delete(scheduleId)
  }
  clearPendingRetry(scheduleId)
}

/**
 * Clear a pending retry timeout for a schedule.
 */
function clearPendingRetry(scheduleId: string): void {
  const timeout = pendingRetries.get(scheduleId)
  if (timeout) {
    clearTimeout(timeout)
    pendingRetries.delete(scheduleId)
  }
}

/**
 * Re-register a job after a schedule update.
 */
export function rescheduleJob(scheduleId: string): void {
  const s = getScheduleById(scheduleId)
  if (!s) {
    cancelJob(scheduleId)
    return
  }
  if (s.enabled) {
    registerJob(s)
  } else {
    cancelJob(scheduleId)
  }
}

/**
 * Check if an error message indicates a non-retryable condition.
 */
function isNonRetryableError(errorMsg: string): boolean {
  return NON_RETRYABLE_PATTERNS.some(pattern => errorMsg.includes(pattern))
}

/**
 * Schedule a retry for a failed execution.
 */
function scheduleRetry(
  scheduleId: string,
  attempt: number,
  originalLogId: string,
  scheduledTime: string
): void {
  const settings = getSettings()
  const maxRetries = settings.maxRetries

  if (attempt >= maxRetries) {
    const entry = insertRunLog(
      scheduleId, 'failed',
      `Gave up after ${maxRetries} retries`,
      undefined, scheduledTime, attempt
    )
    if (onExecutedCallback) onExecutedCallback(entry)
    log.warn(`Schedule ${scheduleId}: gave up after ${maxRetries} retries`)
    return
  }

  const delayMs = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
  log.info(`Schedule ${scheduleId}: retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`)

  const timeout = setTimeout(async () => {
    pendingRetries.delete(scheduleId)
    await executeJob(scheduleId, attempt, originalLogId, scheduledTime)
  }, delayMs)

  pendingRetries.set(scheduleId, timeout)
}

/**
 * Execute a scheduled job: send the WhatsApp message and log the result.
 * Uses a mutex to prevent double-sends from overlapping timer + manual triggers.
 * Supports retry with backoff on transient failures.
 */
async function executeJob(
  scheduleId: string,
  retryAttempt = 0,
  retryOf?: string,
  existingScheduledTime?: string
): Promise<RunLog | null> {
  // Mutex: skip if already executing this schedule
  if (executing.has(scheduleId)) {
    log.warn(`Schedule ${scheduleId} is already executing, skipping duplicate`)
    return null
  }

  executing.add(scheduleId)
  try {
    const s = getScheduleById(scheduleId)
    if (!s) return null

    const scheduledTime = existingScheduledTime || new Date().toISOString()

    if (!s.enabled) {
      const entry = insertRunLog(scheduleId, 'skipped', 'Schedule is disabled', undefined, scheduledTime)
      if (onExecutedCallback) onExecutedCallback(entry)
      return entry
    }

    // Check if screen is locked before attempting to send
    let screenLocked = false
    try {
      const result = await runAppleScript('tell application "System Events" to return running of screen saver preferences', 5000)
      screenLocked = result.trim() === 'true'
    } catch {
      // If we can't check, proceed anyway
    }

    if (screenLocked) {
      const entry = insertRunLog(scheduleId, 'skipped', 'Screen locked: cannot send via AppleScript', undefined, scheduledTime, retryAttempt, retryOf)
      updateLastFiredAt(scheduleId)
      if (onExecutedCallback) onExecutedCallback(entry)
      return entry
    }

    const phoneMasked = s.phoneNumber.slice(0, -4).replace(/./g, '*') + s.phoneNumber.slice(-4)
    log.info(`Executing ${scheduleId} (${s.scheduleType}) → ${phoneMasked}${s.dryRun ? ' [dry-run]' : ''}${retryAttempt > 0 ? ` [retry ${retryAttempt}]` : ''}`)

    const startTime = Date.now()
    const result = await sendWhatsAppMessage(s.phoneNumber, s.message, s.dryRun)
    const durationMs = Date.now() - startTime

    let status: 'success' | 'failed' | 'dry_run'
    if (result.dryRun) {
      status = 'dry_run'
    } else if (result.success) {
      status = 'success'
    } else {
      status = 'failed'
    }

    log.info(`Execution ${scheduleId} → ${status} (${durationMs}ms)${result.error ? ` error: ${result.error}` : ''}`)

    const entry = insertRunLog(scheduleId, status, result.error, durationMs, scheduledTime, retryAttempt, retryOf)
    updateLastFiredAt(scheduleId)

    // Auto-disable one-time schedules after any execution attempt
    if (s.scheduleType === 'one_time') {
      toggleSchedule(s.id, false)
      cancelJob(s.id)
    }

    if (onExecutedCallback) onExecutedCallback(entry)

    // Schedule retry on failure (if retryable and under limit)
    if (status === 'failed' && result.error && !isNonRetryableError(result.error)) {
      scheduleRetry(scheduleId, retryAttempt + 1, retryOf || entry.id, scheduledTime)
    }

    return entry
  } finally {
    executing.delete(scheduleId)
  }
}

/**
 * Manually trigger a test send for a schedule (respects dry-run setting).
 * Cancels any pending retry to avoid conflicts.
 */
export async function testSendSchedule(scheduleId: string): Promise<RunLog | null> {
  clearPendingRetry(scheduleId)
  return executeJob(scheduleId)
}

/**
 * Get the next scheduled fire time for a given schedule ID.
 */
export function getNextFireTime(scheduleId: string): Date | null {
  const job = jobs.get(scheduleId)
  if (!job) return null
  return job.nextInvocation()?.toDate() ?? null
}

/**
 * Get next fire times for all active jobs.
 */
export function getAllNextFireTimes(): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const [id, job] of jobs) {
    const next = job.nextInvocation()
    result[id] = next ? next.toDate().toISOString() : null
  }
  return result
}

/**
 * Shutdown: cancel all jobs and pending retries.
 */
export function shutdownScheduler(): void {
  for (const [, job] of jobs) {
    job.cancel()
  }
  jobs.clear()

  for (const [, timeout] of pendingRetries) {
    clearTimeout(timeout)
  }
  pendingRetries.clear()
}
