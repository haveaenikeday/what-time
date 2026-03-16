import { registerScheduleHandlers } from './schedule.ipc'
import { registerLogsHandlers } from './logs.ipc'
import { registerSettingsHandlers } from './settings.ipc'
import { registerContactsHandlers } from './contacts.ipc'

export function registerAllHandlers(): void {
  registerScheduleHandlers()
  registerLogsHandlers()
  registerSettingsHandlers()
  registerContactsHandlers()
}
