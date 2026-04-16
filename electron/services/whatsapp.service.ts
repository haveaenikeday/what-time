import { runAppleScript, runCommand } from '../utils/applescript'
import { getSettings } from './db.service'
import { createLogger } from '../utils/logger'
import type { SendResult, SendOptions, AccessibilityStatus } from '../../shared/types'

const log = createLogger('whatsapp')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Escape a string for safe embedding in AppleScript double-quoted literals. */
function escapeForAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Ensure WhatsApp Desktop is running. Launches it if not.
 * Returns a SendResult error if it cannot be started, or null on success.
 */
async function ensureWhatsAppRunning(appName: string, isDryRun: boolean): Promise<SendResult | null> {
  try {
    const checkScript = `tell application "System Events" to (name of processes) contains "${appName}"`
    const running = await runAppleScript(checkScript)
    if (running.trim() === 'false') {
      try {
        await runCommand('open', ['-a', appName])
      } catch {
        return { success: false, error: `${appName} is not installed or could not be launched`, dryRun: isDryRun }
      }
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
    // If we can't check, proceed anyway
  }
  return null
}

/**
 * Send a WhatsApp message to a contact via macOS automation.
 *
 * Flow:
 * 1. Open WhatsApp chat using the whatsapp:// URL scheme (pre-fills message)
 * 2. Wait for WhatsApp to load the chat
 * 3. Press Enter via AppleScript System Events to send (skipped in dry-run)
 * 4. Close the chat window with Cmd+W (skipped when opts.keepOpen is true)
 */
export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string,
  opts: SendOptions
): Promise<SendResult> {
  const settings = getSettings()
  const isDryRun = opts.dryRun || settings.globalDryRun
  const keepOpen = opts.keepOpen === true
  const appName = settings.whatsappApp.replace(/['"\\;\n\r]/g, '')

  try {
    const launchErr = await ensureWhatsAppRunning(appName, isDryRun)
    if (launchErr) return launchErr

    // Build the whatsapp:// URL and open it
    const cleanNumber = phoneNumber.replace(/[^\d+]/g, '')
    const encodedMessage = encodeURIComponent(message)
    const url = `whatsapp://send?phone=${cleanNumber}&text=${encodedMessage}`

    await runCommand('open', [url])
    await sleep(settings.sendDelayMs)

    if (isDryRun) {
      return { success: true, dryRun: true }
    }

    // Activate WhatsApp and press Enter to send; optionally close the window after.
    const closeLine = keepOpen ? '' : 'delay 1.0\n          keystroke "w" using command down'
    const sendScript = `
      tell application "${appName}" to activate
      delay 0.5
      tell application "System Events"
        tell process "${appName}"
          keystroke return
          ${closeLine}
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
 * Send a WhatsApp message to a group via macOS UI automation.
 *
 * Flow:
 * 1. Ensure WhatsApp is running
 * 2. Activate WhatsApp, press Escape to dismiss any open dialogs/overlays
 * 3. Focus the sidebar search bar via AX fallback chain
 * 4. Type exact group name, wait for results, select first result
 * 5. Paste the message via clipboard (handles special chars / long text)
 * 6. Press Enter to send (skipped in dry-run)
 *
 * This is best-effort automation — less reliable than contact deep links.
 * The search bar focus uses a 3-tier fallback: AX text field click → AX
 * toolbar click → Cmd+K keyboard shortcut.
 */
export async function sendWhatsAppGroupMessage(
  groupName: string,
  message: string,
  opts: SendOptions
): Promise<SendResult> {
  const settings = getSettings()
  const isDryRun = opts.dryRun || settings.globalDryRun
  const keepOpen = opts.keepOpen === true
  const appName = settings.whatsappApp.replace(/['"\\;\n\r]/g, '')
  const escapedGroupName = escapeForAppleScript(groupName)
  const escapedMessage = escapeForAppleScript(message)

  try {
    const launchErr = await ensureWhatsAppRunning(appName, isDryRun)
    if (launchErr) return launchErr

    // Phase 1: Activate WhatsApp and reset state
    // Press Escape twice to dismiss any open dialogs (Forward, in-chat search, etc.)
    log.info(`[phase 1] Group send → "${groupName}": activating and resetting state`)
    const resetScript = `
      tell application "${appName}" to activate
      delay 0.8
      tell application "System Events"
        tell process "${appName}"
          key code 53
          delay 0.3
          key code 53
          delay 0.3
        end tell
      end tell
    `
    const resetResult = await runAppleScript(resetScript)
    log.info(`[phase 1] reset script result: "${resetResult}"`)
    await sleep(300)

    // Phase 2: Open sidebar search via Cmd+F, then type the group name.
    // Cmd+F jumps directly to the sidebar search bar in WhatsApp Desktop.
    // No need to clear the field — Cmd+F always opens a fresh, empty search.
    log.info(`[phase 2] Group send → "${groupName}" (escaped: "${escapedGroupName}"): opening search via Cmd+F`)
    const searchScript = `
      tell application "System Events"
        tell process "${appName}"
          keystroke "f" using command down
          delay 0.5
          keystroke "${escapedGroupName}"
        end tell
      end tell
    `
    const searchResult = await runAppleScript(searchScript)
    log.info(`[phase 2] search script result: "${searchResult}"`)

    // Phase 3: Wait for search results to populate (minimum 2s for group search)
    log.info(`[phase 3] Group send → "${groupName}": waiting for search results`)
    await sleep(Math.max(settings.sendDelayMs, 2000))

    // Phase 4: Select the first search result and open the chat.
    // Arrow Down x2: first moves focus from the search field to the results list,
    // second highlights the first result — then Enter to open it.
    log.info(`[phase 4] Group send → "${groupName}": selecting first result`)
    const selectResultScript = `
      tell application "System Events"
        tell process "${appName}"
          key code 125
          delay 0.3
          key code 125
          delay 0.2
          keystroke return
        end tell
      end tell
    `
    const selectResult = await runAppleScript(selectResultScript)
    log.info(`[phase 4] select result script result: "${selectResult}"`)

    // Wait for the chat to fully load before pasting
    await sleep(1500)

    // Phase 5: Paste the message via clipboard (safer than keystroke for long/special text)
    log.info(`[phase 5] Group send → "${groupName}": pasting message`)
    const pasteScript = `
      set the clipboard to "${escapedMessage}"
      delay 0.3
      tell application "System Events"
        tell process "${appName}"
          keystroke "v" using command down
        end tell
      end tell
    `
    const pasteResult = await runAppleScript(pasteScript)
    log.info(`[phase 5] paste script result: "${pasteResult}"`)
    await sleep(500)

    if (isDryRun) {
      log.info(`[phase 5] Group send → "${groupName}": dry-run complete (Enter skipped)`)
      return { success: true, dryRun: true }
    }

    // Phase 6: Press Enter to send; optionally close the window after.
    log.info(`[phase 6] Group send → "${groupName}": sending${keepOpen ? ' (keep-open)' : ''}`)
    const closeLine = keepOpen ? '' : 'delay 1.0\n          keystroke "w" using command down'
    const sendScript = `
      tell application "System Events"
        tell process "${appName}"
          keystroke return
          ${closeLine}
        end tell
      end tell
    `
    const sendResult = await runAppleScript(sendScript)
    log.info(`[phase 6] send script result: "${sendResult}"`)

    log.info(`[phase 6] Group send → "${groupName}": sent successfully`)
    return { success: true, dryRun: false }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(`Group send → "${groupName}": failed — ${errMsg}`)
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
