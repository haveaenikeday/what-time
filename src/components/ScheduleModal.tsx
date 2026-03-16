import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScheduleForm } from '@/components/ScheduleForm'
import type { Schedule, CreateScheduleInput } from '../../shared/types'

interface ScheduleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule?: Schedule | null
  onSubmit: (data: CreateScheduleInput) => Promise<void>
}

export function ScheduleModal({ open, onOpenChange, schedule, onSubmit }: ScheduleModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{schedule ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
      </DialogHeader>
      <ScheduleForm
        initial={schedule}
        onSubmit={async (data) => {
          await onSubmit(data)
          onOpenChange(false)
        }}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  )
}
