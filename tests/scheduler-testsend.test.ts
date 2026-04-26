import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression coverage for the "Schedule not found" bug where Test Send always
 * surfaced a misleading error toast.
 *
 * Before fix:
 *   testSendSchedule → executeJob → (queue ON) → enqueueSend → return null
 *                    → IPC handler collapses null → "Schedule not found"
 *
 * After fix:
 *   testSendSchedule → executeJob(bypassQueue=true) → performSend
 *                    → returns a real RunLog (success / dry_run / failed)
 *
 * These tests assert the new contract directly so the regression cannot recur.
 */

// ---------------------------------------------------------------------------
// Source checks — quick, cheap, and version-independent of the runtime mocks.
// ---------------------------------------------------------------------------

describe('Test Send regression — source checks', () => {
  it('executeJob signature accepts a bypassQueue parameter', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/services/scheduler.service.ts'),
      'utf8'
    )
    expect(src).toMatch(/async function executeJob\([\s\S]*?bypassQueue\s*=\s*false[\s\S]*?\):/)
  })

  it('testSendSchedule passes bypassQueue=true to executeJob', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/services/scheduler.service.ts'),
      'utf8'
    )
    // Match the actual call: executeJob(scheduleId, 0, undefined, undefined, /* bypassCallCheck */ true, /* bypassQueue */ true)
    expect(src).toMatch(/return\s+executeJob\([\s\S]*?bypassQueue[\s\S]*?true\)/)
  })

  it('queue branch in executeJob is gated on !bypassQueue', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/services/scheduler.service.ts'),
      'utf8'
    )
    expect(src).toMatch(/if\s*\(\s*settings\.enableSendQueue\s*&&\s*!bypassQueue\s*\)/)
  })

  it('IPC schedule:testSend verifies schedule existence before delegating', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/ipc/schedule.ipc.ts'),
      'utf8'
    )
    // Existence check must use db.getScheduleById and only return the
    // "Schedule not found" string when the row truly doesn't exist.
    expect(src).toContain('db.getScheduleById(id)')
    expect(src).toMatch(/if\s*\(\s*!exists\s*\)[\s\S]*?Schedule not found/)
  })

  it('IPC schedule:testSend reports a distinct error for null-with-existing-schedule', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/ipc/schedule.ipc.ts'),
      'utf8'
    )
    // The "deferred" branch must NOT reuse "Schedule not found".
    expect(src).toContain('Send is already in progress')
  })

  it('IPC schedule:testSend logs every step (invoked / not-found / null / result)', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/ipc/schedule.ipc.ts'),
      'utf8'
    )
    expect(src).toContain('testSend invoked')
    expect(src).toContain('does not exist')
    expect(src).toContain('returned null')
  })
})

// ---------------------------------------------------------------------------
// Behavioral tests — import scheduler.service with its deps mocked and
// assert testSendSchedule actually returns a non-null RunLog.
// ---------------------------------------------------------------------------

