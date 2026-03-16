import { useState } from 'react'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { CalendarDays } from 'lucide-react'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

interface ExtendedScheduleDialogProps {
  open: boolean
  scheduleType: 'quarterly' | 'half_yearly' | 'yearly'
  initialValues: { timeOfDay: string; dayOfMonth: number; monthOfYear: number }
  onSave: (values: { timeOfDay: string; dayOfMonth: number; monthOfYear: number }) => void
  onCancel: () => void
}

export function ExtendedScheduleDialog({
  open,
  scheduleType,
  initialValues,
  onSave,
  onCancel
}: ExtendedScheduleDialogProps) {
  const [timeOfDay, setTimeOfDay] = useState(initialValues.timeOfDay)
  const [dayOfMonth, setDayOfMonth] = useState(initialValues.dayOfMonth)
  const [monthOfYear, setMonthOfYear] = useState(initialValues.monthOfYear)

  function buildMonthOptions(): { value: number; label: string }[] {
    if (scheduleType === 'quarterly') {
      // Options 0, 1, 2 — starting month that then repeats every 3 months
      return [
        { value: 0, label: 'Jan (Jan, Apr, Jul, Oct)' },
        { value: 1, label: 'Feb (Feb, May, Aug, Nov)' },
        { value: 2, label: 'Mar (Mar, Jun, Sep, Dec)' }
      ]
    }
    if (scheduleType === 'half_yearly') {
      // Options 0..5 — starting month that then repeats after 6 months
      return [
        { value: 0, label: 'Jan (Jan & Jul)' },
        { value: 1, label: 'Feb (Feb & Aug)' },
        { value: 2, label: 'Mar (Mar & Sep)' },
        { value: 3, label: 'Apr (Apr & Oct)' },
        { value: 4, label: 'May (May & Nov)' },
        { value: 5, label: 'Jun (Jun & Dec)' }
      ]
    }
    // Yearly: all months
    return MONTHS.map((name, i) => ({ value: i, label: name }))
  }

  function buildPreview(): string {
    const day = dayOfMonth
    const time = timeOfDay || '09:00'
    if (scheduleType === 'quarterly') {
      const months = [0, 1, 2, 3].map(i => MONTHS[(monthOfYear + i * 3) % 12])
      return `Fires on the ${day}th of ${months.join(', ')} at ${time}`
    }
    if (scheduleType === 'half_yearly') {
      const m2 = (monthOfYear + 6) % 12
      return `Fires on the ${day}th of ${MONTHS[monthOfYear]} and ${MONTHS[m2]} at ${time}`
    }
    return `Fires on the ${day}th of ${MONTHS[monthOfYear]} every year at ${time}`
  }

  function getMonthLabel(): string {
    if (scheduleType === 'quarterly') return 'Starting Month'
    if (scheduleType === 'half_yearly') return 'Starting Month'
    return 'Month'
  }

  function getTitle(): string {
    if (scheduleType === 'quarterly') return 'Configure Quarterly Recurrence'
    if (scheduleType === 'half_yearly') return 'Configure Half-Yearly Recurrence'
    return 'Configure Yearly Recurrence'
  }

  const monthOptions = buildMonthOptions()

  // Clamp monthOfYear if switching between types caused an out-of-range value
  const safeMonth = monthOptions.some(o => o.value === monthOfYear)
    ? monthOfYear
    : monthOptions[0].value

  function handleSave() {
    onSave({ timeOfDay, dayOfMonth, monthOfYear: safeMonth })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <DialogTitle>{getTitle()}</DialogTitle>
        </div>
      </DialogHeader>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        {/* Month select */}
        <div className="space-y-2">
          <Label htmlFor="ext-month">{getMonthLabel()}</Label>
          <Select
            id="ext-month"
            value={String(safeMonth)}
            onValueChange={(v) => setMonthOfYear(Number(v))}
          >
            {monthOptions.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Day of month */}
        <div className="space-y-2">
          <Label htmlFor="ext-day">Day of Month</Label>
          <Input
            id="ext-day"
            type="number"
            min={1}
            max={28}
            value={dayOfMonth}
            onChange={(e) => {
              const val = Math.max(1, Math.min(28, Number(e.target.value)))
              setDayOfMonth(val)
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            Use 1–28 to ensure the day exists in all months.
          </p>
        </div>

        {/* Time */}
        <div className="space-y-2">
          <Label htmlFor="ext-time">Time</Label>
          <Input
            id="ext-time"
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
          />
        </div>

        {/* Preview */}
        <div className="rounded-md bg-muted/50 px-3 py-2 border">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
            Preview
          </p>
          <p className="text-sm text-foreground">{buildPreview()}</p>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave}>
          Apply
        </Button>
      </div>
    </Dialog>
  )
}
