import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Static source checks (no Electron imports needed)
// ---------------------------------------------------------------------------

describe('whatsapp.service group send — source checks', () => {
  it('uses Cmd+F (not Cmd+K) to open WhatsApp search', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/services/whatsapp.service.ts'),
      'utf8'
    )
    expect(src).toContain('keystroke "f" using command down')
    expect(src).not.toContain('keystroke "k" using command down')
  })

  it('includes [phase N] log labels for all six phases', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(process.cwd(), 'electron/services/whatsapp.service.ts'),
      'utf8'
    )
    for (let phase = 1; phase <= 6; phase++) {
      expect(src).toContain(`[phase ${phase}]`)
    }
  })
})

// ---------------------------------------------------------------------------
// runAppleScript error detection
// ---------------------------------------------------------------------------

describe('runAppleScript — error detection', () => {
  // We test the error-detection logic by mocking child_process.execFile so
  // it simulates different osascript failure modes.

  beforeEach(() => {
    vi.resetModules()
  })

  it('throws Accessibility error for code 1002', async () => {
    vi.doMock('child_process', () => ({
      execFile: (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error('1002'), '', 'not allowed assistive access (1002)')
        return { kill: vi.fn() }
      }
    }))
    const { runAppleScript } = await import('../electron/utils/applescript')
    await expect(runAppleScript('test')).rejects.toThrow('Accessibility permission not granted')
  })

  it('throws Automation error for code -1743', async () => {
    vi.doMock('child_process', () => ({
      execFile: (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error('-1743'), '', '144:155: execution error: Not authorized to send Apple events to System Events. (-1743)')
        return { kill: vi.fn() }
      }
    }))
    const { runAppleScript } = await import('../electron/utils/applescript')
    await expect(runAppleScript('test')).rejects.toThrow('Automation permission not granted')
  })

  it('throws generic error for unknown failure', async () => {
    vi.doMock('child_process', () => ({
      execFile: (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error('something else'), '', 'some random osascript error')
        return { kill: vi.fn() }
      }
    }))
    const { runAppleScript } = await import('../electron/utils/applescript')
    await expect(runAppleScript('test')).rejects.toThrow('some random osascript error')
  })

  it('resolves with stdout on success', async () => {
    vi.doMock('child_process', () => ({
      execFile: (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, 'ok\n', '')
        return { kill: vi.fn() }
      }
    }))
    const { runAppleScript } = await import('../electron/utils/applescript')
    await expect(runAppleScript('test')).resolves.toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// sendWhatsAppGroupMessage — flow tests
// ---------------------------------------------------------------------------

describe('sendWhatsAppGroupMessage', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockDeps(appleScriptResult = '', commandResult = '') {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue(appleScriptResult),
      runCommand: vi.fn().mockResolvedValue(commandResult)
    }))
    vi.doMock('../electron/services/db.service', () => ({
      getSettings: vi.fn().mockReturnValue({
        globalDryRun: false,
        whatsappApp: 'WhatsApp',
        sendDelayMs: 100
      })
    }))
  }

  it('returns success:true dryRun:true when dryRun=true', async () => {
    mockDeps()
    const { sendWhatsAppGroupMessage } = await import('../electron/services/whatsapp.service')
    const result = await sendWhatsAppGroupMessage('Test Group', 'Hello!', { dryRun: true })
    expect(result).toEqual({ success: true, dryRun: true })
  })

  it('returns success:true dryRun:false when dryRun=false', async () => {
    mockDeps()
    const { sendWhatsAppGroupMessage } = await import('../electron/services/whatsapp.service')
    const result = await sendWhatsAppGroupMessage('Test Group', 'Hello!', { dryRun: false })
    expect(result).toEqual({ success: true, dryRun: false })
  })

  it('returns success:false with error message when AppleScript throws', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn()
        .mockResolvedValueOnce('') // phase 1 reset — ok
        .mockRejectedValueOnce(new Error('Automation permission not granted')), // phase 2 search — fails
      runCommand: vi.fn().mockResolvedValue('')
    }))
    vi.doMock('../electron/services/db.service', () => ({
      getSettings: vi.fn().mockReturnValue({
        globalDryRun: false,
        whatsappApp: 'WhatsApp',
        sendDelayMs: 100
      })
    }))
    const { sendWhatsAppGroupMessage } = await import('../electron/services/whatsapp.service')
    const result = await sendWhatsAppGroupMessage('Test Group', 'Hello!', { dryRun: false })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Automation permission not granted')
  })

  it('globalDryRun setting overrides dryRun=false', async () => {
    vi.doMock('../electron/utils/applescript', () => ({
      runAppleScript: vi.fn().mockResolvedValue(''),
      runCommand: vi.fn().mockResolvedValue('')
    }))
    vi.doMock('../electron/services/db.service', () => ({
      getSettings: vi.fn().mockReturnValue({
        globalDryRun: true, // overrides dryRun param
        whatsappApp: 'WhatsApp',
        sendDelayMs: 100
      })
    }))
    const { sendWhatsAppGroupMessage } = await import('../electron/services/whatsapp.service')
    const result = await sendWhatsAppGroupMessage('Test Group', 'Hello!', { dryRun: false })
    expect(result).toEqual({ success: true, dryRun: true })
  })
})
