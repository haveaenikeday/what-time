import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/ipc'
import { Select } from '@/components/ui/select'
import { ShieldCheck, ShieldAlert, AlertTriangle, BookUser, Sun, Moon, Monitor, RefreshCw } from 'lucide-react'
import type { AccessibilityStatus } from '../../shared/types'

/** Debounced text input that only persists after the user stops typing. */
function DebouncedInput({
  value,
  onSave,
  ...props
}: {
  value: string
  onSave: (value: string) => void
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocal(value) }, [value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setLocal(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSave(v), 600)
  }, [onSave])

  // Save immediately on blur (in case user tabs away before debounce fires)
  const handleBlur = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    onSave(local)
  }, [local, onSave])

  return <Input value={local} onChange={handleChange} onBlur={handleBlur} {...props} />
}

export function Settings() {
  const { settings, loading, updateSetting } = useSettings()
  const [accessibility, setAccessibility] = useState<AccessibilityStatus | null>(null)
  const [checkingAccess, setCheckingAccess] = useState(false)
  const [contacts, setContacts] = useState<AccessibilityStatus | null>(null)
  const [checkingContacts, setCheckingContacts] = useState(false)
  const [buildStatus, setBuildStatus] = useState<'idle' | 'building' | 'error'>('idle')
  const [buildError, setBuildError] = useState('')

  useEffect(() => {
    checkAccess()
    checkContacts()
  }, [])

  async function checkAccess() {
    setCheckingAccess(true)
    try {
      const status = await api.checkAccessibility()
      setAccessibility(status)
    } catch {
      setAccessibility({ granted: false, error: 'Check failed' })
    } finally {
      setCheckingAccess(false)
    }
  }

  async function checkContacts() {
    setCheckingContacts(true)
    try {
      const status = await api.checkContactsAccess()
      setContacts(status)
    } catch {
      setContacts({ granted: false, error: 'Check failed' })
    } finally {
      setCheckingContacts(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading settings...</div>
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold app-drag-region">Settings</h1>

      {/* Accessibility Permission */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          {accessibility?.granted ? (
            <ShieldCheck className="h-5 w-5 text-teal-700" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-yellow-600" />
          )}
          <h2 className="font-medium">Accessibility Permission</h2>
          {accessibility && (
            <Badge variant={accessibility.granted ? 'success' : 'warning'}>
              {accessibility.granted ? 'Granted' : 'Not Granted'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Required to send keystrokes to WhatsApp Desktop.
          Go to <strong>System Settings &gt; Privacy &amp; Security &gt; Accessibility</strong> and add this app.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkAccess}
            disabled={checkingAccess}
          >
            {checkingAccess ? 'Checking...' : 'Re-check'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => api.openAccessibilitySettings()}
          >
            Open System Settings
          </Button>
        </div>
      </div>

      {/* Contacts Permission */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          {contacts?.granted ? (
            <BookUser className="h-5 w-5 text-teal-700" />
          ) : (
            <BookUser className="h-5 w-5 text-yellow-600" />
          )}
          <h2 className="font-medium">Contacts Permission</h2>
          {contacts && (
            <Badge variant={contacts.granted ? 'success' : 'warning'}>
              {contacts.granted ? 'Granted' : 'Not Granted'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Optional — needed to search your macOS Contacts when creating a schedule.
          macOS will prompt you automatically the first time you search.
          Go to <strong>System Settings &gt; Privacy &amp; Security &gt; Contacts</strong> to manage access.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkContacts}
            disabled={checkingContacts}
          >
            {checkingContacts ? 'Checking...' : 'Re-check'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => api.openContactsSettings()}
          >
            Open System Settings
          </Button>
        </div>
      </div>

      {/* Warnings */}
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
          <h2 className="font-medium text-yellow-800 dark:text-yellow-400 text-sm">Important Notes</h2>
        </div>
        <ul className="text-xs text-yellow-700 dark:text-yellow-500/80 space-y-1 list-disc list-inside">
          <li>Your Mac must be unlocked for scheduled sends to work</li>
          <li>WhatsApp Desktop must be installed and logged in</li>
          <li>The app runs in the background when you close the window (check the tray icon)</li>
          <li>UI automation may fail if WhatsApp updates its interface</li>
        </ul>
      </div>

      {/* Start at Login */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.openAtLogin}
            onCheckedChange={(v) => updateSetting('open_at_login', v ? '1' : '0')}
          />
          <div>
            <Label>Start at Login</Label>
            <p className="text-xs text-muted-foreground">
              Launch WhatTime automatically when you log in (runs in background)
            </p>
          </div>
        </div>
      </div>

      {/* Global Dry Run */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.globalDryRun}
            onCheckedChange={(v) => updateSetting('global_dry_run', v ? '1' : '0')}
          />
          <div>
            <Label>Global Dry Run</Label>
            <p className="text-xs text-muted-foreground">
              When enabled, all sends will open WhatsApp but not press Enter
            </p>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <Label htmlFor="theme">Appearance</Label>
        <div className="flex items-center gap-3">
          {settings.theme === 'dark' ? (
            <Moon className="h-4 w-4 text-muted-foreground" />
          ) : settings.theme === 'light' ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Monitor className="h-4 w-4 text-muted-foreground" />
          )}
          <Select
            id="theme"
            value={settings.theme}
            onValueChange={(v) => updateSetting('theme', v)}
            className="w-40"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </div>
      </div>

      {/* Default Country Code */}
      <div className="space-y-2">
        <Label htmlFor="country-code">Default Country Code</Label>
        <DebouncedInput
          id="country-code"
          value={settings.defaultCountryCode}
          onSave={(v) => updateSetting('default_country_code', v)}
          className="w-24"
          placeholder="+1"
        />
      </div>

      {/* Send Delay */}
      <div className="space-y-2">
        <Label htmlFor="delay">Send Delay (ms)</Label>
        <p className="text-xs text-muted-foreground">
          How long to wait after opening WhatsApp before pressing Enter.
          Increase if WhatsApp is slow to load.
        </p>
        <DebouncedInput
          id="delay"
          type="number"
          min={1000}
          max={15000}
          step={500}
          value={String(settings.sendDelayMs)}
          onSave={(v) => updateSetting('send_delay_ms', v)}
          className="w-32"
        />
      </div>

      {/* Max Retries */}
      <div className="space-y-2">
        <Label htmlFor="max-retries">Max Retries</Label>
        <p className="text-xs text-muted-foreground">
          How many times to retry a failed send (with exponential backoff: 10s → 30s → 90s).
        </p>
        <DebouncedInput
          id="max-retries"
          type="number"
          min={1}
          max={10}
          step={1}
          value={String(settings.maxRetries)}
          onSave={(v) => {
            const n = Math.max(1, Math.min(10, parseInt(v, 10) || 3))
            updateSetting('max_retries', String(n))
          }}
          className="w-24"
        />
      </div>

      {/* WhatsApp App Name */}
      <div className="space-y-2">
        <Label htmlFor="app-name">WhatsApp App Name</Label>
        <p className="text-xs text-muted-foreground">
          The macOS app name for AppleScript targeting. Usually "WhatsApp".
        </p>
        <DebouncedInput
          id="app-name"
          value={settings.whatsappApp}
          onSave={(v) => updateSetting('whatsapp_app', v)}
          className="w-48"
        />
      </div>

      {/* Experimental Features */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.enableGroupScheduling}
            onCheckedChange={(v) => updateSetting('enable_group_scheduling', v ? '1' : '0')}
          />
          <div>
            <Label>Enable Group Scheduling (Experimental)</Label>
            <p className="text-xs text-muted-foreground">
              Send scheduled messages to WhatsApp groups via UI automation.
              Less reliable than contact scheduling. Defaults to dry-run.
            </p>
          </div>
        </div>
      </div>

      {/* Smart Scheduling */}
      <div className="rounded-lg border p-4 space-y-4">
        <h2 className="font-medium">Smart Scheduling</h2>

        {/* Pause during calls */}
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.pauseDuringCalls}
            onCheckedChange={(v) => updateSetting('pause_during_calls', v ? '1' : '0')}
          />
          <div>
            <Label>Pause sends during calls</Label>
            <p className="text-xs text-muted-foreground">
              Hold scheduled sends while FaceTime, Zoom, Meet, Teams, Slack huddles, etc. are active — resume when the call ends.
            </p>
          </div>
        </div>

        {/* Max wait (minutes) — stored as ms */}
        <div className="space-y-2 pl-12">
          <Label htmlFor="call-max-wait">Max wait before giving up (minutes)</Label>
          <p className="text-xs text-muted-foreground">
            If the call is still going after this long, the send is skipped with a log entry.
          </p>
          <DebouncedInput
            id="call-max-wait"
            type="number"
            min={1}
            max={240}
            step={1}
            value={String(Math.round(settings.callMaxWaitMs / 60000))}
            onSave={(v) => {
              const mins = Math.max(1, Math.min(240, parseInt(v, 10) || 30))
              updateSetting('call_max_wait_ms', String(mins * 60000))
            }}
            className="w-24"
            disabled={!settings.pauseDuringCalls}
          />
        </div>

        {/* Poll interval (seconds) — stored as ms */}
        <div className="space-y-2 pl-12">
          <Label htmlFor="call-poll-interval">Recheck interval (seconds)</Label>
          <p className="text-xs text-muted-foreground">
            How often to check whether the call has ended.
          </p>
          <DebouncedInput
            id="call-poll-interval"
            type="number"
            min={15}
            max={600}
            step={15}
            value={String(Math.round(settings.callPollIntervalMs / 1000))}
            onSave={(v) => {
              const secs = Math.max(15, Math.min(600, parseInt(v, 10) || 60))
              updateSetting('call_poll_interval_ms', String(secs * 1000))
            }}
            className="w-24"
            disabled={!settings.pauseDuringCalls}
          />
        </div>

        {/* Enable queue */}
        <div className="flex items-center gap-3 pt-2 border-t">
          <Switch
            checked={settings.enableSendQueue}
            onCheckedChange={(v) => updateSetting('enable_send_queue', v ? '1' : '0')}
          />
          <div>
            <Label>Serialize simultaneous sends</Label>
            <p className="text-xs text-muted-foreground">
              When multiple schedules fire at the same time, queue them — groups first, contacts after. Keeps WhatsApp open between chained sends.
            </p>
          </div>
        </div>

        {/* Inter-send delay (ms) */}
        <div className="space-y-2 pl-12">
          <Label htmlFor="queue-delay">Gap between chained sends (ms)</Label>
          <p className="text-xs text-muted-foreground">
            Pause between consecutive sends in the queue. Too short and WhatsApp may lag behind.
          </p>
          <DebouncedInput
            id="queue-delay"
            type="number"
            min={500}
            max={10000}
            step={250}
            value={String(settings.queueInterSendDelayMs)}
            onSave={(v) => {
              const ms = Math.max(500, Math.min(10000, parseInt(v, 10) || 1500))
              updateSetting('queue_inter_send_delay_ms', String(ms))
            }}
            className="w-28"
            disabled={!settings.enableSendQueue}
          />
        </div>
      </div>

      {/* Developer */}
      <div className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">Developer</h2>
        <p className="text-sm text-muted-foreground">
          Rebuild the app from source and restart. Use this after making code changes.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={buildStatus === 'building'}
            onClick={async () => {
              setBuildStatus('building')
              setBuildError('')
              const result = await api.rebuildApp()
              if (!result.success) {
                setBuildStatus('error')
                setBuildError(result.error ?? 'Build failed')
              }
            }}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${buildStatus === 'building' ? 'animate-spin' : ''}`} />
            {buildStatus === 'building' ? 'Building...' : 'Rebuild & Restart'}
          </Button>
        </div>
        {buildStatus === 'error' && (
          <p className="text-xs text-red-600 dark:text-red-400 font-mono">{buildError}</p>
        )}
      </div>
    </div>
  )
}
