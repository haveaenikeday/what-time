import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/ipc'
import type { AppSettings } from '../../shared/types'

const defaultSettings: AppSettings = {
  globalDryRun: false,
  defaultCountryCode: '+1',
  sendDelayMs: 3000,
  whatsappApp: 'WhatsApp'
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getSettings()
      setSettings(data)
    } catch (err) {
      console.error('Failed to load settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const updateSetting = async (key: string, value: string): Promise<void> => {
    await api.updateSetting(key, value)
    await refresh()
  }

  return { settings, loading, refresh, updateSetting }
}
