import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { registerJob, cancelJob, rescheduleJob, testSendSchedule } from '../services/scheduler.service'
import type { CreateScheduleInput, UpdateScheduleInput } from '../../shared/types'

export function registerScheduleHandlers(): void {
  ipcMain.handle('schedule:getAll', () => {
    return db.getAllSchedules()
  })

  ipcMain.handle('schedule:get', (_, id: string) => {
    return db.getScheduleById(id)
  })

  ipcMain.handle('schedule:create', (_, data: CreateScheduleInput) => {
    const schedule = db.createSchedule(data)
    if (schedule.enabled) {
      registerJob(schedule)
    }
    return schedule
  })

  ipcMain.handle('schedule:update', (_, id: string, data: UpdateScheduleInput) => {
    const schedule = db.updateSchedule(id, data)
    rescheduleJob(id)
    return schedule
  })

  ipcMain.handle('schedule:delete', (_, id: string) => {
    cancelJob(id)
    db.deleteSchedule(id)
  })

  ipcMain.handle('schedule:toggle', (_, id: string, enabled: boolean) => {
    const schedule = db.toggleSchedule(id, enabled)
    rescheduleJob(id)
    return schedule
  })

  ipcMain.handle('schedule:testSend', async (_, id: string) => {
    return testSendSchedule(id)
  })
}
