import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { createLogger } from '../utils/logger'

const log = createLogger('ipc:logs')

export function registerLogsHandlers(): void {
  ipcMain.handle('logs:getAll', (_, limit?: number) => {
    try {
      return db.getLogs(limit)
    } catch (err) {
      log.error('getAll failed', err)
      throw err
    }
  })

  ipcMain.handle('logs:bySchedule', (_, scheduleId: string) => {
    try {
      return db.getLogsBySchedule(scheduleId)
    } catch (err) {
      log.error('bySchedule failed', err)
      throw err
    }
  })

  ipcMain.handle('logs:clear', (_, olderThanDays?: number) => {
    try {
      db.clearLogs(olderThanDays)
      log.info(`Logs cleared${olderThanDays ? ` (older than ${olderThanDays} days)` : ' (all)'}`)
    } catch (err) {
      log.error('clear failed', err)
      throw err
    }
  })
}
