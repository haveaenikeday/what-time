import { useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface TimePickerProps {
  value: string // "HH:mm" in 24h format
  onChange: (time: string) => void
  className?: string
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const PERIODS = ['AM', 'PM'] as const

function to12h(hour24: number): { hour: number; period: 'AM' | 'PM' } {
  if (hour24 === 0) return { hour: 12, period: 'AM' }
  if (hour24 === 12) return { hour: 12, period: 'PM' }
  if (hour24 > 12) return { hour: hour24 - 12, period: 'PM' }
  return { hour: hour24, period: 'AM' }
}

function to24h(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12
  return hour12 === 12 ? 12 : hour12 + 12
}

function parseTime(hhmm: string): { hour: number; minute: number; period: 'AM' | 'PM' } {
  const [h, m] = hhmm.split(':').map(Number)
  const { hour, period } = to12h(h || 0)
  return { hour, minute: m || 0, period }
}

function formatTime(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const h24 = to24h(hour12, period)
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// 3D drum constants — sized to match h-9 (36px) date button
const VISIBLE_ITEMS = 3
const ITEM_ANGLE = 30 // degrees between items on the drum
const DRUM_RADIUS = 16 // px — radius of the cylinder
const ITEM_HEIGHT = 20

function DrumColumn({
  items,
  selectedIndex,
  onSelect,
  formatItem,
  width,
}: {
  items: readonly (string | number)[]
  selectedIndex: number
  onSelect: (index: number) => void
  formatItem?: (val: string | number) => string
  width?: string
}) {
  const lastWheelTime = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Attach the wheel listener manually with { passive: false } so we can call
  // preventDefault() to stop the surrounding dialog from scrolling while the
  // user wheels the drum. React's onWheel prop is registered as passive by
  // default in modern Chromium and emits a console-spamming warning on every
  // tick if preventDefault is called.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelTime.current < 60) return
      lastWheelTime.current = now

      const direction = e.deltaY > 0 ? 1 : -1
      const next = Math.max(0, Math.min(items.length - 1, selectedIndex + direction))
      if (next !== selectedIndex) onSelect(next)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [items.length, selectedIndex, onSelect])

  // Compute visible range centered on selected
  const visibleItems = useMemo(() => {
    const half = Math.floor(VISIBLE_ITEMS / 2)
    const result: { index: number; offset: number }[] = []
    for (let offset = -half; offset <= half; offset++) {
      const idx = selectedIndex + offset
      if (idx >= 0 && idx < items.length) {
        result.push({ index: idx, offset })
      }
    }
    return result
  }, [selectedIndex, items.length])

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden', width || 'flex-1')}
      style={{ height: DRUM_RADIUS * 2 + ITEM_HEIGHT, perspective: '200px' }}
    >
      {/* Selection band */}
      <div
        className="absolute left-0 right-0 pointer-events-none border-y border-primary/25 bg-primary/8 z-10"
        style={{
          top: DRUM_RADIUS,
          height: ITEM_HEIGHT,
        }}
      />

      {/* Drum cylinder */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: DRUM_RADIUS,
          height: ITEM_HEIGHT,
          transformStyle: 'preserve-3d',
        }}
      >
        {visibleItems.map(({ index, offset }) => {
          const angle = offset * ITEM_ANGLE
          const absOffset = Math.abs(offset)
          const opacity = absOffset === 0 ? 1 : absOffset === 1 ? 0.6 : 0.3
          const scale = absOffset === 0 ? 1 : absOffset === 1 ? 0.9 : 0.8

          return (
            <button
              key={items[index]}
              type="button"
              onClick={() => onSelect(index)}
              className={cn(
                'absolute left-0 right-0 flex items-center justify-center font-medium transition-all duration-150',
                offset === 0 ? 'text-primary text-xs font-semibold' : 'text-muted-foreground text-[10px]'
              )}
              style={{
                height: ITEM_HEIGHT,
                transform: `rotateX(${-angle}deg) translateZ(${DRUM_RADIUS}px) scale(${scale})`,
                opacity,
                backfaceVisibility: 'hidden',
              }}
            >
              {formatItem ? formatItem(items[index]) : String(items[index])}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const { hour, minute, period } = parseTime(value)

  const hourIndex = HOURS.indexOf(hour)
  const minuteIndex = minute
  const periodIndex = period === 'AM' ? 0 : 1

  return (
    <div className={cn('flex rounded-xl border overflow-hidden bg-background', className)}>
      <DrumColumn
        items={HOURS}
        selectedIndex={hourIndex}
        onSelect={(i) => onChange(formatTime(HOURS[i], minute, period))}
      />
      <div className="w-px bg-border" />
      <DrumColumn
        items={MINUTES}
        selectedIndex={minuteIndex}
        onSelect={(i) => onChange(formatTime(hour, MINUTES[i], period))}
        formatItem={(v) => String(v).padStart(2, '0')}
      />
      <div className="w-px bg-border" />
      <DrumColumn
        items={PERIODS}
        selectedIndex={periodIndex}
        onSelect={(i) => onChange(formatTime(hour, minute, PERIODS[i]))}
        width="w-14"
      />
    </div>
  )
}
