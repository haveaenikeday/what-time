import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/ipc'
import type { Schedule, CreateScheduleInput, UpdateScheduleInput } from '../../shared/types'

export function useSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getSchedules()
      setSchedules(data)
    } catch (err) {
      console.error('Failed to load schedules:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for execution events to auto-refresh
  useEffect(() => {
    const unsub = api.onScheduleExecuted(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  const create = async (data: CreateScheduleInput): Promise<Schedule> => {
    const schedule = await api.createSchedule(data)
    await refresh()
    return schedule
  }

  const update = async (id: string, data: UpdateScheduleInput): Promise<Schedule> => {
    const schedule = await api.updateSchedule(id, data)
    await refresh()
    return schedule
  }

  const remove = async (id: string): Promise<void> => {
    await api.deleteSchedule(id)
    await refresh()
  }

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    await api.toggleSchedule(id, enabled)
    await refresh()
  }

  const testSend = async (id: string) => {
    const result = await api.testSend(id)
    await refresh()
    return result
  }

  return { schedules, loading, refresh, create, update, remove, toggle, testSend }
}
