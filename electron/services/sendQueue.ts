import { createLogger } from '../utils/logger'

const log = createLogger('sendQueue')

/**
 * One entry in the serialized send queue.
 * `priority: 0` = group (runs first), `priority: 1` = contact.
 * Ties are broken by `scheduledTime` ASC (older fires first) so the user's
 * intended ordering is preserved for same-priority items.
 *
 * `enqueuedAt` is stamped on insert and used to log time-spent-in-queue when
 * the item is dequeued — helps detect drain stalls.
 */
export interface QueueItem {
  scheduleId: string
  priority: 0 | 1
  scheduledTime: string
  retryAttempt: number
  retryOf?: string
  enqueuedAt?: number
}

/**
 * Executor contract: called once per dequeued item.
 * `keepOpen` tells the WhatsApp send to skip the Cmd+W close step when more
 * items are pending, so the WhatsApp session persists across chained sends.
 */
export type QueueExecutor = (item: QueueItem, keepOpen: boolean) => Promise<void>

// Module-level state. Kept private; callers interact via the exported fns only.
const queue: QueueItem[] = []
let inFlightId: string | null = null
let executor: QueueExecutor | null = null
let processing = false

/** Register (or replace) the executor. Called once during scheduler init. */
export function setExecutor(fn: QueueExecutor): void {
  executor = fn
}

/** True when a send is currently being processed (executor has not yet resolved). */
export function isInFlight(): boolean {
  return inFlightId !== null
}

/** Count of pending items still waiting for a turn. */
export function queueDepth(): number {
  return queue.length
}

/** Snapshot of pending scheduleIds in dequeue order (for debugging/tests). */
export function pendingScheduleIds(): string[] {
  return queue.map((q) => q.scheduleId)
}

function isAlreadyTracked(scheduleId: string): boolean {
  if (inFlightId === scheduleId) return true
  return queue.some((q) => q.scheduleId === scheduleId)
}

function sortQueue(): void {
  queue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.scheduledTime.localeCompare(b.scheduledTime)
  })
}

/**
 * Add an item to the queue. Returns false if the scheduleId is already queued
 * or in-flight (dedupes accidental double-enqueues from retries + catch-ups).
 */
export function enqueueSend(item: QueueItem): boolean {
  if (isAlreadyTracked(item.scheduleId)) {
    log.warn(`enqueueSend: ${item.scheduleId} already queued/in-flight — skipping`)
    return false
  }
  const stamped: QueueItem = { ...item, enqueuedAt: item.enqueuedAt ?? Date.now() }
  queue.push(stamped)
  sortQueue()
  log.info(`enqueued ${item.scheduleId} (priority=${item.priority}, depth=${queue.length}, retryAttempt=${item.retryAttempt})`)
  return true
}

/** Remove a scheduleId from the pending queue (e.g., on cancel/disable). */
export function dequeueByScheduleId(scheduleId: string): void {
  const idx = queue.findIndex((q) => q.scheduleId === scheduleId)
  if (idx >= 0) {
    queue.splice(idx, 1)
    log.info(`dequeued ${scheduleId} (depth=${queue.length})`)
  }
}

/** Drop everything. Called on shutdown. */
export function clearQueue(): void {
  queue.length = 0
  inFlightId = null
  processing = false
}

/**
 * Process the next queued item if we're not already processing.
 * Safe to call repeatedly — the `processing` flag serializes entries.
 * `keepOpen` is computed as `queueDepth() > 0` AFTER we pop the current item
 * so intermediate sends skip Cmd+W and the final send closes the window.
 */
export async function processNextInQueue(): Promise<void> {
  if (processing) {
    log.info(`processNextInQueue: already processing — no-op (depth=${queue.length})`)
    return
  }
  if (!executor) {
    log.error('processNextInQueue called before setExecutor — queue will not drain')
    return
  }
  if (queue.length === 0) return

  processing = true
  log.info(`processNextInQueue: starting drain (depth=${queue.length})`)
  try {
    while (queue.length > 0) {
      const item = queue.shift()!
      inFlightId = item.scheduleId
      const keepOpen = queue.length > 0
      const waitMs = item.enqueuedAt ? Date.now() - item.enqueuedAt : -1

      log.info(`dequeue ${item.scheduleId} (priority=${item.priority}, waitedMs=${waitMs}, keepOpen=${keepOpen}, remaining=${queue.length})`)

      const startedAt = Date.now()
      try {
        await executor(item, keepOpen)
        log.info(`executor completed for ${item.scheduleId} (durationMs=${Date.now() - startedAt})`)
      } catch (err) {
        // Executor should catch its own errors and log a run_log — but defensively
        // don't let a throw stop the queue.
        log.error(`executor threw for ${item.scheduleId} (durationMs=${Date.now() - startedAt})`, err)
      } finally {
        inFlightId = null
      }
    }
    log.info('processNextInQueue: drain complete')
  } finally {
    processing = false
  }
}

/** Test-only: reset all state. Use vi.resetModules() in production tests instead. */
export function __resetForTests(): void {
  clearQueue()
  executor = null
}
