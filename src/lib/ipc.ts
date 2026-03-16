import type { ElectronAPI } from '../../shared/types'

export const api: ElectronAPI = (window as unknown as { api: ElectronAPI }).api
