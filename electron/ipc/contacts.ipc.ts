import { ipcMain } from 'electron'
import { runAppleScript, runCommand } from '../utils/applescript'
import type { Contact, AccessibilityStatus } from '../../shared/types'

/**
 * Cleans AppleScript contact label strings.
 * Contacts app uses values like _$!<Mobile>!$_ for special labels.
 */
function cleanPhoneLabel(raw: string): string {
  const match = raw.match(/<(.+?)>/)
  if (match) return match[1].toLowerCase()
  return raw.toLowerCase().trim() || 'phone'
}

/**
 * Parses the newline-joined result string from the Contacts AppleScript.
 * Each line is "Name|||PhoneNumber|||Label".
 */
function parseContactResults(raw: string): Contact[] {
  if (!raw || raw.trim() === '') return []
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|||'))
    .map((line) => {
      const [name, phoneNumber, phoneLabel] = line.split('|||')
      return {
        name: name?.trim() || '',
        phoneNumber: phoneNumber?.trim() || '',
        phoneLabel: cleanPhoneLabel(phoneLabel?.trim() || '')
      }
    })
    .filter((c) => c.name && c.phoneNumber)
    .slice(0, 15) // cap results to avoid overwhelming the dropdown
}

export function registerContactsHandlers(): void {
  // Search macOS Contacts by display name — fires the macOS permission prompt on first call
  ipcMain.handle('contacts:search', async (_, query: string): Promise<Contact[]> => {
    if (!query || query.trim().length < 2) return []

    // Sanitize to prevent AppleScript injection (strip quotes + backslashes)
    const safeQuery = query.replace(/['"\\]/g, '').slice(0, 50)

    const script = `
      tell application "Contacts"
        set matchingPeople to every person whose name contains "${safeQuery}"
        set resultList to {}
        repeat with aPerson in matchingPeople
          repeat with aPhone in phones of aPerson
            set end of resultList to (name of aPerson) & "|||" & (value of aPhone) & "|||" & (label of aPhone)
          end repeat
        end repeat
        set AppleScript's text item delimiters to linefeed
        set output to resultList as string
        set AppleScript's text item delimiters to ""
        return output
      end tell
    `

    try {
      const raw = await runAppleScript(script, 8000)
      return parseContactResults(raw)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // Contacts access denied — bubble up so the UI can show a warning
      if (msg.includes('Not authorized') || msg.includes('-1743') || msg.includes('1743')) {
        throw new Error('Contacts permission not granted. Allow access in System Settings > Privacy & Security > Contacts.')
      }
      // Any other error (e.g. empty contacts, timeout) → return empty silently
      console.warn('[contacts:search] error:', msg)
      return []
    }
  })

  // Check whether the Contacts permission has been granted
  ipcMain.handle('contacts:checkAccess', async (): Promise<AccessibilityStatus> => {
    const script = `tell application "Contacts"\n  count of every person\nend tell`
    try {
      await runAppleScript(script, 5000)
      return { granted: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { granted: false, error: msg }
    }
  })

  // Open macOS Contacts privacy settings
  ipcMain.handle('contacts:openSettings', async (): Promise<void> => {
    await runCommand('open', [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts'
    ])
  })
}
