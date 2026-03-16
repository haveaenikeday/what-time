import { useState } from 'react'
import { useLogs } from '@/hooks/useLogs'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatDateTime, truncate } from '@/lib/utils'
import { Trash2 } from 'lucide-react'
import type { RunStatus } from '../../shared/types'

export function Logs() {
  const { logs, loading, clearLogs } = useLogs()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [confirmClear, setConfirmClear] = useState(false)

  const filtered = statusFilter === 'all'
    ? logs
    : logs.filter((l) => l.status === statusFilter)

  async function handleClear() {
    await clearLogs()
    setConfirmClear(false)
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading logs...</div>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activity Log</h1>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            className="w-32"
          >
            <option value="all">All</option>
            <option value="success">Sent</option>
            <option value="failed">Failed</option>
            <option value="dry_run">Dry Run</option>
            <option value="skipped">Skipped</option>
          </Select>
          {confirmClear ? (
            <div className="flex gap-1">
              <Button variant="destructive" size="sm" onClick={handleClear}>
                Confirm Clear
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={logs.length === 0}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p>No log entries yet.</p>
          <p className="text-sm mt-1">Activity will appear here after schedules run.</p>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[140px_1fr_100px_60px_1fr] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
            <span>Time</span>
            <span>Contact</span>
            <span>Message</span>
            <span>Status</span>
            <span>Error</span>
          </div>
          {filtered.map((log) => (
            <div
              key={log.id}
              className="grid grid-cols-[140px_1fr_100px_60px_1fr] gap-2 px-3 py-2 text-sm border-b border-border/50 items-center"
            >
              <span className="text-xs text-muted-foreground">
                {formatDateTime(log.firedAt)}
              </span>
              <span className="truncate">
                {log.contactName || log.phoneNumber || log.scheduleId.slice(0, 8)}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {truncate(log.messagePreview || '', 30)}
              </span>
              <StatusBadge status={log.status} />
              <span className="text-xs text-destructive truncate">
                {log.errorMessage || ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
