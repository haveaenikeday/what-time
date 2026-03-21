import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/ipc'
import { Select } from '@/components/ui/select'
import { ShieldCheck, ShieldAlert, AlertTriangle, BookUser, Sun, Moon, Monitor } from 'lucide-react'
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
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Accessibility Permission */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          {accessibility?.granted ? (
            <ShieldCheck className="h-5 w-5 text-green-600" />
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
            <BookUser className="h-5 w-5 text-green-600" />
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
              Launch WhaTime automatically when you log in (runs in background)
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
    </div>
  )
}
