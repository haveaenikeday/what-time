import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  getSchedules: () => ipcRenderer.invoke('schedule:getAll'),
  getSchedule: (id) => ipcRenderer.invoke('schedule:get', id),
  createSchedule: (data) => ipcRenderer.invoke('schedule:create', data),
  updateSchedule: (id, data) => ipcRenderer.invoke('schedule:update', id, data),
  deleteSchedule: (id) => ipcRenderer.invoke('schedule:delete', id),
  toggleSchedule: (id, enabled) => ipcRenderer.invoke('schedule:toggle', id, enabled),
  testSend: (id) => ipcRenderer.invoke('schedule:testSend', id),
  getNextFireTimes: () => ipcRenderer.invoke('schedule:getNextFireTimes'),
  checkConflicts: (data) => ipcRenderer.invoke('schedule:checkConflicts', data),

  getLogs: (limit) => ipcRenderer.invoke('logs:getAll', limit),
  getLogsBySchedule: (scheduleId) => ipcRenderer.invoke('logs:bySchedule', scheduleId),
  clearLogs: (olderThanDays) => ipcRenderer.invoke('logs:clear', olderThanDays),

  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  updateSetting: (key, value) => ipcRenderer.invoke('settings:update', key, value),

  checkAccessibility: () => ipcRenderer.invoke('system:checkAccessibility'),
  openAccessibilitySettings: () => ipcRenderer.invoke('system:openAccessibilityPrefs'),
  probeCallState: () => ipcRenderer.invoke('system:probeCallState'),

  rebuildApp: () => ipcRenderer.invoke('app:rebuild'),

  // macOS Contacts integration
  searchContacts: (query) => ipcRenderer.invoke('contacts:search', query),
  checkContactsAccess: () => ipcRenderer.invoke('contacts:checkAccess'),
  openContactsSettings: () => ipcRenderer.invoke('contacts:openSettings'),

  onScheduleExecuted: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, log: unknown) => {
      callback(log as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('schedule:executed', handler)
    return () => {
      ipcRenderer.removeListener('schedule:executed', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
