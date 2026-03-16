import { ipcMain } from 'electron'
import * as db from '../services/db.service'

export function registerLogsHandlers(): void {
  ipcMain.handle('logs:getAll', (_, limit?: number) => {
    return db.getLogs(limit)
  })

  ipcMain.handle('logs:bySchedule', (_, scheduleId: string) => {
    return db.getLogsBySchedule(scheduleId)
  })

  ipcMain.handle('logs:clear', (_, olderThanDays?: number) => {
    db.clearLogs(olderThanDays)
  })
}
