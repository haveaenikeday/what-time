import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseProbeOutput, parsePmsetAudioInUse } from '../electron/utils/system-state'

describe('parseProbeOutput', () => {
  it('parses all three segments when a window title matches', () => {
    const raw = 'FaceTime|FaceTime,WhatsApp|FaceTime::FaceTime - Alice'
    const out = parseProbeOutput(raw)
    expect(out.frontApp).toBe('FaceTime')
    expect(out.runningCallApps).toEqual(['FaceTime', 'WhatsApp'])
    expect(out.matchedWindow).toEqual({ app: 'FaceTime', title: 'FaceTime - Alice' })
  })

  it('handles no matching window', () => {
    const raw = 'Finder|Slack,Google Chrome|'
    const out = parseProbeOutput(raw)
    expect(out.frontApp).toBe('Finder')
    expect(out.runningCallApps).toEqual(['Slack', 'Google Chrome'])
    expect(out.matchedWindow).toBeNull()
  })

  it('handles empty running-apps segment', () => {
    const raw = 'Finder||'
    const out = parseProbeOutput(raw)
    expect(out.runningCallApps).toEqual([])
    expect(out.matchedWindow).toBeNull()
  })

  it('preserves pipes inside the title via slice fallback', () => {
    const raw = 'zoom.us|zoom.us|zoom.us::Meeting | John Doe'
    const out = parseProbeOutput(raw)
    expect(out.matchedWindow?.app).toBe('zoom.us')
    expect(out.matchedWindow?.title).toBe('Meeting | John Doe')
  })

  it('returns safe default on malformed input', () => {
    const out = parseProbeOutput('garbage')
    expect(out.frontApp).toBe('')
    expect(out.runningCallApps).toEqual([])
    expect(out.matchedWindow).toBeNull()
  })
})

describe('parsePmsetAudioInUse', () => {
  it('true when cnt_audio_in_use > 0', () => {
    expect(parsePmsetAudioInUse('cnt_user_active_assertion 1\ncnt_audio_in_use              2\n')).toBe(true)
  })

  it('false when cnt_audio_in_use = 0', () => {
    expect(parsePmsetAudioInUse('cnt_audio_in_use  0\ncnt_mediaengine_playing 0')).toBe(false)
  })

  it('true when "AudioIn" true assertion present', () => {
    expect(parsePmsetAudioInUse('    "AudioIn"                     true\n')).toBe(true)
  })

  it('false when no audio fields present', () => {
    expect(parsePmsetAudioInUse('cnt_user_active_assertion 0\nsome other data')).toBe(false)
  })
})

describe('isSystemInCall', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns inCall=true when window title matches a call pattern', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('FaceTime|FaceTime|FaceTime::FaceTime'),
      runCommand: vi.fn()
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(true)
    expect(state.detectedApp).toBe('FaceTime')
    expect(state.reason).toContain('window title')
  })

  it('returns inCall=true for Zoom meeting window', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('zoom.us|zoom.us|zoom.us::Zoom Meeting - John'),
      runCommand: vi.fn()
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(true)
    expect(state.detectedApp).toBe('zoom.us')
  })

  it('returns inCall=false when only Slack is running with no huddle title and no audio', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('Finder|Slack|'),
      runCommand: vi.fn().mockResolvedValue('cnt_audio_in_use 0\n')
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(false)
  })

  it('returns inCall=true when a call app runs + pmset reports audio in use', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('Finder|Slack|'),
      runCommand: vi.fn().mockResolvedValue('cnt_audio_in_use 1\n')
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(true)
    expect(state.reason).toContain('audio input active')
  })

  it('returns inCall=false when no known call apps are running, even if audio is active', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('Finder||'),
      runCommand: vi.fn().mockResolvedValue('cnt_audio_in_use 1\n')
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(false)
  })

  it('fail-open: AppleScript throws → returns inCall=false', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockRejectedValue(new Error('osascript boom')),
      runCommand: vi.fn()
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(false)
  })

  it('fail-open: pmset throws → falls back to no audio signal', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('Finder|Slack|'),
      runCommand: vi.fn().mockRejectedValue(new Error('pmset missing'))
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(false)
  })

  it('malformed AppleScript output → returns inCall=false', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue('garbage without pipes'),
      runCommand: vi.fn()
    }))
    const { isSystemInCall } = await import('../electron/utils/system-state')
    const state = await isSystemInCall()
    expect(state.inCall).toBe(false)
  })
})
