import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schedule } from '../shared/types'

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sched-session',
    recipientType: 'contact',
    phoneNumber: '+1234567890',
    contactName: 'Test Contact',
    groupName: '',
    message: 'Hello from WhatTime',
    scheduleType: 'one_time',
    scheduledAt: '2099-01-01T09:00:00.000Z',
    timeOfDay: null,
    dayOfWeek: null,
    dayOfMonth: null,
    monthOfYear: null,
    enabled: true,
    dryRun: true,
    lastFiredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function mockSchedulerDeps(opts: {
  schedule?: Schedule
  sessionReady: boolean
  sessionReason?: string
  enableSendQueue?: boolean
}) {
  const schedule = opts.schedule ?? makeSchedule()
  let scheduledCallback: (() => Promise<void>) | undefined

  const insertRunLog = vi.fn().mockImplementation((scheduleId, status, errorMessage, executionDuration, scheduledTime, retryAttempt, retryOf) => ({
    id: `log-${insertRunLog.mock.calls.length}`,
    scheduleId,
    status,
    errorMessage: errorMessage ?? null,
    firedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    executionDuration,
    scheduledTime,
    retryAttempt,
    retryOf
  }))
  const enqueueSend = vi.fn().mockReturnValue(true)
  const sendWhatsAppMessage = vi.fn().mockResolvedValue({ success: true, dryRun: true })
  const probeUserSessionState = vi.fn().mockResolvedValue({
    ready: opts.sessionReady,
    reason: opts.sessionReason,
    frontApp: opts.sessionReady ? 'Finder' : 'loginwindow',
    screenSaverRunning: !opts.sessionReady
  })

  vi.doMock('../electron/services/db.service', () => ({
    getAllSchedules: vi.fn().mockReturnValue([schedule]),
    getScheduleById: vi.fn().mockReturnValue(schedule),
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
      enableSendQueue: opts.enableSendQueue ?? true,
      queueInterSendDelayMs: 1000
    }),
    insertRunLog,
    updateLastFiredAt: vi.fn(),
    toggleSchedule: vi.fn()
  }))

  vi.doMock('../electron/services/whatsapp.service', () => ({
    sendWhatsAppMessage,
    sendWhatsAppGroupMessage: vi.fn().mockResolvedValue({ success: true, dryRun: true })
  }))

  vi.doMock('../electron/utils/system-state', () => ({
    isSystemInCall: vi.fn().mockResolvedValue({ inCall: false }),
    probeUserSessionState,
    probeCallState: vi.fn()
  }))

  vi.doMock('../electron/services/sendQueue', () => ({
    setExecutor: vi.fn(),
    enqueueSend,
    processNextInQueue: vi.fn().mockResolvedValue(undefined),
    clearQueue: vi.fn()
  }))

  vi.doMock('node-schedule', () => ({
    scheduleJob: vi.fn((_rule, cb) => {
      scheduledCallback = cb
      return { cancel: vi.fn(), nextInvocation: vi.fn().mockReturnValue(null) }
    }),
    RecurrenceRule: vi.fn(function RecurrenceRule() {})
  }))

  return {
    enqueueSend,
    getScheduledCallback: () => scheduledCallback,
    insertRunLog,
    probeUserSessionState,
    sendWhatsAppMessage
  }
}

describe('scheduled user-session guard', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds an automatic send while the user session is locked and does not enqueue or send', async () => {
    const deps = mockSchedulerDeps({
      sessionReady: false,
      sessionReason: 'loginwindow is frontmost',
      enableSendQueue: true
    })

    const { initScheduler } = await import('../electron/services/scheduler.service')
    initScheduler()

    await deps.getScheduledCallback()?.()

    expect(deps.enqueueSend).not.toHaveBeenCalled()
    expect(deps.sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(deps.insertRunLog).toHaveBeenCalledWith(
      'sched-session',
      'skipped',
      expect.stringContaining('Held: loginwindow is frontmost'),
      undefined,
      expect.any(String),
      0,
      undefined
    )
  })

  it('resumes a held automatic send after unlock and waits for the 5 second warning', async () => {
    vi.useFakeTimers()
    const deps = mockSchedulerDeps({
      sessionReady: false,
      sessionReason: 'Screen is locked',
      enableSendQueue: false
    })

    const { initScheduler, markUserSessionReady, setOnBeforeAutomationCallback } = await import('../electron/services/scheduler.service')
    const beforeAutomation = vi.fn()
    setOnBeforeAutomationCallback(beforeAutomation)
    initScheduler()

    await deps.getScheduledCallback()?.()
    expect(deps.sendWhatsAppMessage).not.toHaveBeenCalled()

    deps.probeUserSessionState.mockResolvedValue({
      ready: true,
      frontApp: 'Finder',
      screenSaverRunning: false
    })

    markUserSessionReady('test unlock')
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(beforeAutomation).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: 'sched-session',
      recipient: 'Test Contact',
      startsInMs: 5000
    }))
    expect(deps.sendWhatsAppMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)
    await Promise.resolve()

    expect(deps.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
  })

  it('wires lock/unlock powerMonitor events and the before-automation callback in main', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const mainSrc = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8')
    const schedulerSrc = readFileSync(join(process.cwd(), 'electron/services/scheduler.service.ts'), 'utf8')

    expect(mainSrc).toContain("powerMonitor.on('lock-screen'")
    expect(mainSrc).toContain("powerMonitor.on('unlock-screen'")
    expect(mainSrc).toContain("powerMonitor.on('user-did-become-active'")
    expect(mainSrc).toContain('setOnBeforeAutomationCallback')
    expect(schedulerSrc).toContain('BEFORE_AUTOMATION_WARNING_MS = 5_000')
  })
})
