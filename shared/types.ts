// Schedule types
export type ScheduleType = 'one_time' | 'daily' | 'weekly' | 'quarterly' | 'half_yearly' | 'yearly'
export type RunStatus = 'success' | 'failed' | 'dry_run' | 'skipped'
export type RecipientType = 'contact' | 'group'

export interface Schedule {
  id: string
  recipientType: RecipientType
  phoneNumber: string
  contactName: string
  groupName: string
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
  recipientType?: RecipientType
  phoneNumber: string
  contactName?: string
  groupName?: string
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
  recipientType?: RecipientType
  phoneNumber?: string
  contactName?: string
  groupName?: string
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
  enableGroupScheduling: boolean
  // Smart scheduling
  pauseDuringCalls: boolean       // hold sends while user is on a call
  callMaxWaitMs: number           // max time to wait for a call to end before giving up (ms)
  callPollIntervalMs: number      // how often to recheck call state (ms)
  enableSendQueue: boolean        // serialize simultaneous sends (groups first, then contacts)
  queueInterSendDelayMs: number   // gap between queued sends (ms)
}

export interface SendResult {
  success: boolean
  error?: string
  dryRun: boolean
}

/** Options for the WhatsApp send functions. */
export interface SendOptions {
  dryRun: boolean
  /** When true, skip the Cmd+W close keystroke so the next queued send can reuse the session. */
  keepOpen?: boolean
}

export interface AccessibilityStatus {
  granted: boolean
  error?: string
}

/** Diagnostic snapshot of the call-state probe — surfaced to Settings UI for verification. */
export interface CallStateProbe {
  inCall: boolean
  reason?: string
  detectedApp?: string
  frontApp: string
  runningCallApps: string[]
  audioInUse: boolean
  matchedWindowTitle?: string
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
    recipientType?: RecipientType
    phoneNumber: string
    groupName?: string
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
  probeCallState(): Promise<CallStateProbe>

  // Contacts (macOS Contacts app via AppleScript)
  searchContacts(query: string): Promise<Contact[]>
  checkContactsAccess(): Promise<AccessibilityStatus>
  openContactsSettings(): Promise<void>

  // Developer
  rebuildApp(): Promise<{ success: boolean; error?: string }>

  // Events
  onScheduleExecuted(callback: (log: RunLog) => void): () => void
}
