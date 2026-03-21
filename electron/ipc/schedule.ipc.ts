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
  if (!data.phoneNumber || typeof data.phoneNumber !== 'string' || data.phoneNumber.trim().length < 7) {
    return 'Phone number is required (min 7 characters)'
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
    try {
      const result = await testSendSchedule(id)
      if (!result) return { success: false, error: 'Schedule not found', dryRun: false }
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
}
