import { ipcMain, app } from 'electron'
import { exec } from 'child_process'
import * as db from '../services/db.service'
import { checkAccessibility, openAccessibilitySettings } from '../services/whatsapp.service'
import { createLogger } from '../utils/logger'

const log = createLogger('ipc:settings')

/**
 * Numeric bounds for setting keys that accept a range. Rejects out-of-range
 * values at the IPC boundary so the UI can surface a clear error before we
 * persist garbage to the DB.
 */
const NUMERIC_BOUNDS: Record<string, { min: number; max: number }> = {
  send_delay_ms: { min: 500, max: 15_000 },
  max_retries: { min: 1, max: 10 },
  call_max_wait_ms: { min: 60_000, max: 14_400_000 },        // 1 min … 4 hours
  call_poll_interval_ms: { min: 15_000, max: 600_000 },      // 15s … 10 min
  queue_inter_send_delay_ms: { min: 500, max: 10_000 }       // 0.5s … 10s
}

function validateSettingValue(key: string, value: string): void {
  const bounds = NUMERIC_BOUNDS[key]
  if (!bounds) return
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid value for "${key}": must be an integer`)
  }
  if (n < bounds.min || n > bounds.max) {
    throw new Error(`Invalid value for "${key}": must be between ${bounds.min} and ${bounds.max}`)
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getAll', () => {
    try {
      return db.getSettings()
    } catch (err) {
      log.error('getAll failed', err)
      throw err
    }
  })

  ipcMain.handle('settings:update', (_, key: string, value: string) => {
    try {
      validateSettingValue(key, value)
      db.updateSetting(key, value)

      // Sync login item setting when changed
      if (key === 'open_at_login') {
        app.setLoginItemSettings({ openAtLogin: value === '1', openAsHidden: true })
      }
    } catch (err) {
      log.error('update failed', err)
      throw err
    }
  })

  ipcMain.handle('system:checkAccessibility', async () => {
    return checkAccessibility()
  })

  ipcMain.handle('system:openAccessibilityPrefs', async () => {
    return openAccessibilitySettings()
  })

  ipcMain.handle('app:rebuild', () => {
    const projectRoot = app.getAppPath()
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      exec('npm run build', { cwd: projectRoot, shell: true }, (error) => {
        if (error) {
          log.error('rebuild failed', error)
          resolve({ success: false, error: error.message })
        } else {
          app.relaunch()
          app.quit()
          resolve({ success: true })
        }
      })
    })
  })
}
