import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initDb, closeDb } from './services/db.service'
import { initScheduler, setOnExecutedCallback, shutdownScheduler } from './services/scheduler.service'
import { registerAllHandlers } from './ipc/handlers'
import type { RunLog } from '../shared/types'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    icon: join(__dirname, '../../resources/icon.png'),
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

  // Load renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize database
  initDb()

  // Register IPC handlers
  registerAllHandlers()

  // Initialize scheduler
  initScheduler()

  // Push execution events to renderer
  setOnExecutedCallback((log: RunLog) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedule:executed', log)
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep app in dock but clean up scheduler
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  shutdownScheduler()
  closeDb()
})
