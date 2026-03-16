import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/ipc'
import { ShieldCheck, ShieldAlert, AlertTriangle, BookUser } from 'lucide-react'
import type { AccessibilityStatus } from '../../shared/types'

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
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <h2 className="font-medium text-yellow-800 text-sm">Important Notes</h2>
        </div>
        <ul className="text-xs text-yellow-700 space-y-1 list-disc list-inside">
          <li>Your Mac must be unlocked for scheduled sends to work</li>
          <li>WhatsApp Desktop must be installed and logged in</li>
          <li>The app must be running for schedules to fire</li>
          <li>UI automation may fail if WhatsApp updates its interface</li>
        </ul>
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

      {/* Default Country Code */}
      <div className="space-y-2">
        <Label htmlFor="country-code">Default Country Code</Label>
        <Input
          id="country-code"
          value={settings.defaultCountryCode}
          onChange={(e) => updateSetting('default_country_code', e.target.value)}
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
        <Input
          id="delay"
          type="number"
          min={1000}
          max={15000}
          step={500}
          value={settings.sendDelayMs}
          onChange={(e) => updateSetting('send_delay_ms', e.target.value)}
          className="w-32"
        />
      </div>

      {/* WhatsApp App Name */}
      <div className="space-y-2">
        <Label htmlFor="app-name">WhatsApp App Name</Label>
        <p className="text-xs text-muted-foreground">
          The macOS app name for AppleScript targeting. Usually "WhatsApp".
        </p>
        <Input
          id="app-name"
          value={settings.whatsappApp}
          onChange={(e) => updateSetting('whatsapp_app', e.target.value)}
          className="w-48"
        />
      </div>
    </div>
  )
}
