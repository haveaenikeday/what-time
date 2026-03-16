import { Badge } from '@/components/ui/badge'
import type { RunStatus } from '../../shared/types'

const statusConfig: Record<RunStatus | 'active' | 'paused' | 'completed', {
  label: string
  variant: 'success' | 'destructive' | 'warning' | 'info' | 'secondary' | 'default'
}> = {
  success: { label: 'Sent', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  dry_run: { label: 'Dry Run', variant: 'info' },
  skipped: { label: 'Skipped', variant: 'warning' },
  active: { label: 'Active', variant: 'success' },
  paused: { label: 'Paused', variant: 'secondary' },
  completed: { label: 'Done', variant: 'secondary' }
}

interface StatusBadgeProps {
  status: RunStatus | 'active' | 'paused' | 'completed'
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: 'secondary' as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
