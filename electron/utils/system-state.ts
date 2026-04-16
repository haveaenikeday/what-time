import { runAppleScript, runCommand } from './applescript'
import { createLogger } from './logger'

const log = createLogger('system-state')

/**
 * Apps known to host calls/meetings. We only consider "in call" if one of these
 * is running AND a call signal is present (window title match or audio assertion).
 * Running alone is insufficient — Slack/Chrome/Discord are often open idle.
 */
const CALL_APPS = [
  'FaceTime',
  'zoom.us',
  'Microsoft Teams',
  'Microsoft Teams (work or school)',
  'Webex',
  'Google Chrome',
  'Slack',
  'Discord',
  'WhatsApp'
] as const

/**
 * Window-title substrings that indicate an active call/meeting.
 * Case-insensitive compare in JS (AppleScript returns raw titles).
 */
const CALL_WINDOW_PATTERNS = [
  'Meeting',
  'Zoom Meeting',
  'is calling',
  'Call with',
  'Huddle',
  ' - Meet - ',
  'FaceTime',
  'Incoming call',
  'Ongoing call'
] as const

export interface CallState {
  inCall: boolean
  reason?: string
  detectedApp?: string
}

interface ProbeResult {
  frontApp: string
  runningCallApps: string[]
  matchedWindow: { app: string; title: string } | null
}

/**
 * Single AppleScript that returns a pipe-delimited payload:
 *   "<frontApp>|<runningApp1>,<runningApp2>,...|<matchedApp>::<matchedTitle>"
 * Last segment is empty if no window title matched.
 * Using `try` per process avoids aborting on permission/scripting quirks.
 */
function buildProbeScript(): string {
  const apps = CALL_APPS.map((a) => `"${a}"`).join(', ')
  const patterns = CALL_WINDOW_PATTERNS.map((p) => `"${p}"`).join(', ')

  return `
    set callApps to {${apps}}
    set callPatterns to {${patterns}}
    set runningList to {}
    set matchedEntry to ""
    set frontAppName to ""
    tell application "System Events"
      try
        set frontAppName to name of first application process whose frontmost is true
      end try
      repeat with appName in callApps
        try
          if (exists process (appName as string)) then
            set end of runningList to (appName as string)
            if matchedEntry is "" then
              try
                set winNames to name of every window of process (appName as string)
                repeat with w in winNames
                  set wStr to w as string
                  repeat with pat in callPatterns
                    if wStr contains (pat as string) then
                      set matchedEntry to ((appName as string) & "::" & wStr)
                      exit repeat
                    end if
                  end repeat
                  if matchedEntry is not "" then exit repeat
                end repeat
              end try
            end if
          end if
        end try
      end repeat
    end tell
    set AppleScript's text item delimiters to ","
    set runningStr to runningList as string
    set AppleScript's text item delimiters to ""
    return frontAppName & "|" & runningStr & "|" & matchedEntry
  `
}

/** Parse the pipe-delimited probe payload. Returns a safe default on malformed input. */
export function parseProbeOutput(raw: string): ProbeResult {
  const parts = raw.split('|')
  if (parts.length < 3) {
    return { frontApp: '', runningCallApps: [], matchedWindow: null }
  }
  const frontApp = (parts[0] || '').trim()
  const runningCallApps = (parts[1] || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const matchedRaw = (parts.slice(2).join('|') || '').trim()
  let matchedWindow: ProbeResult['matchedWindow'] = null
  if (matchedRaw.length > 0) {
    const sep = matchedRaw.indexOf('::')
    if (sep > 0) {
      matchedWindow = {
        app: matchedRaw.slice(0, sep),
        title: matchedRaw.slice(sep + 2)
      }
    }
  }
  return { frontApp, runningCallApps, matchedWindow }
}

/** `pmset -g assertions` reports an active audio-input count when a call/recording is live. */
export function parsePmsetAudioInUse(output: string): boolean {
  // Common forms across macOS versions:
  //   cnt_audio_in_use              2
  //   "AudioIn"                     true
  //   cnt_mediaengine_playing       1
  // Treat ANY non-zero `cnt_audio_in_use` OR an `"AudioIn" true` line as audio-in-use.
  const audioInMatch = output.match(/cnt_audio_in_use\s+(\d+)/i)
  if (audioInMatch && parseInt(audioInMatch[1], 10) > 0) return true
  if (/"?AudioIn"?\s+true/i.test(output)) return true
  return false
}

/**
 * Detect whether the user appears to be in a call/meeting.
 *
 * Fail-open policy: any probe error → `{ inCall: false }` so scheduled sends
 * are never starved because detection itself broke.
 *
 * Decision rule:
 *   inCall = (a call app has a call-window title) OR
 *            (a call app is running AND pmset reports audio-in active)
 */
export async function isSystemInCall(): Promise<CallState> {
  let probe: ProbeResult
  try {
    const raw = await runAppleScript(buildProbeScript(), 5000)
    probe = parseProbeOutput(raw)
  } catch (err) {
    log.warn('call-state probe failed — fail-open', err)
    return { inCall: false }
  }

  if (probe.matchedWindow) {
    return {
      inCall: true,
      reason: `window title "${probe.matchedWindow.title}"`,
      detectedApp: probe.matchedWindow.app
    }
  }

  if (probe.runningCallApps.length === 0) {
    return { inCall: false }
  }

  // Second probe: audio-in assertion. Only meaningful if a call-capable app is running.
  let audioInUse = false
  try {
    const out = await runCommand('pmset', ['-g', 'assertions'], 5000)
    audioInUse = parsePmsetAudioInUse(out)
  } catch (err) {
    log.warn('pmset probe failed — ignoring audio signal', err)
  }

  if (audioInUse) {
    return {
      inCall: true,
      reason: 'audio input active',
      detectedApp: probe.frontApp || probe.runningCallApps[0]
    }
  }

  return { inCall: false }
}
