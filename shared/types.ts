// Schedule types
export type ScheduleType = 'one_time' | 'daily' | 'weekly' | 'quarterly' | 'half_yearly' | 'yearly'
export type RunStatus = 'success' | 'failed' | 'dry_run' | 'skipped'

export interface Schedule {
  id: string
  phoneNumber: string
  contactName: string
  message: string
  scheduleType: ScheduleType
  scheduledAt: string | null // ISO 8601 for one-time
  timeOfDay: string | null // HH:mm for daily/weekly/quarterly/half_yearly/yearly
  dayOfWeek: number | null // 0=Sun, 1=Mon, ..., 6=Sat for weekly
  dayOfMonth: number | null // 1-28 for quarterly/half_yearly/yearly
  monthOfYear: number | null // 0=Jan, ..., 11=Dec for quarterly/half_yearly/yearly
  enabled: boolean
  dryRun: boolean
  lastFiredAt: string | null // ISO 8601 timestamp of last execution
  createdAt: string
  updatedAt: string
}

export interface CreateScheduleInput {
  phoneNumber: string
  contactName?: string
  message: string
  scheduleType: ScheduleType
  scheduledAt?: string
  timeOfDay?: string
  dayOfWeek?: number
  dayOfMonth?: number
  monthOfYear?: number
  dryRun?: boolean
}

export type UpdateScheduleInput = Partial<CreateScheduleInput> & { enabled?: boolean }

export interface RunLog {
  id: string
  scheduleId: string
  status: RunStatus
  errorMessage: string | null
  firedAt: string
  completedAt: string | null
  executionDuration?: number  // milliseconds
  scheduledTime?: string      // ISO 8601 intended fire time
  retryAttempt?: number       // 0 = first try, 1+ = retries
  retryOf?: string            // original run_log.id if this is a retry
  // joined from schedule for display
  phoneNumber?: string
  contactName?: string
  messagePreview?: string
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  globalDryRun: boolean
  defaultCountryCode: string
  sendDelayMs: number
  whatsappApp: string
  openAtLogin: boolean
  maxRetries: number
  theme: ThemePreference
}

export interface SendResult {
  success: boolean
  error?: string
  dryRun: boolean
}

export interface AccessibilityStatus {
  granted: boolean
  error?: string
}

// A single contact result from the macOS Contacts app
export interface Contact {
  name: string
  phoneNumber: string  // raw value from Contacts (e.g. "+91 98765 43210")
  phoneLabel: string   // "mobile", "home", "work", etc.
}

// IPC API shape exposed via contextBridge
export interface ElectronAPI {
  // Schedules
  getSchedules(): Promise<Schedule[]>
  getSchedule(id: string): Promise<Schedule | null>
  createSchedule(data: CreateScheduleInput): Promise<Schedule>
  updateSchedule(id: string, data: UpdateScheduleInput): Promise<Schedule>
  deleteSchedule(id: string): Promise<void>
  toggleSchedule(id: string, enabled: boolean): Promise<Schedule>
  testSend(id: string): Promise<SendResult>
  getNextFireTimes(): Promise<Record<string, string | null>>
  checkConflicts(data: {
    phoneNumber: string
    scheduleType: string
    scheduledAt?: string | null
    timeOfDay?: string | null
    dayOfWeek?: number | null
    excludeId?: string
  }): Promise<Schedule[]>

  // Logs
  getLogs(limit?: number): Promise<RunLog[]>
  getLogsBySchedule(scheduleId: string): Promise<RunLog[]>
  clearLogs(olderThanDays?: number): Promise<void>

  // Settings
  getSettings(): Promise<AppSettings>
  updateSetting(key: string, value: string): Promise<void>

  // System
  checkAccessibility(): Promise<AccessibilityStatus>
  openAccessibilitySettings(): Promise<void>

  // Contacts (macOS Contacts app via AppleScript)
  searchContacts(query: string): Promise<Contact[]>
  checkContactsAccess(): Promise<AccessibilityStatus>
  openContactsSettings(): Promise<void>

  // Events
  onScheduleExecuted(callback: (log: RunLog) => void): () => void
}
