import { app, BrowserWindow, shell, powerMonitor, Notification, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { initDb, closeDb, getSettings, schedulePruneOldLogs } from './services/db.service'
import {
  checkAndResumeHeldSessionSends,
  initScheduler,
  markUserSessionBlocked,
  markUserSessionReady,
  setOnBeforeAutomationCallback,
  setOnExecutedCallback,
  shutdownScheduler,
  resyncAfterWake
} from './services/scheduler.service'
import { registerAllHandlers } from './ipc/handlers'
import { createLogger } from './utils/logger'
import type { RunLog } from '../shared/types'

const log = createLogger('app')
const isDev = !app.isPackaged
const APP_NAME = 'WhatTime'

// --- Single instance lock ---
// Prevents duplicate app instances which would cause DB locking and duplicate sends
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log.warn('Another instance is already running — quitting')
  app.quit()
}

// --- Crash safety ---
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception (scheduler continues running)', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', reason instanceof Error ? reason : String(reason))
})

/** Resolve a resource path that works in both dev and packaged builds. */
function getResourcePath(...segments: string[]): string {
  const base = isDev
    ? join(__dirname, '../../resources')
    : join(process.resourcesPath, 'resources')
  return join(base, ...segments)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    icon: getResourcePath('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide window on close instead of destroying (keeps scheduler running)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      log.info('Window hidden (scheduler still running in background)')
    }
  })

  // Load renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

}

function createTray(): void {
  const iconPath = getResourcePath('icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18, quality: 'best' })

  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      createWindow()
    }
  })
}

// --- Second instance handler: focus existing window ---
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  const startMs = Date.now()
  log.info(`Starting ${APP_NAME} v${app.getVersion()} (${isDev ? 'dev' : 'packaged'})`)
  log.info(`userData path : ${app.getPath('userData')}`)
  log.info(`logs path     : ${app.getPath('logs')}`)
  log.info(`exe path      : ${app.getPath('exe')}`)

  if (process.platform === 'darwin') app.dock?.hide()

  // Initialize database (migration from legacy paths happens here)
  log.info('[startup 1/5] Initializing database...')
  initDb()
  log.info(`[startup 1/5] Database ready (+${Date.now() - startMs}ms)`)
  schedulePruneOldLogs() // deferred 5s — runs after window is visible

  // Register IPC handlers
  log.info('[startup 2/5] Registering IPC handlers...')
  registerAllHandlers()
  log.info(`[startup 2/5] IPC handlers registered (+${Date.now() - startMs}ms)`)

  // Initialize scheduler (missed-run catch-up runs here)
  log.info('[startup 3/5] Initializing scheduler...')
  initScheduler()
  log.info(`[startup 3/5] Scheduler ready (+${Date.now() - startMs}ms)`)

  // Create system tray icon
  log.info('[startup 4/5] Creating system tray...')
  createTray()
  log.info(`[startup 4/5] System tray created (+${Date.now() - startMs}ms)`)

  // Sync login item setting from DB
  const settings = getSettings()
  app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, openAsHidden: true })
  log.info(`open-at-login: ${settings.openAtLogin}`)

  setOnBeforeAutomationCallback((info) => {
    if (!Notification.isSupported()) return
    const seconds = Math.ceil(info.startsInMs / 1000)
    new Notification({
      title: `WhatTime will send in ${seconds} seconds`,
      body: `${info.recipient}: ${info.messagePreview || 'Scheduled WhatsApp message'}`
    }).show()
  })

  // Push execution events to renderer + show native notification
  setOnExecutedCallback((execLog: RunLog) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedule:executed', execLog)
    }

    if (Notification.isSupported()) {
      const recipient = execLog.recipientType === 'group'
        ? execLog.groupName
        : (execLog.contactName || execLog.phoneNumber || 'Unknown')

      let title: string
      let body: string

      switch (execLog.status) {
        case 'success':
          title = `Message Sent to ${recipient}`
          body = execLog.messagePreview || 'Message delivered'
          break
        case 'dry_run':
          title = `Dry Run — ${recipient}`
          body = execLog.messagePreview || 'Chat opened (message not sent)'
          break
        case 'failed':
          title = `Failed to Send — ${recipient}`
          body = execLog.errorMessage || 'Unknown error'
          break
        default:
          title = `Skipped — ${recipient}`
          body = execLog.errorMessage || 'Schedule was skipped'
      }

      new Notification({ title, body }).show()
    }

    if (execLog.status === 'success' || execLog.status === 'dry_run') {
      mainWindow?.hide()
    }
  })

  // Re-sync scheduler after macOS sleep/wake to catch missed timers
  powerMonitor.on('suspend', () => {
    log.info('System suspending — holding automatic sends')
    markUserSessionBlocked('System is suspending')
  })

  powerMonitor.on('resume', () => {
    log.info('System resumed from sleep — resyncing scheduler')
    markUserSessionBlocked('System resumed; waiting for unlocked active session')
    resyncAfterWake()
    setTimeout(() => {
      checkAndResumeHeldSessionSends('resume readiness probe').catch((err) => {
        log.warn('Resume readiness probe failed', err)
      })
    }, 5_000)
  })

  powerMonitor.on('lock-screen', () => {
    log.info('Screen locked — holding automatic sends')
    markUserSessionBlocked('Screen is locked')
  })

  powerMonitor.on('unlock-screen', () => {
    log.info('Screen unlocked — resuming held sends')
    markUserSessionReady('screen unlock')
  })

  powerMonitor.on('user-did-resign-active', () => {
    log.info('User session resigned active — holding automatic sends')
    markUserSessionBlocked('User session is inactive')
  })

  powerMonitor.on('user-did-become-active', () => {
    log.info('User session became active — resuming held sends')
    markUserSessionReady('user session active')
  })

  log.info('[startup 5/5] Creating main window...')
  createWindow()
  log.info(`[startup 5/5] Window ready — startup complete in ${Date.now() - startMs}ms`)

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep running in background (tray). On other platforms, quit.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  log.info('Shutting down...')
  shutdownScheduler()
  closeDb()
  log.info('Shutdown complete')
})
