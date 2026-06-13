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

function sendError(message: string, isDryRun: boolean): SendResult {
  return { success: false, error: message, dryRun: isDryRun }
}

async function getFrontmostApp(): Promise<string> {
  return (await runAppleScript(
    'tell application "System Events" to return name of first application process whose frontmost is true',
    5000
  )).trim()
}

/**
 * Ensure WhatsApp Desktop is running. Launches it if not.
 * Returns a SendResult error if it cannot be started, or null on success.
 */
async function ensureWhatsAppRunning(appName: string, isDryRun: boolean): Promise<SendResult | null> {
  const escapedAppName = escapeForAppleScript(appName)
  const checkScript = `tell application "System Events" to (name of processes) contains "${escapedAppName}"`
  try {
    const running = await runAppleScript(checkScript)
    if (running.trim() === 'false') {
      log.info(`${appName} not running — launching`)
      try {
        await runCommand('open', ['-a', appName])
      } catch {
        return sendError(`${appName} is not installed or could not be launched`, isDryRun)
      }
      let launched = false
      for (let i = 0; i < 5; i++) {
        await sleep(1000)
        try {
          const recheck = await runAppleScript(checkScript)
          if (recheck.trim() === 'true') { launched = true; break }
        } catch { /* continue checking */ }
      }
      if (!launched) {
        return sendError(`${appName} failed to start after 5 seconds`, isDryRun)
      }
      log.info(`${appName} launched successfully`)
    } else {
      log.info(`${appName} already running`)
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.warn(`ensureWhatsAppRunning probe failed for ${appName} — failing closed`, err)
    return sendError(`Could not confirm ${appName} is running: ${errMsg}`, isDryRun)
  }
  return null
}

async function activateAndConfirmWhatsApp(
  appName: string,
  isDryRun: boolean,
  context: string
): Promise<SendResult | null> {
  const escapedAppName = escapeForAppleScript(appName)

  try {
    await runAppleScript(`tell application "${escapedAppName}" to activate`, 5000)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return sendError(`Could not activate ${appName} before ${context}: ${errMsg}`, isDryRun)
  }

  let lastFrontApp = ''
  for (let i = 0; i < 5; i++) {
    await sleep(300)
    try {
      lastFrontApp = await getFrontmostApp()
      if (lastFrontApp === appName) return null
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return sendError(`Could not confirm frontmost app before ${context}: ${errMsg}`, isDryRun)
    }
  }

  return sendError(
    `${appName} did not become frontmost before ${context}${lastFrontApp ? ` (frontmost: ${lastFrontApp})` : ''}`,
    isDryRun
  )
}

async function runWhatsAppAutomationScript(
  appName: string,
  isDryRun: boolean,
  context: string,
  automationScript: string,
  timeoutMs = 10000
): Promise<SendResult | null> {
  const focusErr = await activateAndConfirmWhatsApp(appName, isDryRun, context)
  if (focusErr) return focusErr

  const escapedAppName = escapeForAppleScript(appName)
  const escapedContext = escapeForAppleScript(context)
  try {
    await runAppleScript(`
      tell application "System Events"
        if not (exists process "${escapedAppName}") then error "${escapedAppName} is not running before ${escapedContext}"
        if name of first application process whose frontmost is true is not "${escapedAppName}" then error "${escapedAppName} is not frontmost before ${escapedContext}"
      end tell
      ${automationScript}
    `, timeoutMs)
    return null
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return sendError(errMsg, isDryRun)
  }
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
  const escapedAppName = escapeForAppleScript(appName)

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

    // Press Enter to send only after WhatsApp is confirmed frontmost.
    const closeLine = keepOpen ? '' : `
          delay 1.0
          if name of first application process whose frontmost is true is not "${escapedAppName}" then error "${escapedAppName} is not frontmost before closing chat"
          keystroke "w" using command down`
    const sendErr = await runWhatsAppAutomationScript(appName, isDryRun, 'contact send', `
      tell application "System Events"
        tell process "${escapedAppName}"
          keystroke return
          ${closeLine}
        end tell
      end tell
    `)
    if (sendErr) return sendErr
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
  const escapedAppName = escapeForAppleScript(appName)
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
    const phase1Err = await runWhatsAppAutomationScript(appName, isDryRun, 'group phase 1 reset', `
      tell application "System Events"
        tell process "${escapedAppName}"
          key code 53
          delay 0.3
          key code 53
        end tell
      end tell
    `)
    if (phase1Err) return phase1Err
    await sleep(300)

    // Phase 2: Cmd+F opens WhatsApp's search bar.
    log.info(`[phase 2] Cmd+F`)
    const phase2Err = await runWhatsAppAutomationScript(appName, isDryRun, 'group phase 2 search', `
      tell application "System Events"
        tell process "${escapedAppName}"
          keystroke "f" using command down
        end tell
      end tell
    `)
    if (phase2Err) return phase2Err
    await sleep(400)

    // Phase 3: type the group name; wait for results to populate.
    log.info(`[phase 3] type "${escapedGroupName}"`)
    const phase3Err = await runWhatsAppAutomationScript(appName, isDryRun, 'group phase 3 type group name', `
      tell application "System Events"
        tell process "${escapedAppName}"
          keystroke "${escapedGroupName}"
        end tell
      end tell
    `)
    if (phase3Err) return phase3Err
    const waitMs = Math.max(settings.sendDelayMs, 2000)
    log.info(`[phase 3] waiting ${waitMs}ms for results`)
    await sleep(waitMs)

    // Phase 4: Down x2 + Enter selects the first result and opens the chat.
    log.info(`[phase 4] Down x2 + Enter`)
    const phase4Err = await runWhatsAppAutomationScript(appName, isDryRun, 'group phase 4 open chat', `
      tell application "System Events"
        tell process "${escapedAppName}"
          key code 125
          delay 0.3
          key code 125
          delay 0.2
          keystroke return
        end tell
      end tell
    `)
    if (phase4Err) return phase4Err
    await sleep(1500)

    // Phase 5: paste the message via clipboard (Cmd+V — works with emoji/unicode).
    log.info(`[phase 5] paste message (length=${message.length})`)
    const phase5Err = await runWhatsAppAutomationScript(appName, isDryRun, 'group phase 5 paste message', `
      set the clipboard to "${escapedMessage}"
      delay 0.3
      tell application "System Events"
        tell process "${escapedAppName}"
          keystroke "v" using command down
        end tell
      end tell
    `)
    if (phase5Err) return phase5Err
    await sleep(500)

    if (isDryRun) {
      log.info(`[phase 5] dry-run complete (Enter skipped)`)
      return { success: true, dryRun: true }
    }

    // Phase 6: Enter sends; optional Cmd+W closes the window unless keepOpen.
    log.info(`[phase 6] sending${keepOpen ? ' (keep-open)' : ''}`)
    const closeLine = keepOpen ? '' : `
          delay 1.0
          if name of first application process whose frontmost is true is not "${escapedAppName}" then error "${escapedAppName} is not frontmost before closing chat"
          keystroke "w" using command down`
    const phase6Err = await runWhatsAppAutomationScript(appName, isDryRun, 'group phase 6 send', `
      tell application "System Events"
        tell process "${escapedAppName}"
          keystroke return
          ${closeLine}
        end tell
      end tell
    `)
    if (phase6Err) return phase6Err
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
