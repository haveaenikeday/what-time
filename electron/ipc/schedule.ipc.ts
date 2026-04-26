import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { registerJob, cancelJob, rescheduleJob, testSendSchedule, getAllNextFireTimes } from '../services/scheduler.service'
import { createLogger } from '../utils/logger'
import type { CreateScheduleInput, UpdateScheduleInput, ScheduleType } from '../../shared/types'

const log = createLogger('ipc:schedule')

const VALID_SCHEDULE_TYPES = new Set<ScheduleType>([
  'one_time', 'daily', 'weekly', 'quarterly', 'half_yearly', 'yearly'
])

const TIME_OF_DAY_RE = /^\d{2}:\d{2}$/

function validateCreateInput(data: CreateScheduleInput): string | null {
  const recipientType = data.recipientType || 'contact'

  if (recipientType === 'group') {
    if (!data.groupName || typeof data.groupName !== 'string' || data.groupName.trim().length < 1) {
      return 'Group name is required for group schedules'
    }
  } else {
    if (!data.phoneNumber || typeof data.phoneNumber !== 'string' || data.phoneNumber.trim().length < 7) {
      return 'Phone number is required (min 7 characters)'
    }
  }
  if (!data.message || typeof data.message !== 'string' || data.message.trim().length === 0) {
    return 'Message is required'
  }
  if (!VALID_SCHEDULE_TYPES.has(data.scheduleType)) {
    return `Invalid schedule type: ${data.scheduleType}`
  }
  if (data.scheduleType === 'one_time') {
    if (!data.scheduledAt || isNaN(Date.parse(data.scheduledAt))) {
      return 'scheduledAt must be a valid ISO date for one-time schedules'
    }
  } else {
    if (!data.timeOfDay || !TIME_OF_DAY_RE.test(data.timeOfDay)) {
      return 'timeOfDay must be in HH:mm format for recurring schedules'
    }
  }
  return null
}

export function registerScheduleHandlers(): void {
  ipcMain.handle('schedule:getAll', () => {
    try {
      return db.getAllSchedules()
    } catch (err) {
      log.error('getAll failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:get', (_, id: string) => {
    try {
      return db.getScheduleById(id)
    } catch (err) {
      log.error('get failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:create', (_, data: CreateScheduleInput) => {
    const validationError = validateCreateInput(data)
    if (validationError) {
      throw new Error(validationError)
    }
    // Safety: default group schedules to dry-run unless explicitly disabled
    if (data.recipientType === 'group' && data.dryRun === undefined) {
      data.dryRun = true
    }
    try {
      const schedule = db.createSchedule(data)
      if (schedule.enabled) {
        registerJob(schedule)
      }
      log.info(`Created schedule ${schedule.id} (${schedule.scheduleType})`)
      return schedule
    } catch (err) {
      log.error('create failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:update', (_, id: string, data: UpdateScheduleInput) => {
    try {
      const schedule = db.updateSchedule(id, data)
      rescheduleJob(id)
      return schedule
    } catch (err) {
      log.error('update failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:delete', (_, id: string) => {
    try {
      cancelJob(id)
      db.deleteSchedule(id)
      log.info(`Deleted schedule ${id}`)
    } catch (err) {
      log.error('delete failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:toggle', (_, id: string, enabled: boolean) => {
    try {
      const schedule = db.toggleSchedule(id, enabled)
      rescheduleJob(id)
      return schedule
    } catch (err) {
      log.error('toggle failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:testSend', async (_, id: string) => {
    log.info(`testSend invoked: id=${id}`)
    try {
      // Verify the schedule actually exists before delegating, so the
      // "Schedule not found" message is only ever surfaced when it's true.
      // Without this check, any legitimate `null` return from
      // `testSendSchedule` (e.g. mutex held by an in-flight scheduled run)
      // would be reported as "Schedule not found", misleading the user.
      const exists = db.getScheduleById(id)
      if (!exists) {
        log.warn(`testSend: schedule ${id} does not exist`)
        return { success: false, error: 'Schedule not found', dryRun: false }
      }

      const result = await testSendSchedule(id)
      if (!result) {
        log.warn(`testSend: ${id} returned null despite existing — likely mutex held by in-flight execution`)
        return {
          success: false,
          error: 'Send is already in progress for this schedule — check the Logs tab',
          dryRun: false
        }
      }

      log.info(`testSend: ${id} → ${result.status}${result.errorMessage ? ` (${result.errorMessage})` : ''}`)
      return {
        success: result.status === 'success',
        error: result.errorMessage ?? undefined,
        dryRun: result.status === 'dry_run'
      }
    } catch (err) {
      log.error('testSend failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:getNextFireTimes', () => {
    try {
      return getAllNextFireTimes()
    } catch (err) {
      log.error('getNextFireTimes failed', err)
      throw err
    }
  })

  ipcMain.handle('schedule:checkConflicts', (_, data: {
    recipientType?: string
    phoneNumber: string
    groupName?: string
    scheduleType: string
    scheduledAt?: string | null
    timeOfDay?: string | null
    dayOfWeek?: number | null
    excludeId?: string
  }) => {
    try {
      return db.findConflicts(
        data.phoneNumber,
        data.scheduleType,
        data.scheduledAt || null,
        data.timeOfDay || null,
        data.dayOfWeek ?? null,
        data.excludeId,
        data.recipientType,
        data.groupName
      )
    } catch (err) {
      log.error('checkConflicts failed', err)
      return []
    }
  })
}
