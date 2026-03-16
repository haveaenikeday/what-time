import { ipcMain } from 'electron'
import * as db from '../services/db.service'
import { checkAccessibility, openAccessibilitySettings } from '../services/whatsapp.service'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getAll', () => {
    return db.getSettings()
  })

  ipcMain.handle('settings:update', (_, key: string, value: string) => {
    db.updateSetting(key, value)
  })

  ipcMain.handle('system:checkAccessibility', async () => {
    return checkAccessibility()
  })

  ipcMain.handle('system:openAccessibilityPrefs', async () => {
    return openAccessibilitySettings()
  })
}
