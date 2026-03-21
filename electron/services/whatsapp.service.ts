import { runAppleScript, runCommand } from '../utils/applescript'
import { getSettings } from './db.service'
import type { SendResult, AccessibilityStatus } from '../../shared/types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Send a WhatsApp message via macOS automation.
 *
 * Flow:
 * 1. Open WhatsApp chat using the whatsapp:// URL scheme (pre-fills message)
 * 2. Wait for WhatsApp to load the chat
 * 3. Press Enter via AppleScript System Events to send (skipped in dry-run)
 */
export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string,
  dryRun: boolean
): Promise<SendResult> {
  const settings = getSettings()
  const isDryRun = dryRun || settings.globalDryRun

  try {
    // Step 0: Check if WhatsApp is installed/running
    const appName = settings.whatsappApp.replace(/['"\\;\n\r]/g, '')
    try {
      const checkScript = `tell application "System Events" to (name of processes) contains "${appName}"`
      const running = await runAppleScript(checkScript)
      if (running.trim() === 'false') {
        // Try to launch it
        try {
          await runCommand('open', ['-a', appName])
        } catch {
          return { success: false, error: `${appName} is not installed or could not be launched`, dryRun: isDryRun }
        }
        // Verify it launched (3 checks, 1s apart)
        let launched = false
        for (let i = 0; i < 3; i++) {
          await sleep(1000)
          try {
            const recheck = await runAppleScript(checkScript)
            if (recheck.trim() === 'true') { launched = true; break }
          } catch { /* continue checking */ }
        }
        if (!launched) {
          return { success: false, error: `${appName} failed to start after 3 seconds`, dryRun: isDryRun }
        }
      }
    } catch {
      // If we can't check, proceed anyway — the URL scheme will attempt to launch it
    }

    // Step 1: Build the whatsapp:// URL and open it
    // Strip any non-digit chars except leading +
    const cleanNumber = phoneNumber.replace(/[^\d+]/g, '')
    const encodedMessage = encodeURIComponent(message)
    const url = `whatsapp://send?phone=${cleanNumber}&text=${encodedMessage}`

    await runCommand('open', [url])

    // Step 2: Wait for WhatsApp to load the chat
    await sleep(settings.sendDelayMs)

    if (isDryRun) {
      return { success: true, dryRun: true }
    }

    // Step 3: Activate WhatsApp and press Enter to send
    const sendScript = `
      tell application "${appName}" to activate
      delay 0.5
      tell application "System Events"
        tell process "${appName}"
          keystroke return
        end tell
      end tell
    `
    await runAppleScript(sendScript)

    return { success: true, dryRun: false }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    return { success: false, error: errMsg, dryRun: isDryRun }
  }
}

/**
 * Check if Accessibility permission is granted by running
 * a harmless System Events AppleScript.
 */
export async function checkAccessibility(): Promise<AccessibilityStatus> {
  try {
    await runAppleScript('tell application "System Events" to return name of first process')
    return { granted: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    return { granted: false, error: errMsg }
  }
}

/**
 * Open macOS System Settings to the Accessibility pane.
 */
export async function openAccessibilitySettings(): Promise<void> {
  await runCommand('open', [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  ])
}
