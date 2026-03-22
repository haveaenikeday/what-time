import { useState, useEffect } from 'react'
import { Dashboard } from '@/pages/Dashboard'
import { CalendarPage } from '@/pages/Calendar'
import { Logs } from '@/pages/Logs'
import { Settings } from '@/pages/Settings'
import { ToastProvider } from '@/components/ui/toast'
import { ScheduleProvider } from '@/contexts/ScheduleContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/lib/utils'
import { CalendarClock, CalendarDays, ScrollText, Settings as SettingsIcon } from 'lucide-react'
import iconSrc from './assets/icon.png'

function ThemeManager() {
  const { settings } = useSettings()

  useEffect(() => {
    const root = document.documentElement

    function applyTheme(theme: string) {
      if (theme === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }

    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      applyTheme(settings.theme)
    }
  }, [settings.theme])

  return null
}

type Tab = 'dashboard' | 'calendar' | 'logs' | 'settings'

const tabs: { id: Tab; label: string; icon: typeof CalendarClock }[] = [
  { id: 'dashboard', label: 'Schedules', icon: CalendarClock },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'logs', label: 'Activity', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+N → new schedule (switch to dashboard + open modal)
      if (meta && e.key === 'n') {
        e.preventDefault()
        setActiveTab('dashboard')
        window.dispatchEvent(new CustomEvent('app:new-schedule'))
      }

      // Cmd+, → settings
      if (meta && e.key === ',') {
        e.preventDefault()
        setActiveTab('settings')
      }

      // Cmd+1-4 → tab switching
      if (meta && e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        const tabIndex = parseInt(e.key) - 1
        if (tabs[tabIndex]) setActiveTab(tabs[tabIndex].id)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <ErrorBoundary>
    <ToastProvider>
      <ScheduleProvider>
      <ThemeManager />
      <div className="flex h-screen">
        {/* Sidebar */}
        <nav className="w-52 border-r bg-muted/30 pt-4 flex flex-col">
          <div className="px-4 pb-4 border-b border-border/50 mb-2">
            <div className="flex items-center gap-2.5">
              <img src={iconSrc} alt="WhatTime" className="w-8 h-8 rounded-lg" />
              <div>
                <h1 className="text-sm font-semibold text-foreground leading-tight">WhatTime</h1>
                <p className="text-[10px] text-muted-foreground">Local message scheduling</p>
              </div>
            </div>
          </div>
          <div className="space-y-1 px-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 w-full rounded-md py-2 text-sm transition-all duration-150',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary pl-[10px]'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground pl-3'
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'calendar' && <CalendarPage />}
          {activeTab === 'logs' && <Logs />}
          {activeTab === 'settings' && <Settings />}
        </main>
      </div>
      </ScheduleProvider>
    </ToastProvider>
    </ErrorBoundary>
  )
}
