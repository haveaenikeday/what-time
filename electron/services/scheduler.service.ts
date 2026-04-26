import * as schedule from 'node-schedule'
import { getAllSchedules, getScheduleById, getSettings, insertRunLog, toggleSchedule, updateLastFiredAt } from './db.service'
import { sendWhatsAppMessage, sendWhatsAppGroupMessage } from './whatsapp.service'
import { runAppleScript } from '../utils/applescript'
import { isSystemInCall } from '../utils/system-state'
import {
  clearQueue,
  enqueueSend,
  processNextInQueue,
  setExecutor,
  type QueueItem
} from './sendQueue'
import { createLogger } from '../utils/logger'
import type { Schedule, RunLog } from '../../shared/types'

const log = createLogger('scheduler')

function enrichRunLog(entry: RunLog, s: Schedule): RunLog {
  return {
    ...entry,
    recipientType: s.recipientType,
    phoneNumber: s.phoneNumber,
    contactName: s.contactName,
    groupName: s.groupName,
    messagePreview: s.message.substring(0, 80),
  }
}

function parseTimeOfDay(t: string): { hours: number; minutes: number } {
  const [hours, minutes] = t.split(':').map(Number)
  return { hours, minutes }
}

// In-memory map of active node-schedule jobs
const jobs = new Map<string, schedule.Job>()

// Mutex: set of schedule IDs currently executing (prevents double-send)
const executing = new Set<string>()

// Pending retry timeouts per schedule ID
const pendingRetries = new Map<string, NodeJS.Timeout>()

// Pending group catch-up timeouts (schedule ID → timeout handle)
const pendingCatchUps = new Map<string, NodeJS.Timeout>()

// Schedules currently held while a call is in progress.
// firstDetectedAt marks when the hold started so we can enforce callMaxWaitMs
// across call sessions that come and go (back-to-back calls).
interface CallWait {
  timeout: NodeJS.Timeout
  firstDetectedAt: number
  retryAttempt: number
  retryOf?: string
  scheduledTime: string
}
const pendingCallWaits = new Map<string, CallWait>()

// Callback for notifying the renderer when a job executes
let onExecutedCallback: ((log: RunLog) => void) | null = null

// Retry backoff intervals in ms (indexed by attempt number: 0→10s, 1→30s, 2→90s)
const RETRY_BACKOFF_MS = [10_000, 30_000, 90_000]

// Grace delay before catch-up fires for group messages (gives user time after app launch)
const GROUP_CATCH_UP_DELAY_MS = 5_000

// Minimum interval — skip catch-up if lastFiredAt is within this window of now
const CATCH_UP_RECENCY_THRESHOLD_MS = 2 * 60 * 1000

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
  // Wire the send queue executor. Idempotent — setExecutor replaces any prior.
  setExecutor(executeQueuedSend)

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
  let groupCatchUpIndex = 0

  for (const s of schedules) {
    const expected = getMostRecentExpectedFire(s, now)
    if (!expected) continue

    const lastFired = s.lastFiredAt ? new Date(s.lastFiredAt) : null

    // If never fired, or last fired before the most recent expected fire time
    if (!lastFired || lastFired < expected) {
      // Don't catch up brand-new schedules that were created after the expected fire time
      const createdAt = new Date(s.createdAt)
      if (!lastFired && createdAt > expected) {
        continue
      }

      // Recency guard: skip if lastFiredAt is very recent (handles rapid wake/restart cycles)
      if (lastFired && (now.getTime() - lastFired.getTime()) < CATCH_UP_RECENCY_THRESHOLD_MS) {
        log.info(`Skipping catch-up for ${s.id} — fired recently (${Math.round((now.getTime() - lastFired.getTime()) / 1000)}s ago)`)
        continue
      }

      const missedCount = lastFired ? 'at least 1' : 'unknown'
      insertRunLog(s.id, 'skipped', `Missed ${missedCount} run(s): app was not running`, undefined, expected.toISOString())
      updateLastFiredAt(s.id)

      // Group sends activate WhatsApp UI — delay and stagger catch-ups
      if (s.recipientType === 'group') {
        const delay = GROUP_CATCH_UP_DELAY_MS + (groupCatchUpIndex * 8_000)
        groupCatchUpIndex++
        log.info(`Catching up missed group schedule ${s.id} — firing in ${delay}ms`)
        const timeout = setTimeout(() => {
          pendingCatchUps.delete(s.id)
          executeJob(s.id).catch((err) => {
            log.error(`Failed catch-up execution for ${s.id}`, err)
          })
        }, delay)
        pendingCatchUps.set(s.id, timeout)
      } else {
        log.info(`Catching up missed recurring schedule ${s.id} — firing now`)
        executeJob(s.id).catch((err) => {
          log.error(`Failed catch-up execution for ${s.id}`, err)
        })
      }
    }
  }
}