describe('testSendSchedule — behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockDeps(opts: {
    schedule?: unknown
    settings?: Record<string, unknown>
    sendResult?: { success: boolean; error?: string; dryRun: boolean }
    enqueueSpy?: ReturnType<typeof vi.fn>
  } = {}) {
    const schedule = opts.schedule ?? {
      id: 'sched-1',
      recipientType: 'contact',
      phoneNumber: '+1234567890',
      contactName: 'Test',
      groupName: '',
      message: 'Hello',
      scheduleType: 'daily',
      scheduledAt: null,
      timeOfDay: '09:00',
      dayOfWeek: null,
      dayOfMonth: null,
      monthOfYear: null,
      enabled: true,
      dryRun: true,
      lastFiredAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    }

    const settings = {
      globalDryRun: false,
      defaultCountryCode: '+1',
      sendDelayMs: 100,
      whatsappApp: 'WhatsApp',
      openAtLogin: false,
      maxRetries: 3,
      theme: 'system',
      enableGroupScheduling: true,
      pauseDuringCalls: true,
      callMaxWaitMs: 1_800_000,
      callPollIntervalMs: 30_000,
      enableSendQueue: true, // ← the regression trigger; default for fresh installs
      queueInterSendDelayMs: 1000,
      ...opts.settings
    }

    const sendResult = opts.sendResult ?? { success: true, error: undefined, dryRun: true }

    vi.doMock('../electron/services/db.service', () => ({
      getScheduleById: vi.fn().mockReturnValue(schedule),
      getAllSchedules: vi.fn().mockReturnValue([]),
      getSettings: vi.fn().mockReturnValue(settings),
      insertRunLog: vi.fn().mockImplementation((scheduleId, status, errorMessage, executionDuration, scheduledTime, retryAttempt, retryOf) => ({
        id: 'log-1',
        scheduleId,
        status,
        errorMessage: errorMessage ?? null,
        firedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionDuration,
        scheduledTime,
        retryAttempt,
        retryOf
      })),
      updateLastFiredAt: vi.fn(),
      toggleSchedule: vi.fn()
    }))

    vi.doMock('../electron/services/whatsapp.service', () => ({
      sendWhatsAppMessage: vi.fn().mockResolvedValue(sendResult),
      sendWhatsAppGroupMessage: vi.fn().mockResolvedValue(sendResult)
    }))

    vi.doMock('../electron/utils/applescript', () => ({
      // Screen-lock probe returns "false" → not locked.
      runAppleScript: vi.fn().mockResolvedValue('false'),
      runCommand: vi.fn().mockResolvedValue('')
    }))

    vi.doMock('../electron/utils/system-state', () => ({
      isSystemInCall: vi.fn().mockResolvedValue({ inCall: false }),
      probeCallState: vi.fn().mockResolvedValue({
        inCall: false,
        frontApp: 'Finder',
        runningCallApps: [],
        audioInUse: false
      })
    }))

    const enqueueSpy = opts.enqueueSpy ?? vi.fn().mockReturnValue(true)
    vi.doMock('../electron/services/sendQueue', () => ({
      setExecutor: vi.fn(),
      enqueueSend: enqueueSpy,
      processNextInQueue: vi.fn().mockResolvedValue(undefined),
      clearQueue: vi.fn(),
      isInFlight: vi.fn().mockReturnValue(false),
      queueDepth: vi.fn().mockReturnValue(0),
      pendingScheduleIds: vi.fn().mockReturnValue([])
    }))

    vi.doMock('node-schedule', () => ({
      scheduleJob: vi.fn().mockReturnValue({ cancel: vi.fn(), nextInvocation: vi.fn().mockReturnValue(null) }),
      RecurrenceRule: vi.fn()
    }))

    return { enqueueSpy, settings, schedule, sendResult }
  }

  it('returns a non-null RunLog even when enableSendQueue=true (the regression)', async () => {
    mockDeps({ sendResult: { success: true, error: undefined, dryRun: true } })

    const { testSendSchedule } = await import('../electron/services/scheduler.service')
    const result = await testSendSchedule('sched-1')

    // The bug: this used to be null because executeJob enqueued + returned null.
    expect(result).not.toBeNull()
    expect(result?.scheduleId).toBe('sched-1')
    expect(result?.status).toBe('dry_run')
  })

  it('does NOT enqueue the send when invoked via testSendSchedule', async () => {
    const enqueueSpy = vi.fn().mockReturnValue(true)
    mockDeps({ enqueueSpy })

    const { testSendSchedule } = await import('../electron/services/scheduler.service')
    await testSendSchedule('sched-1')

    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('still goes through the queue for normal scheduled (non-test) runs', async () => {
    // Confirms we didn't accidentally regress the queue path itself.
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/services/scheduler.service.ts'),
      'utf8'
    )
    // node-schedule timer callback calls executeJob with default args, which
    // means bypassQueue=false, which means the queue path is taken.
    expect(src).toMatch(/scheduleJob\(rule,\s*async\s*\(\)\s*=>\s*\{\s*await\s+executeJob\(s\.id\)/)
  })

  it('returns null for missing schedule (existing behavior, locked in)', async () => {
    vi.doMock('../electron/services/db.service', () => ({
      getScheduleById: vi.fn().mockReturnValue(null),
      getAllSchedules: vi.fn().mockReturnValue([]),
      getSettings: vi.fn().mockReturnValue({
        globalDryRun: false,
        defaultCountryCode: '+1',
        sendDelayMs: 100,
        whatsappApp: 'WhatsApp',
        openAtLogin: false,
        maxRetries: 3,
        theme: 'system',
        enableGroupScheduling: true,
        pauseDuringCalls: false,
        callMaxWaitMs: 1_800_000,
        callPollIntervalMs: 30_000,
        enableSendQueue: true,
        queueInterSendDelayMs: 1000
      }),
      insertRunLog: vi.fn(),
      updateLastFiredAt: vi.fn(),
      toggleSchedule: vi.fn()
    }))
    vi.doMock('../electron/services/whatsapp.service', () => ({
      sendWhatsAppMessage: vi.fn(),
      sendWhatsAppGroupMessage: vi.fn()
    }))
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('false'),
      runCommand: vi.fn()
    }))
    vi.doMock('../electron/utils/system-state', () => ({
      isSystemInCall: vi.fn().mockResolvedValue({ inCall: false }),
      probeCallState: vi.fn()
    }))
    vi.doMock('../electron/services/sendQueue', () => ({
      setExecutor: vi.fn(),
      enqueueSend: vi.fn(),
      processNextInQueue: vi.fn(),
      clearQueue: vi.fn(),
      isInFlight: vi.fn().mockReturnValue(false),
      queueDepth: vi.fn().mockReturnValue(0),
      pendingScheduleIds: vi.fn().mockReturnValue([])
    }))
    vi.doMock('node-schedule', () => ({
      scheduleJob: vi.fn(),
      RecurrenceRule: vi.fn()
    }))

    const { testSendSchedule } = await import('../electron/services/scheduler.service')
    const result = await testSendSchedule('missing')
    expect(result).toBeNull()
  })
})
