import { useState } from 'react'
import { useSchedules } from '@/hooks/useSchedules'
import { ScheduleModal } from '@/components/ScheduleModal'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Plus, Pencil, Trash2, Play, Copy, CalendarClock } from 'lucide-react'
import { truncate, formatDateTime } from '@/lib/utils'
import type { Schedule, CreateScheduleInput } from '../../shared/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function scheduleLabel(s: Schedule): string {
  if (s.scheduleType === 'one_time') return `Once: ${formatDateTime(s.scheduledAt)}`
  if (s.scheduleType === 'daily') return `Daily at ${s.timeOfDay}`
  if (s.scheduleType === 'weekly') return `Every ${DAYS[s.dayOfWeek ?? 0]} at ${s.timeOfDay}`
  if (s.scheduleType === 'quarterly') {
    const m = s.monthOfYear ?? 0
    const months = [0, 1, 2, 3].map(i => MONTHS_SHORT[(m + i * 3) % 12]).join(', ')
    return `Quarterly (${months}) · ${s.dayOfMonth}th · ${s.timeOfDay}`
  }
  if (s.scheduleType === 'half_yearly') {
    const m = s.monthOfYear ?? 0
    return `Half-yearly (${MONTHS_SHORT[m]} & ${MONTHS_SHORT[(m + 6) % 12]}) · ${s.dayOfMonth}th · ${s.timeOfDay}`
  }
  if (s.scheduleType === 'yearly') {
    return `Yearly (${MONTHS_SHORT[s.monthOfYear ?? 0]} ${s.dayOfMonth}) · ${s.timeOfDay}`
  }
  return s.scheduleType
}

export function Dashboard() {
  const { schedules, loading, create, update, remove, toggle, testSend } = useSchedules()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  function handleNew() {
    setEditing(null)
    setModalOpen(true)
  }

  function handleEdit(s: Schedule) {
    setEditing(s)
    setModalOpen(true)
  }

  async function handleDuplicate(s: Schedule) {
    await create({
      phoneNumber: s.phoneNumber,
      contactName: s.contactName,
      message: s.message,
      scheduleType: s.scheduleType,
      scheduledAt: s.scheduledAt || undefined,
      timeOfDay: s.timeOfDay || undefined,
      dayOfWeek: s.dayOfWeek ?? undefined,
      dayOfMonth: s.dayOfMonth ?? undefined,
      monthOfYear: s.monthOfYear ?? undefined,
      dryRun: s.dryRun
    })
  }

  async function handleDelete(id: string) {
    await remove(id)
    setConfirmDelete(null)
  }

  async function handleTestSend(id: string) {
    setTestResult(null)
    const result = await testSend(id)
    if (result) {
      if (result.success) {
        setTestResult(result.dryRun ? 'Dry run completed' : 'Message sent')
      } else {
        setTestResult(`Failed: ${result.error || 'Unknown error'}`)
      }
    }
    setTimeout(() => setTestResult(null), 4000)
  }

  async function handleSubmit(data: CreateScheduleInput) {
    if (editing) {
      await update(editing.id, data)
    } else {
      await create(data)
    }
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading schedules...</div>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Scheduled Messages</h1>
        <Button onClick={handleNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Schedule
        </Button>
      </div>

      {/* Toast for test results */}
      {testResult && (
        <div className="rounded-md border bg-card px-4 py-2 text-sm shadow-sm">
          {testResult}
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="text-center py-20 space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-2">
            <CalendarClock className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-base font-medium">No schedules yet</p>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Create your first scheduled WhatsApp message to get started.
          </p>
          <Button onClick={handleNew} size="sm" className="mt-2">
            <Plus className="h-4 w-4 mr-1" />
            New Schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              {/* Toggle */}
              <Switch
                checked={s.enabled}
                onCheckedChange={(enabled) => toggle(s.id, enabled)}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">
                    {s.contactName || s.phoneNumber}
                  </span>
                  {s.contactName && (
                    <span className="text-xs text-muted-foreground">{s.phoneNumber}</span>
                  )}
                  <StatusBadge
                    status={
                      s.scheduleType === 'one_time' && !s.enabled
                        ? 'completed'
                        : s.enabled
                          ? 'active'
                          : 'paused'
                    }
                  />
                  {s.dryRun && <StatusBadge status="dry_run" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {truncate(s.message, 80)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {scheduleLabel(s)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Test Send"
                  onClick={() => handleTestSend(s.id)}
                >
                  <Play className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit"
                  onClick={() => handleEdit(s)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Duplicate"
                  onClick={() => handleDuplicate(s)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {confirmDelete === s.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(s.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    onClick={() => setConfirmDelete(s.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ScheduleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        schedule={editing}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
