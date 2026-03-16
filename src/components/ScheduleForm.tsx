import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/ipc'
import { Search, User, X, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExtendedScheduleDialog } from '@/components/ExtendedScheduleDialog'
import type { Schedule, CreateScheduleInput, ScheduleType, Contact } from '../../shared/types'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const EXTENDED_TYPES = ['quarterly', 'half_yearly', 'yearly'] as const
type ExtendedType = typeof EXTENDED_TYPES[number]

function isExtendedType(t: string): t is ExtendedType {
  return (EXTENDED_TYPES as readonly string[]).includes(t)
}

function buildSummaryText(
  scheduleType: string,
  timeOfDay: string,
  dayOfMonth: number,
  monthOfYear: number
): string {
  const day = dayOfMonth
  const time = timeOfDay || '09:00'
  if (scheduleType === 'quarterly') {
    const months = [0, 1, 2, 3].map(i => MONTHS[(monthOfYear + i * 3) % 12])
    return `${day}th of ${months.join(', ')} at ${time}`
  }
  if (scheduleType === 'half_yearly') {
    const m2 = (monthOfYear + 6) % 12
    return `${day}th of ${MONTHS[monthOfYear]} and ${MONTHS[m2]} at ${time}`
  }
  if (scheduleType === 'yearly') {
    return `${day}th of ${MONTHS[monthOfYear]} every year at ${time}`
  }
  return ''
}

interface ScheduleFormProps {
  initial?: Schedule | null
  onSubmit: (data: CreateScheduleInput) => Promise<void>
  onCancel: () => void
}

