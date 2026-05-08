import { useMemo } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
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
import { buildEventsByDate, getEventInstanceKey } from '@/lib/utils'

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface MonthGridProps {
  compact?: boolean
  viewMode?: 'month' | 'week'
  cellBorderColor?: string
  holidayStripeColor?: string
  holidayTextColor?: string
  eventTextColor?: string
  onDayDoubleClick?: () => void
}

export function MonthGrid({ compact = false, viewMode = 'month', cellBorderColor, holidayStripeColor, holidayTextColor, eventTextColor, onDayDoubleClick }: MonthGridProps) {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const events = useCalendarStore((s) => s.events)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const notes = useNotesStore((s) => s.notes)

  const days = useMemo(() => {
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
      return eachDayOfInterval({ start: weekStart, end: weekEnd })
    }
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentDate, viewMode])

  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7))
    }
    return result
  }, [days])

  const rangeStart = days.length > 0 ? format(days[0], 'yyyy-MM-dd') : ''
  const rangeEnd = days.length > 0 ? format(days[days.length - 1], 'yyyy-MM-dd') : ''

  // Expand recurring events only inside the visible grid and index by date.
  const eventsByDate = useMemo(() => {
    if (!rangeStart || !rangeEnd) return new Map<string, CalendarEvent[]>()
    return buildEventsByDate(events, rangeStart, rangeEnd)
  }, [events, rangeStart, rangeEnd])

  const dailyTodoCounts = useMemo(() => {
    const map = new Map<string, number>()
    if (!rangeStart || !rangeEnd) return map
    for (const note of notes) {
      if (note.noteType !== 'daily') continue
      for (const item of note.items || []) {
        if (!item.todoDate || item.isCompleted) continue
        if (item.todoDate < rangeStart || item.todoDate > rangeEnd) continue
        map.set(item.todoDate, (map.get(item.todoDate) || 0) + 1)
      }
    }
    return map
  }, [notes, rangeStart, rangeEnd])

  // For each week, assign consistent row positions to multi-day events
  const weekEventRows = useMemo(() => {
    const result: Array<Record<string, number>> = []
    for (const week of weeks) {
      const rowMap: Record<string, number> = {}
      const multiDayEvents: Array<{ id: string; startDate: string; endDate: string }> = []

      week.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd')
        for (const e of eventsByDate.get(dateStr) || []) {
          const hasRange = e.endDate && e.endDate !== e.startDate
          if (hasRange) {
            const key = getEventInstanceKey(e)
            if (!multiDayEvents.find((m) => m.id === key)) {
              multiDayEvents.push({ id: key, startDate: e.startDate, endDate: e.endDate! })
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
  }, [weeks, eventsByDate])
  const weekdayLabels = WEEKDAY_LABELS

  return (
    <div className={compact ? 'flex flex-col h-full' : 'flex flex-col h-full p-3'}>
      {/* Day headers */}
      <div className="grid grid-cols-7 shrink-0 mb-0.5">
        {weekdayLabels.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[0.7em] font-semibold tracking-wide ${
              compact ? 'py-0.5' : 'py-1.5'
            } ${
              i >= 5 ? 'opacity-55' : 'opacity-75'
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

            const sorted = [...(eventsByDate.get(dateStr) || [])].sort((a, b) => {
              const aMulti = !!(a.endDate && a.endDate !== a.startDate)
              const bMulti = !!(b.endDate && b.endDate !== b.startDate)
              if (aMulti && !bMulti) return -1
              if (!aMulti && bMulti) return 1
              if (aMulti && bMulti) {
                return (rowMap[getEventInstanceKey(a)] ?? 99) - (rowMap[getEventInstanceKey(b)] ?? 99)
              }
              return 0
            })

            return (
              <DayCell
                key={`${wi}-${di}`}
                day={day}
                dateStr={dateStr}
                events={sorted}
                dailyTodoCount={dailyTodoCounts.get(dateStr) || 0}
                eventRows={rowMap}
                isCurrentMonth={viewMode === 'week' ? true : isSameMonth(day, currentDate)}
                isToday={isToday(day)}
                compact={compact}
                cellBorderColor={cellBorderColor}
                holiday={getHoliday(dateStr)}
                showHolidayLabel={viewMode === 'week' && wi === 0 && di === 0}
                holidayStripeColor={holidayStripeColor}
                holidayTextColor={holidayTextColor}
                eventTextColor={eventTextColor}
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
