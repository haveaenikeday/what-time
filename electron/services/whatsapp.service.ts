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
      log.info(`${appName} not running — launching`)
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
      log.info(`${appName} launched successfully`)
    } else {
      log.info(`${appName} already running`)
    }
  } catch (err) {
    log.warn(`ensureWhatsAppRunning probe failed for ${appName} — proceeding anyway`, err)
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

  log.info(`sendWhatsAppMessage start`, { appName, isDryRun, keepOpen, sendDelayMs: settings.sendDelayMs })

  try {
    const launchErr = await ensureWhatsAppRunning(appName, isDryRun)
    if (launchErr) return launchErr

    // Build the whatsapp:// URL and open it
    const cleanNumber = phoneNumber.replace(/[^\d+]/g, '')
    const encodedMessage = encodeURIComponent(message)
    const url = `whatsapp://send?phone=${cleanNumber}&text=${encodedMessage}`
    log.info(`opening whatsapp:// URL (number length=${cleanNumber.length}, msg length=${message.length})`)

    await runCommand('open', [url])
    await sleep(settings.sendDelayMs)

    if (isDryRun) {
      log.info('contact send: dry-run complete (Enter skipped)')
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
    log.info(`contact send: keystroke return executed${keepOpen ? ' (keep-open)' : ' + Cmd+W'}`)

    return { success: true, dryRun: false }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(`contact send failed: ${errMsg}`)
    return { success: false, error: errMsg, dryRun: isDryRun }
  }
}

/**
 * Send a WhatsApp message to a group via macOS UI automation.
 *
 * Flow (the simple, known-working sequence — macOS-only):
 *   1. Activate WhatsApp + Escape x2 to dismiss any stale dialog.
 *   2. Cmd+F to open WhatsApp's search.
 *   3. Type the group name; wait for results.
 *   4. Down arrow x2 + Enter to select and open the first result.
 *   5. Paste the message via clipboard (Cmd+V — handles emoji/unicode safely).
 *   6. Enter to send (skipped in dry-run); optionally Cmd+W to close window.
 *
 * Each phase logs `[phase N]` so the dev console shows exactly where any
 * failure occurred. Best-effort automation — there is no whatsapp:// URL
 * scheme for groups, so we rely on the keystroke sequence above.
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

  log.info(`sendWhatsAppGroupMessage start`, {
    groupName,
    appName,
    isDryRun,
    keepOpen,
    sendDelayMs: settings.sendDelayMs,
    msgLength: message.length
  })

  try {
    const launchErr = await ensureWhatsAppRunning(appName, isDryRun)
    if (launchErr) return launchErr

    // Phase 1: activate + reset (Escape x2 dismisses any open dialog/search).
    log.info(`[phase 1] activate + Escape x2 for "${groupName}"`)
    await runAppleScript(`
      tell application "${appName}" to activate
      delay 0.8
      tell application "System Events"
        tell process "${appName}"
          key code 53
          delay 0.3
          key code 53
        end tell
      end tell
    `)
    await sleep(300)

    // Phase 2: Cmd+F opens WhatsApp's search bar.
    log.info(`[phase 2] Cmd+F`)
    await runAppleScript(`
      tell application "System Events"
        tell process "${appName}"
          keystroke "f" using command down
        end tell
      end tell
    `)
    await sleep(400)

    // Phase 3: type the group name; wait for results to populate.
    log.info(`[phase 3] type "${escapedGroupName}"`)
    await runAppleScript(`
      tell application "System Events"
        tell process "${appName}"
          keystroke "${escapedGroupName}"
        end tell
      end tell
    `)
    const waitMs = Math.max(settings.sendDelayMs, 2000)
    log.info(`[phase 3] waiting ${waitMs}ms for results`)
    await sleep(waitMs)

    // Phase 4: Down x2 + Enter selects the first result and opens the chat.
    log.info(`[phase 4] Down x2 + Enter`)
    await runAppleScript(`
      tell application "System Events"
        tell process "${appName}"
          key code 125
          delay 0.3
          key code 125
          delay 0.2
          keystroke return
        end tell
      end tell
    `)
    await sleep(1500)

    // Phase 5: paste the message via clipboard (Cmd+V — works with emoji/unicode).
    log.info(`[phase 5] paste message (length=${message.length})`)
    await runAppleScript(`
      set the clipboard to "${escapedMessage}"
      delay 0.3
      tell application "System Events"
        tell process "${appName}"
          keystroke "v" using command down
        end tell
      end tell
    `)
    await sleep(500)

    if (isDryRun) {
      log.info(`[phase 5] dry-run complete (Enter skipped)`)
      return { success: true, dryRun: true }
    }

    // Phase 6: Enter sends; optional Cmd+W closes the window unless keepOpen.
    log.info(`[phase 6] sending${keepOpen ? ' (keep-open)' : ''}`)
    const closeLine = keepOpen ? '' : 'delay 1.0\n          keystroke "w" using command down'
    await runAppleScript(`
      tell application "System Events"
        tell process "${appName}"
          keystroke return
          ${closeLine}
        end tell
      end tell
    `)
    log.info(`Group send → "${groupName}": sent successfully`)
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