/**
 * Compute the most recent time a recurring schedule should have fired
 * before `now`. Returns null if no expected fire time can be determined.
 */
export function getMostRecentExpectedFire(s: Schedule, now: Date): Date | null {
  if (!s.timeOfDay) return null
  const { hours, minutes } = parseTimeOfDay(s.timeOfDay)

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
  // Cancel pending group catch-up timeouts from previous init
  for (const [id, timeout] of pendingCatchUps) {
    clearTimeout(timeout)
    log.info(`Cleared pending catch-up timeout for ${id}`)
  }
  pendingCatchUps.clear()

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
    const { hours, minutes } = parseTimeOfDay(s.timeOfDay)
    const r = new schedule.RecurrenceRule()
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'weekly') {
    if (!s.timeOfDay || s.dayOfWeek === null || s.dayOfWeek === undefined) return
    const { hours, minutes } = parseTimeOfDay(s.timeOfDay)
    const r = new schedule.RecurrenceRule()
    r.dayOfWeek = s.dayOfWeek
    r.hour = hours
    r.minute = minutes
    r.second = 0
    rule = r
  } else if (s.scheduleType === 'quarterly') {
    if (!s.timeOfDay || s.dayOfMonth === null || s.dayOfMonth === undefined) return
    const { hours, minutes } = parseTimeOfDay(s.timeOfDay)
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
    const { hours, minutes } = parseTimeOfDay(s.timeOfDay)
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
    const { hours, minutes } = parseTimeOfDay(s.timeOfDay)
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
 * Note: pending call-waits and queue entries intentionally survive — they're
 * self-cleaning (their handlers re-read the schedule and no-op if missing/disabled)
 * which preserves held sends across sleep/wake cycles.
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
    let entry = insertRunLog(
      scheduleId, 'failed',
      `Gave up after ${maxRetries} retries`,
      undefined, scheduledTime, attempt
    )
    const s = getScheduleById(scheduleId)
    if (s) entry = enrichRunLog(entry, s)
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
 * Clear any pending call-wait timer for this schedule. Idempotent.
 */
function clearPendingCallWait(scheduleId: string): void {
  const wait = pendingCallWaits.get(scheduleId)
  if (wait) {
    clearTimeout(wait.timeout)
    pendingCallWaits.delete(scheduleId)
  }
}

/**
 * Schedule a recheck in `callPollIntervalMs` ms.
 * `firstDetectedAt` is preserved across rechecks so we can enforce the
 * overall max-wait ceiling (`callMaxWaitMs`) even across consecutive calls.
 */
function scheduleCallRecheck(
  scheduleId: string,
  retryAttempt: number,
  retryOf: string | undefined,
  scheduledTime: string,
  firstDetectedAt: number
): void {
  clearPendingCallWait(scheduleId)
  const { callPollIntervalMs } = getSettings()
  const timeout = setTimeout(() => {
    pendingCallWaits.delete(scheduleId)
    executeJob(scheduleId, retryAttempt, retryOf, scheduledTime).catch((err) => {
      log.error(`Call-wait recheck failed for ${scheduleId}`, err)
    })
  }, callPollIntervalMs)
  pendingCallWaits.set(scheduleId, {
    timeout,
    firstDetectedAt,
    retryAttempt,
    retryOf,
    scheduledTime
  })
}

/**
 * Actually perform the send and write the run_log. Shared by the direct
 * execution path and the queue executor. `keepOpen=true` asks the WhatsApp
 * service to skip Cmd+W so the next queued send can reuse the session.
 */
async function performSend(
  s: Schedule,
  retryAttempt: number,
  retryOf: string | undefined,
  scheduledTime: string,
  keepOpen: boolean
): Promise<RunLog> {
  const recipientLabel = s.recipientType === 'group'
    ? `group:"${s.groupName}"`
    : s.phoneNumber.slice(0, -4).replace(/./g, '*') + s.phoneNumber.slice(-4)
  log.info(`Executing ${s.id} (${s.scheduleType}) → ${recipientLabel}${s.dryRun ? ' [dry-run]' : ''}${retryAttempt > 0 ? ` [retry ${retryAttempt}]` : ''}${keepOpen ? ' [keep-open]' : ''}`)

  const startTime = Date.now()
  const result = s.recipientType === 'group'
    ? await sendWhatsAppGroupMessage(s.groupName, s.message, { dryRun: s.dryRun, keepOpen })
    : await sendWhatsAppMessage(s.phoneNumber, s.message, { dryRun: s.dryRun, keepOpen })
  const durationMs = Date.now() - startTime

  let status: 'success' | 'failed' | 'dry_run'
  if (result.dryRun) status = 'dry_run'
  else if (result.success) status = 'success'
  else status = 'failed'

  log.info(`Execution ${s.id} → ${status} (${durationMs}ms)${result.error ? ` error: ${result.error}` : ''}`)

  const entry = enrichRunLog(insertRunLog(s.id, status, result.error, durationMs, scheduledTime, retryAttempt, retryOf), s)
  updateLastFiredAt(s.id)

  if (s.scheduleType === 'one_time') {
    toggleSchedule(s.id, false)
    cancelJob(s.id)
  }

  if (onExecutedCallback) onExecutedCallback(entry)

  if (status === 'failed' && result.error && !isNonRetryableError(result.error)) {
    scheduleRetry(s.id, retryAttempt + 1, retryOf || entry.id, scheduledTime)
  }

  return entry
}

/**
 * Queue executor — invoked by sendQueue.processNextInQueue.
 * Re-reads the schedule (it may have been disabled or deleted while queued),
 * then calls performSend. Never throws — writes a run_log for every outcome.
 */
async function executeQueuedSend(item: QueueItem, keepOpen: boolean): Promise<void> {
  const s = getScheduleById(item.scheduleId)
  if (!s) {
    log.warn(`Queued send for missing schedule ${item.scheduleId} — dropping`)
    return
  }
  if (!s.enabled) {
    const entry = enrichRunLog(
      insertRunLog(s.id, 'skipped', 'Disabled before queued send fired', undefined, item.scheduledTime, item.retryAttempt, item.retryOf),
      s
    )
    if (onExecutedCallback) onExecutedCallback(entry)
    return
  }
  try {
    await performSend(s, item.retryAttempt, item.retryOf, item.scheduledTime, keepOpen)
  } catch (err) {
    log.error(`performSend threw for ${s.id}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    const entry = enrichRunLog(
      insertRunLog(s.id, 'failed', errMsg, undefined, item.scheduledTime, item.retryAttempt, item.retryOf),
      s
    )
    if (onExecutedCallback) onExecutedCallback(entry)
  }
}

/**
 * Execute a scheduled job: check guards (disabled/locked/in-call), then either
 * route through the queue (if one is active/enabled) or send directly.
 * Uses a mutex to prevent double-sends from overlapping timer + manual triggers.
 */
async function executeJob(
  scheduleId: string,
  retryAttempt = 0,
  retryOf?: string,
  existingScheduledTime?: string,
  bypassCallCheck = false,
  bypassQueue = false
): Promise<RunLog | null> {
  log.info(`executeJob entry: ${scheduleId}`, {
    retryAttempt,
    retryOf,
    bypassCallCheck,
    bypassQueue,
    mutexHeld: executing.has(scheduleId)
  })

  // Mutex: skip if already executing this schedule
  if (executing.has(scheduleId)) {
    log.warn(`Schedule ${scheduleId} is already executing, skipping duplicate`)
    return null
  }

  executing.add(scheduleId)
  try {
    const s = getScheduleById(scheduleId)
    if (!s) {
      log.warn(`Schedule ${scheduleId} not found in DB — dropping`)
      return null
    }

    const scheduledTime = existingScheduledTime || new Date().toISOString()
    const settings = getSettings()

    if (!s.enabled) {
      log.info(`Gate: ${scheduleId} disabled — writing skipped log`)
      const entry = enrichRunLog(insertRunLog(scheduleId, 'skipped', 'Schedule is disabled', undefined, scheduledTime), s)
      if (onExecutedCallback) onExecutedCallback(entry)
      return entry
    }

    // Check if screen is locked before attempting to send
    let screenLocked = false
    try {
      const result = await runAppleScript('tell application "System Events" to return running of screen saver preferences', 5000)
      screenLocked = result.trim() === 'true'
    } catch (err) {
      log.warn(`Gate: screen-lock probe failed for ${scheduleId} — proceeding`, err)
    }
    log.info(`Gate: ${scheduleId} screenLocked=${screenLocked}`)

    if (screenLocked) {
      const entry = enrichRunLog(insertRunLog(scheduleId, 'skipped', 'Screen locked: cannot send via AppleScript', undefined, scheduledTime, retryAttempt, retryOf), s)
      updateLastFiredAt(scheduleId)
      if (onExecutedCallback) onExecutedCallback(entry)
      return entry
    }

    // Call-aware hold: if the user is on a call, postpone and re-check later.
    // `bypassCallCheck` is true for manual test-sends — the user clicked Send,
    // they want immediate feedback even if it fails.
    log.info(`Gate: ${scheduleId} pauseDuringCalls=${settings.pauseDuringCalls} bypassCallCheck=${bypassCallCheck}`)
    if (settings.pauseDuringCalls && !bypassCallCheck) {
      const existing = pendingCallWaits.get(scheduleId)
      const firstDetectedAt = existing?.firstDetectedAt ?? Date.now()
      const isFirstHold = existing === undefined
      const callState = await isSystemInCall()
      log.info(`Gate: ${scheduleId} call probe`, {
        inCall: callState.inCall,
        reason: callState.reason,
        detectedApp: callState.detectedApp,
        isFirstHold,
        heldForMs: Date.now() - firstDetectedAt
      })
      if (callState.inCall) {
        const heldForMs = Date.now() - firstDetectedAt
        if (heldForMs >= settings.callMaxWaitMs) {
          // Give up after the configured ceiling.
          pendingCallWaits.delete(scheduleId)
          const mins = Math.round(settings.callMaxWaitMs / 60000)
          log.warn(`Schedule ${scheduleId}: gave up after ${mins}m of call holds`)
          const entry = enrichRunLog(
            insertRunLog(scheduleId, 'skipped', `Gave up: still in call after ${mins}m`, undefined, scheduledTime, retryAttempt, retryOf),
            s
          )
          updateLastFiredAt(scheduleId)
          if (onExecutedCallback) onExecutedCallback(entry)
          return entry
        }
        // First hold for this run: write a visible run_log so the user sees it
        // in the Logs UI immediately. Subsequent rechecks stay silent to avoid
        // flooding the log on long calls.
        if (isFirstHold) {
          const pollSec = Math.round(settings.callPollIntervalMs / 1000)
          const reason = callState.reason ?? 'detected'
          const detectedApp = callState.detectedApp ? ` [${callState.detectedApp}]` : ''
          const entry = enrichRunLog(
            insertRunLog(
              scheduleId,
              'skipped',
              `Held: call in progress (${reason})${detectedApp} — rechecking every ${pollSec}s`,
              undefined,
              scheduledTime,
              retryAttempt,
              retryOf
            ),
            s
          )
          if (onExecutedCallback) onExecutedCallback(entry)
        }
        log.info(`Schedule ${scheduleId} held: call in progress (${callState.reason ?? 'detected'}) — rechecking in ${settings.callPollIntervalMs}ms (held for ${heldForMs}ms total)`)
        scheduleCallRecheck(scheduleId, retryAttempt, retryOf, scheduledTime, firstDetectedAt)
        return null
      }
      // Call ended (or never was) — clear any stale wait entry. If we had been
      // holding this schedule, log the resume event so the user can correlate
      // with the earlier "Held: call in progress" entry.
      if (existing) {
        pendingCallWaits.delete(scheduleId)
        const heldForMs = Date.now() - existing.firstDetectedAt
        const heldSec = Math.round(heldForMs / 1000)
        log.info(`Schedule ${scheduleId}: call cleared after ${heldForMs}ms — resuming send`)
        const entry = enrichRunLog(
          insertRunLog(
            scheduleId,
            'skipped',
            `Resumed after ${heldSec}s call hold — proceeding with send`,
            undefined,
            scheduledTime,
            retryAttempt,
            retryOf
          ),
          s
        )
        if (onExecutedCallback) onExecutedCallback(entry)
      }
    }

    // Route through the queue so same-minute schedules serialize correctly
    // (groups first, contacts after) and chained sends reuse the WhatsApp session.
    // `processNextInQueue` is guarded by its own `processing` flag — calling it
    // concurrently from multiple executeJob paths is safe (second call no-ops).
    //
    // `bypassQueue=true` skips the queue and runs inline: required for manual
    // `testSendSchedule` triggers where the caller is awaiting a real RunLog
    // result — enqueueing would force the IPC layer to interpret a `null`
    // synchronous return as failure.
    log.info(`Gate: ${scheduleId} enableSendQueue=${settings.enableSendQueue} bypassQueue=${bypassQueue}`)
    if (settings.enableSendQueue && !bypassQueue) {
      const priority: 0 | 1 = s.recipientType === 'group' ? 0 : 1
      const enqueued = enqueueSend({
        scheduleId,
        priority,
        scheduledTime,
        retryAttempt,
        retryOf
      })
      log.info(`Routing ${scheduleId} via queue: priority=${priority} enqueued=${enqueued}`)
      if (enqueued) {
        processNextInQueue().catch((err) => log.error('queue drain failed', err))
      }
      return null
    }

    // Direct-send path: either the queue is disabled, or the caller bypassed it
    // (manual test send) to get a synchronous RunLog back.
    log.info(
      `Routing ${scheduleId} via direct send (${bypassQueue ? 'bypassQueue from testSendSchedule' : 'queue disabled'})`
    )
    return await performSend(s, retryAttempt, retryOf, scheduledTime, false)
  } finally {
    executing.delete(scheduleId)
  }
}

/**
 * Manually trigger a test send for a schedule (respects dry-run setting).
 * Cancels any pending retry or call-wait to give the user immediate feedback.
 * Bypasses the call-in-progress check — user clicked Send intentionally.
 */
export async function testSendSchedule(scheduleId: string): Promise<RunLog | null> {
  clearPendingRetry(scheduleId)
  clearPendingCallWait(scheduleId)
  // Bypass the call-in-progress check AND the send queue — the user clicked
  // Send and is awaiting synchronous feedback. The queue is for serializing
  // scheduled cron triggers; routing a manual test through it returns null
  // from executeJob and the IPC layer would surface a misleading error.
  return executeJob(scheduleId, 0, undefined, undefined, /* bypassCallCheck */ true, /* bypassQueue */ true)
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
 * Shutdown: cancel all jobs and pending timers, drain queue.
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

  for (const [, timeout] of pendingCatchUps) {
    clearTimeout(timeout)
  }
  pendingCatchUps.clear()

  for (const [, wait] of pendingCallWaits) {
    clearTimeout(wait.timeout)
  }
  pendingCallWaits.clear()

  clearQueue()
}
