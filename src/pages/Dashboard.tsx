import { useState, useMemo, useEffect } from 'react'
import { useScheduleContext } from '@/contexts/ScheduleContext'
import { useToast } from '@/components/ui/toast'
import { ScheduleModal } from '@/components/ScheduleModal'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Plus, Pencil, Trash2, Play, Copy, CalendarClock, Clock, Search } from 'lucide-react'
import { truncate, formatDateTime, formatRelativeTime, getTimelineBucket, BUCKET_LABELS, type TimelineBucket } from '@/lib/utils'
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

function SkeletonCard() {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4 animate-pulse">
      <div className="h-5 w-9 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-36 rounded bg-muted" />
        <div className="h-3 w-52 rounded bg-muted" />
        <div className="h-3 w-28 rounded bg-muted" />
      </div>
      <div className="flex gap-1">
        <div className="h-8 w-8 rounded bg-muted" />
        <div className="h-8 w-8 rounded bg-muted" />
      </div>
    </div>
  )
}

const BUCKET_ORDER: TimelineBucket[] = ['upcoming', 'quarterly', 'half_yearly', 'yearly', 'beyond']

export function Dashboard() {
  const { schedules, fireTimes, loading, create, update, remove, toggle, testSend } = useScheduleContext()
  const { toast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmTestSend, setConfirmTestSend] = useState<string | null>(null)

  // Listen for Cmd+N from App.tsx
  useEffect(() => {
    const handler = () => handleNew()
    window.addEventListener('app:new-schedule', handler)
    return () => window.removeEventListener('app:new-schedule', handler)
  }, [])

  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'next_fire' | 'contact_az' | 'created' | 'updated'>('next_fire')

  // Filter schedules by search query
  const filteredSchedules = useMemo(() => {
    if (!searchQuery.trim()) return schedules
    const q = searchQuery.toLowerCase()
    return schedules.filter(
      (s) =>
        s.contactName.toLowerCase().includes(q) ||
        s.phoneNumber.toLowerCase().includes(q) ||
        s.message.toLowerCase().includes(q)
    )
  }, [schedules, searchQuery])

  // Sort helper
  const sortSchedules = (items: Schedule[]): Schedule[] => {
    return [...items].sort((a, b) => {
      if (sortBy === 'contact_az') {
        const nameA = (a.contactName || a.phoneNumber).toLowerCase()
        const nameB = (b.contactName || b.phoneNumber).toLowerCase()
        return nameA.localeCompare(nameB)
      }
      if (sortBy === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sortBy === 'updated') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      // default: next_fire (soonest first)
      const nextA = a.scheduleType === 'one_time' ? a.scheduledAt : fireTimes[a.id]
      const nextB = b.scheduleType === 'one_time' ? b.scheduledAt : fireTimes[b.id]
      if (!nextA && !nextB) return 0
      if (!nextA) return 1
      if (!nextB) return -1
      return new Date(nextA).getTime() - new Date(nextB).getTime()
    })
  }

  // Group schedules by time horizon
  const { grouped, pausedSchedules } = useMemo(() => {
    const buckets: Record<TimelineBucket, Schedule[]> = {
      upcoming: [], quarterly: [], half_yearly: [], yearly: [], beyond: []
    }
    const paused: Schedule[] = []

    for (const s of filteredSchedules) {
      if (!s.enabled) {
        paused.push(s)
        continue
      }
      const nextRun = s.scheduleType === 'one_time' ? s.scheduledAt : (fireTimes[s.id] || null)
      const bucket = getTimelineBucket(nextRun)
      buckets[bucket].push(s)
    }

    const result = BUCKET_ORDER
      .filter((key) => buckets[key].length > 0)
      .map((key) => ({ key, label: BUCKET_LABELS[key], items: sortSchedules(buckets[key]) }))

    return { grouped: result, pausedSchedules: sortSchedules(paused) }
  }, [filteredSchedules, fireTimes, sortBy])

  function getNextRun(s: Schedule): string | null {
    if (s.scheduleType === 'one_time') return s.scheduledAt
    return fireTimes[s.id] || null
  }

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
    toast('Schedule duplicated', 'success')
  }

  async function handleDelete(id: string) {
    await remove(id)
    setConfirmDelete(null)
    toast('Schedule deleted', 'info')
  }

  async function handleTestSend(s: Schedule) {
    // If not dry run, require confirmation first
    if (!s.dryRun && confirmTestSend !== s.id) {
      setConfirmTestSend(s.id)
      return
    }
    setConfirmTestSend(null)
    const result = await testSend(s.id)
    if (result) {
      if (result.success) {
        toast(result.dryRun ? 'Dry run completed' : 'Message sent', 'success')
      } else {
        toast(`Failed: ${result.error || 'Unknown error'}`, 'error')
      }
    }
  }

  async function handleSubmit(data: CreateScheduleInput) {
    if (editing) {
      await update(editing.id, data)
      toast('Schedule updated', 'success')
    } else {
      await create(data)
      toast('Schedule created', 'success')
    }
  }

  function renderScheduleCard(s: Schedule) {
    const nextRun = getNextRun(s)
    return (
      <div
        key={s.id}
        className="flex items-center gap-4 rounded-lg border bg-card p-4 card-hover"
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
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-muted-foreground">
              {scheduleLabel(s)}
            </p>
            {nextRun && s.enabled && (
              <span className="flex items-center gap-1 text-xs text-primary font-medium">
                <Clock className="h-3 w-3" />
                Next: {formatRelativeTime(nextRun)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {confirmTestSend === s.id ? (
            <div className="flex items-center gap-1">
              <Button
                variant="default"
                size="sm"
                onClick={() => handleTestSend(s)}
              >
                Send Now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmTestSend(null)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              title={s.dryRun ? 'Test Send (Dry Run)' : 'Test Send (Live!)'}
              onClick={() => handleTestSend(s)}
              className="transition-colors duration-150"
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            title="Edit"
            onClick={() => handleEdit(s)}
            className="transition-colors duration-150"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Duplicate"
            onClick={() => handleDuplicate(s)}
            className="transition-colors duration-150"
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
              className="transition-colors duration-150"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-7 w-48 rounded bg-muted animate-pulse" />
          <div className="h-9 w-32 rounded bg-muted animate-pulse" />
        </div>
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Scheduled Messages</h1>
        <Button onClick={handleNew} size="sm" className="transition-all duration-150 hover:shadow-sm">
          <Plus className="h-4 w-4 mr-1" />
          New Schedule
        </Button>
      </div>

      {/* Search + Sort bar */}
      {schedules.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by contact, phone, or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as typeof sortBy)}
            className="w-44 h-8 text-sm"
          >
            <option value="next_fire">Next fire (soonest)</option>
            <option value="contact_az">Contact A–Z</option>
            <option value="created">Recently created</option>
            <option value="updated">Recently updated</option>
          </Select>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
            <CalendarClock className="h-8 w-8 text-primary" />
          </div>
          <p className="text-lg font-medium">No schedules yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Create your first scheduled WhatsApp message to get started. Messages will be sent automatically at the time you choose.
          </p>
          <Button onClick={handleNew} size="sm" className="mt-2 transition-all duration-150 hover:shadow-sm">
            <Plus className="h-4 w-4 mr-1" />
            New Schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* No results for search */}
          {filteredSchedules.length === 0 && searchQuery.trim() && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No schedules match "{searchQuery}"</p>
            </div>
          )}

          {/* Grouped active schedules */}
          {grouped.map(({ key, label, items }) => (
            <div key={key}>
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 border-b mb-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {label} <span className="text-xs ml-1 opacity-60">({items.length})</span>
                </h2>
              </div>
              <div className="space-y-2">
                {items.map(renderScheduleCard)}
              </div>
            </div>
          ))}

          {/* Paused schedules */}
          {pausedSchedules.length > 0 && (
            <div>
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 border-b mb-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Paused <span className="text-xs ml-1 opacity-60">({pausedSchedules.length})</span>
                </h2>
              </div>
              <div className="space-y-2">
                {pausedSchedules.map(renderScheduleCard)}
              </div>
            </div>
          )}
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
