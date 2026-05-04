import { useMemo } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  format,
} from 'date-fns'
import { DayCell } from './DayCell'
import { getHoliday } from '@/lib/holidays'
import type { CalendarEvent } from '@/types/calendar.types'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

interface MonthGridProps {
  compact?: boolean
  cellBorderColor?: string
  holidayStripeColor?: string
  holidayTextColor?: string
  onDayDoubleClick?: () => void
}

export function MonthGrid({ compact = false, cellBorderColor, holidayStripeColor, holidayTextColor, onDayDoubleClick }: MonthGridProps) {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const events = useCalendarStore((s) => s.events)
  const openEventForm = useCalendarStore((s) => s.openEventForm)

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentDate])

  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7))
    }
    return result
  }, [days])

  // Precompute event lookup by date string for O(1) access
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      if (!e.endDate || e.endDate === e.startDate) {
        const arr = map.get(e.startDate) || []
        arr.push(e)
        map.set(e.startDate, arr)
      }
    }
    return map
  }, [events])

  // For each week, assign consistent row positions to multi-day events
  const weekEventRows = useMemo(() => {
    const result: Array<Record<string, number>> = []
    for (const week of weeks) {
      const rowMap: Record<string, number> = {}
      const multiDayEvents: Array<{ id: string; startDate: string; endDate: string }> = []

      week.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd')
        for (const e of events) {
          const hasRange = e.endDate && e.endDate !== e.startDate
          if (hasRange && dateStr >= e.startDate && dateStr <= e.endDate!) {
            if (!multiDayEvents.find((m) => m.id === e.id)) {
              multiDayEvents.push({ id: e.id, startDate: e.startDate, endDate: e.endDate! })
            }
          }
        }
      })

      multiDayEvents.sort((a, b) => a.startDate.localeCompare(b.startDate))
      multiDayEvents.forEach((ev, idx) => {
        rowMap[ev.id] = idx
      })
      result.push(rowMap)
    }
    return result
  }, [weeks, events])

  return (
    <div className={compact ? 'flex flex-col h-full' : 'flex flex-col h-full p-3'}>
      {/* Day headers */}
      <div className="grid grid-cols-7 shrink-0 mb-0.5">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[0.7em] font-semibold tracking-wide ${
              compact ? 'py-0.5' : 'py-1.5'
            } ${
              i >= 5 ? 'opacity-40' : 'opacity-60'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid - fills remaining height */}
      <div
        className="grid grid-cols-7 flex-1 auto-rows-fr overflow-hidden rounded-md border"
        style={{ borderColor: cellBorderColor || 'rgba(255,255,255,0.15)' }}
      >
        {weeks.map((week, wi) => {
          const rowMap = weekEventRows[wi] || {}

          return week.map((day, di) => {
            const dateStr = format(day, 'yyyy-MM-dd')

            // Get single-day events from precomputed lookup
            const singleDayEvents = eventsByDate.get(dateStr) || []

            // Get multi-day events spanning this date
            const multiDayEvents = events.filter((e) => {
              const hasRange = e.endDate && e.endDate !== e.startDate
              return hasRange && dateStr >= e.startDate && dateStr <= e.endDate!
            })

            // Combine: multi-day events first (by assigned row), then single-day
            const sorted = [
              ...multiDayEvents,
              ...singleDayEvents,
            ].sort((a, b) => {
              const aMulti = !!(a.endDate && a.endDate !== a.startDate)
              const bMulti = !!(b.endDate && b.endDate !== b.startDate)
              if (aMulti && !bMulti) return -1
              if (!aMulti && bMulti) return 1
              if (aMulti && bMulti) {
                return (rowMap[a.id] ?? 99) - (rowMap[b.id] ?? 99)
              }
              return 0
            })

            return (
              <DayCell
                key={`${wi}-${di}`}
                day={day}
                dateStr={dateStr}
                events={sorted}
                eventRows={rowMap}
                isCurrentMonth={isSameMonth(day, currentDate)}
                isToday={isToday(day)}
                compact={compact}
                cellBorderColor={cellBorderColor}
                holiday={getHoliday(dateStr)}
                holidayStripeColor={holidayStripeColor}
                holidayTextColor={holidayTextColor}
                onClick={() => {
                  useCalendarStore.getState().setCurrentDate(day)
                }}
                onDoubleClick={() => {
                  useCalendarStore.getState().setCurrentDate(day)
                  onDayDoubleClick?.()
                }}
                onRightClick={(e) => {
                  e.preventDefault()
                  useCalendarStore.getState().setCurrentDate(day)
                }}
              />
            )
          })
        })}
      </div>
    </div>
  )
}