export function ScheduleForm({ initial, onSubmit, onCancel }: ScheduleFormProps) {
  const [phoneNumber, setPhoneNumber] = useState(initial?.phoneNumber || '')
  const [contactName, setContactName] = useState(initial?.contactName || '')
  const [message, setMessage] = useState(initial?.message || '')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial?.scheduleType || 'one_time')
  const [scheduledAt, setScheduledAt] = useState(initial?.scheduledAt || '')
  const [timeOfDay, setTimeOfDay] = useState(initial?.timeOfDay || '09:00')
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek ?? 1)
  const [dryRun, setDryRun] = useState(initial?.dryRun || false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Extended schedule state
  const [extDialogOpen, setExtDialogOpen] = useState(false)
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth ?? 15)
  const [monthOfYear, setMonthOfYear] = useState(initial?.monthOfYear ?? 0)
  const [extConfigured, setExtConfigured] = useState(
    !!initial && isExtendedType(initial.scheduleType)
  )

  // Contact search state
  const [contactQuery, setContactQuery] = useState('')
  const [contactResults, setContactResults] = useState<Contact[]>([])
  const [contactLoading, setContactLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [contactError, setContactError] = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Convert ISO scheduledAt to datetime-local format for the input
  useEffect(() => {
    if (initial?.scheduledAt) {
      try {
        const d = new Date(initial.scheduledAt)
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
        setScheduledAt(local)
      } catch {
        setScheduledAt('')
      }
    }
  }, [initial])

  // Debounced contact search — only fires when query has 2+ chars
  function handleContactSearch(query: string): void {
    setContactQuery(query)
    setContactError(null)

    if (searchTimeout.current) clearTimeout(searchTimeout.current)

    if (query.trim().length < 2) {
      setContactResults([])
      setShowDropdown(false)
      return
    }

    setContactLoading(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await api.searchContacts(query)
        setContactResults(results)
        setShowDropdown(results.length > 0)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Contact search failed'
        setContactError(msg)
        setContactResults([])
        setShowDropdown(false)
      } finally {
        setContactLoading(false)
      }
    }, 300)
  }

  function selectContact(contact: Contact): void {
    setSelectedContact(contact)
    // Strip spaces so phone validation passes cleanly
    setPhoneNumber(contact.phoneNumber.replace(/\s/g, ''))
    setContactName(contact.name)
    setContactQuery('')
    setContactResults([])
    setShowDropdown(false)
    // Clear any existing phone error
    setErrors((e) => ({ ...e, phoneNumber: '' }))
  }

  function clearContact(): void {
    setSelectedContact(null)
    setPhoneNumber('')
    setContactName('')
    setContactQuery('')
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '')
    if (!cleanPhone || cleanPhone.replace(/\+/g, '').length < 7) {
      errs.phoneNumber = 'Enter a valid phone number (with country code)'
    }
    if (!message.trim()) {
      errs.message = 'Message cannot be empty'
    }
    if (scheduleType === 'one_time' && !scheduledAt) {
      errs.scheduledAt = 'Select a date and time'
    }
    if (scheduleType === 'one_time' && scheduledAt) {
      const d = new Date(scheduledAt)
      if (d <= new Date()) {
        errs.scheduledAt = 'Date must be in the future'
      }
    }
    if (isExtendedType(scheduleType) && !extConfigured) {
      errs.extended = 'Please configure the recurrence schedule'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!validate()) return

    setSubmitting(true)
    try {
      const data: CreateScheduleInput = {
        phoneNumber: phoneNumber.replace(/[^\d+]/g, ''),
        contactName: contactName.trim(),
        message: message.trim(),
        scheduleType,
        dryRun
      }

      if (scheduleType === 'one_time') {
        data.scheduledAt = new Date(scheduledAt).toISOString()
      } else if (scheduleType === 'daily') {
        data.timeOfDay = timeOfDay
      } else if (scheduleType === 'weekly') {
        data.timeOfDay = timeOfDay
        data.dayOfWeek = dayOfWeek
      } else if (isExtendedType(scheduleType)) {
        data.timeOfDay = timeOfDay
        data.dayOfMonth = dayOfMonth
        data.monthOfYear = monthOfYear
      }

      await onSubmit(data)
    } finally {
      setSubmitting(false)
    }
  }

  const summaryText = isExtendedType(scheduleType)
    ? buildSummaryText(scheduleType, timeOfDay, dayOfMonth, monthOfYear)
    : ''

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Recipient ─────────────────────────────────────── */}
        <div className="space-y-2">
          <Label>Recipient</Label>

          {/* Contact search input */}
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name (2+ chars)…"
                value={contactQuery}
                onChange={(e) => handleContactSearch(e.target.value)}
                onFocus={() => contactResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                className="pl-9"
                autoComplete="off"
              />
              {contactLoading && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  Searching…
                </span>
              )}
            </div>

            {/* Results dropdown */}
            {showDropdown && contactResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 rounded-md border bg-background shadow-lg max-h-52 overflow-y-auto">
                {contactResults.map((contact, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={() => selectContact(contact)} // mouseDown fires before onBlur
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left"
                  >
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium block truncate">{contact.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {contact.phoneNumber} · {contact.phoneLabel}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Permission / search error */}
          {contactError && (
            <p className="text-xs text-yellow-600">
              ⚠ {contactError}
            </p>
          )}

          {/* Selected contact pill */}
          {selectedContact && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">{selectedContact.name}</span>
                <span className="text-xs text-muted-foreground">{selectedContact.phoneNumber}</span>
              </div>
              <button
                type="button"
                onClick={clearContact}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Clear contact"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* ── Phone Number ───────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="phone">
            Phone Number
            {selectedContact && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">(auto-filled)</span>
            )}
          </Label>
          <Input
            id="phone"
            placeholder="+1234567890"
            value={phoneNumber}
            onChange={(e) => {
              setPhoneNumber(e.target.value)
              // If user edits manually, clear the contact link
              if (selectedContact) setSelectedContact(null)
            }}
            className={cn(selectedContact && 'border-green-400/60')}
          />
          {errors.phoneNumber && <p className="text-xs text-destructive">{errors.phoneNumber}</p>}
        </div>

        {/* ── Contact Name ───────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="contact">
            Contact Name (optional)
            {selectedContact && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">(auto-filled)</span>
            )}
          </Label>
          <Input
            id="contact"
            placeholder="John Doe"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>

        {/* ── Message ────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="message">Message</Label>
          <Textarea
            id="message"
            placeholder="Type your message..."
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            {errors.message && <p className="text-destructive">{errors.message}</p>}
            <span className="ml-auto">{message.length} chars</span>
          </div>
        </div>

        {/* ── Schedule Type ──────────────────────────────────── */}
        <div className="space-y-2">
          <Label>Schedule Type</Label>
          <Select
            value={scheduleType}
            onValueChange={(v) => {
              setScheduleType(v as ScheduleType)
              // Reset extConfigured when switching away from extended types
              if (!isExtendedType(v)) {
                setExtConfigured(false)
              }
            }}
          >
            <option value="one_time">One-time</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option disabled value="">── Extended ──</option>
            <option value="quarterly">Quarterly</option>
            <option value="half_yearly">Half-yearly</option>
            <option value="yearly">Yearly</option>
          </Select>
        </div>

        {scheduleType === 'one_time' && (
          <div className="space-y-2">
            <Label htmlFor="datetime">Date & Time</Label>
            <Input
              id="datetime"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            {errors.scheduledAt && <p className="text-xs text-destructive">{errors.scheduledAt}</p>}
          </div>
        )}

        {(scheduleType === 'daily' || scheduleType === 'weekly') && (
          <div className="space-y-2">
            <Label htmlFor="time">Time</Label>
            <Input
              id="time"
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
            />
          </div>
        )}

        {scheduleType === 'weekly' && (
          <div className="space-y-2">
            <Label>Day of Week</Label>
            <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
              {DAYS.map((day, i) => (
                <option key={i} value={String(i)}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* ── Extended schedule configure button ─────────────── */}
        {isExtendedType(scheduleType) && (
          <div className="space-y-2">
            {extConfigured ? (
              <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Recurrence configured</p>
                  <p className="text-xs text-muted-foreground">{summaryText}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setExtDialogOpen(true)}>
                  Edit
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => setExtDialogOpen(true)}>
                <CalendarDays className="h-4 w-4 mr-2" />
                Configure Recurrence →
              </Button>
            )}
            {errors.extended && <p className="text-xs text-destructive">{errors.extended}</p>}
          </div>
        )}

        {/* ── Dry Run ────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Switch checked={dryRun} onCheckedChange={setDryRun} />
          <Label className="cursor-pointer" onClick={() => setDryRun(!dryRun)}>
            Dry run (don't actually send)
          </Label>
        </div>

        {/* ── Actions ────────────────────────────────────────── */}
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : initial ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>

      {/* Extended schedule dialog — rendered outside the form to avoid nesting issues */}
      {isExtendedType(scheduleType) && (
        <ExtendedScheduleDialog
          open={extDialogOpen}
          scheduleType={scheduleType}
          initialValues={{ timeOfDay, dayOfMonth, monthOfYear }}
          onSave={(values) => {
            setTimeOfDay(values.timeOfDay)
            setDayOfMonth(values.dayOfMonth)
            setMonthOfYear(values.monthOfYear)
            setExtConfigured(true)
            setExtDialogOpen(false)
          }}
          onCancel={() => setExtDialogOpen(false)}
        />
      )}
    </>
  )
}
