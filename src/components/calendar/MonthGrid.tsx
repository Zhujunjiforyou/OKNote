import { memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  format,
  parseISO,
} from 'date-fns'
import { DayCell } from './DayCell'
import { getAdjustedWorkday, getHoliday } from '@/lib/holidays'
import type { CalendarEvent } from '@/types/calendar.types'
import { buildDailyTodoItemsByDate, buildEventsByDate, compareCalendarEventStart, getEventInstanceKey, isEventCompleted, legacyCompletedEventKeys, type CalendarTodoPreview } from '@/lib/utils'

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const EMPTY_TODOS: CalendarTodoPreview[] = []

interface MonthGridProps {
  compact?: boolean
  viewMode?: 'month' | 'week'
  cellBorderColor?: string
  holidayStripeColor?: string
  holidayTextColor?: string
  eventTextColor?: string
  onDayDoubleClick?: () => void
  todayKey?: string
}

export const MonthGrid = memo(function MonthGrid({ compact = false, viewMode = 'month', cellBorderColor, holidayStripeColor, holidayTextColor, eventTextColor, onDayDoubleClick, todayKey }: MonthGridProps) {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const events = useCalendarStore((s) => s.events)
  const notes = useNotesStore(useShallow((s) => s.notes.filter((note) =>
    note.items.some((item) => !!item.todoDate) || !!note.dailyTodo?.completedEventOccurrences?.length)))
  const completionKey = JSON.stringify([...legacyCompletedEventKeys(notes)].sort())
  const completedKeys = useMemo<ReadonlySet<string>>(() => new Set(JSON.parse(completionKey)), [completionKey])
  const periodStart = format(viewMode === 'week' ? startOfWeek(currentDate, { weekStartsOn: 1 }) : startOfMonth(currentDate), 'yyyy-MM-dd')

  const days = useMemo(() => {
    const periodDate = parseISO(periodStart)
    if (viewMode === 'week') {
      return eachDayOfInterval({ start: periodDate, end: endOfWeek(periodDate, { weekStartsOn: 1 }) })
    }
    const monthEnd = endOfMonth(periodDate)
    const calStart = startOfWeek(periodDate, { weekStartsOn: 1 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [periodStart, viewMode])

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

  const dailyTodoSummary = useMemo(() => {
    const itemsByDate = buildDailyTodoItemsByDate(notes, rangeStart, rangeEnd, true)
    const counts = new Map<string, number>()
    for (const [dateStr, items] of itemsByDate) counts.set(dateStr, items.filter((item) => !item.isCompleted).length)
    if (!rangeStart || !rangeEnd) return { itemsByDate, counts }
    for (const [dateStr, dateEvents] of eventsByDate) {
      const pendingEventKeys = new Set(
        dateEvents
          .filter((event) => !isEventCompleted(event, completedKeys))
          .map(getEventInstanceKey),
      )
      if (pendingEventKeys.size > 0) {
        counts.set(dateStr, (counts.get(dateStr) || 0) + pendingEventKeys.size)
      }
    }
    return { itemsByDate, counts }
  }, [eventsByDate, notes, rangeStart, rangeEnd, completedKeys])

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
  const weekCells = useMemo(() => weeks.map((week, wi) => {
    const rowMap = weekEventRows[wi] || {}
    return week.map((day) => {
      const dateStr = format(day, 'yyyy-MM-dd')
      const sorted = [...(eventsByDate.get(dateStr) || [])].sort((a, b) => {
        const aMulti = !!(a.endDate && a.endDate !== a.startDate)
        const bMulti = !!(b.endDate && b.endDate !== b.startDate)
        if (aMulti && !bMulti) return -1
        if (!aMulti && bMulti) return 1
        if (aMulti && bMulti) {
          const rowCompare = (rowMap[getEventInstanceKey(a)] ?? 99) - (rowMap[getEventInstanceKey(b)] ?? 99)
          if (rowCompare !== 0) return rowCompare
        }
        return compareCalendarEventStart(a, b)
      })
      return {
        day,
        dateStr,
        events: sorted,
        onClick: () => useCalendarStore.getState().setCurrentDate(day),
        onDoubleClick: () => {
          useCalendarStore.getState().setCurrentDate(day)
          onDayDoubleClick?.()
        },
        onRightClick: (event: React.MouseEvent) => {
          event.preventDefault()
          useCalendarStore.getState().setCurrentDate(day)
        },
      }
    })
  }), [weeks, weekEventRows, eventsByDate, onDayDoubleClick])
  const weekdayLabels = WEEKDAY_LABELS

  return (
    <div
      className={`month-grid ${compact ? 'flex flex-col h-full' : 'flex flex-col h-full p-3'}`}
      role="grid"
      aria-label={viewMode === 'week' ? '周日历' : '月日历'}
    >
      {/* Day headers */}
      <div className="grid grid-cols-7 shrink-0 mb-0.5" role="row">
        {weekdayLabels.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[0.78em] font-semibold tracking-wide ${
              compact ? 'py-0.5' : 'py-1.5'
            } ${
              i >= 5 ? 'opacity-55' : 'opacity-75'
            }`}
            role="columnheader"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid - fills remaining height */}
      <div
        className="month-grid-body grid grid-cols-7 flex-1 auto-rows-fr overflow-hidden rounded-md border"
        style={{ borderColor: cellBorderColor || 'rgba(255,255,255,0.15)' }}
        role="rowgroup"
      >
        {weekCells.map((week, wi) => {
          return (
            <div key={wi} role="row" className="contents">
              {week.map((cell, di) => {
                const { day, dateStr } = cell
                return (
                  <DayCell
                    completedKeys={completedKeys}
                    todayKey={todayKey}
                    key={`${wi}-${di}`}
                    day={day}
                    dateStr={dateStr}
                    events={cell.events}
                    dailyTodos={dailyTodoSummary.itemsByDate.get(dateStr) || EMPTY_TODOS}
                    dailyTodoCount={dailyTodoSummary.counts.get(dateStr) || 0}
                    isCurrentMonth={viewMode === 'week' ? true : isSameMonth(day, currentDate)}
                    isToday={dateStr === todayKey}
                    compact={compact}
                    cellBorderColor={cellBorderColor}
                    holiday={getHoliday(dateStr)}
                    adjustedWorkday={getAdjustedWorkday(dateStr)}
                    showHolidayLabel={viewMode === 'week' && wi === 0 && di === 0}
                    holidayStripeColor={holidayStripeColor}
                    holidayTextColor={holidayTextColor}
                    eventTextColor={eventTextColor}
                    onClick={cell.onClick}
                    onDoubleClick={cell.onDoubleClick}
                    onRightClick={cell.onRightClick}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
})
