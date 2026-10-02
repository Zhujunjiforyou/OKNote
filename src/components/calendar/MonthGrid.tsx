import { memo, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import {
  addDays,
  eachDayOfInterval,
  isSameMonth,
  format,
} from 'date-fns'
import { DayCell } from './DayCell'
import { getAdjustedWorkday, getHoliday } from '@/lib/holidays'
import type { CalendarEvent } from '@/types/calendar.types'
import { buildDailyTodoItemsByDate, buildEventsByDate, compareCalendarEventStart, getEventInstanceKey, isEventCompleted, legacyCompletedEventKeys, type CalendarTodoPreview } from '@/lib/utils'
import { CALENDAR_WEEK_COUNT, calendarWeekDate, calendarWeekIndex } from '@/lib/calendar-viewport'
import { useCalendarViewport } from '@/hooks/useCalendarViewport'

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
  blocked?: boolean
}

export const MonthGrid = memo(function MonthGrid({ compact = false, viewMode = 'month', cellBorderColor, holidayStripeColor, holidayTextColor, eventTextColor, onDayDoubleClick, todayKey, blocked = false }: MonthGridProps) {
  const browseDate = useCalendarStore((s) => s.browseDate)
  const [menuOpen, setMenuOpen] = useState(false)
  const scrollPositions = useRef(new Map<string, number>())
  const { rootRef, viewportRef, spaceRef, range } = useCalendarViewport(viewMode, blocked || menuOpen)
  const events = useCalendarStore((s) => s.events)
  const notes = useNotesStore(useShallow((s) => s.notes.filter((note) =>
    note.items.some((item) => !!item.todoDate) || !!note.dailyTodo?.completedEventOccurrences?.length)))
  const completionKey = JSON.stringify([...legacyCompletedEventKeys(notes)].sort())
  const completedKeys = useMemo<ReadonlySet<string>>(() => new Set(JSON.parse(completionKey)), [completionKey])
  const days = useMemo(() => {
    return eachDayOfInterval({ start: calendarWeekDate(range.first), end: addDays(calendarWeekDate(range.end), -1) })
  }, [range.first, range.end])

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
      ref={rootRef}
      className={`month-grid flex flex-col h-full min-h-0 ${compact ? '' : 'p-3'}`}
      style={{ ['--calendar-week-height' as string]: '100px' }}
      role="grid"
      aria-rowcount={CALENDAR_WEEK_COUNT + 1}
      aria-colcount={7}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return
        event.preventDefault()
        const viewport = viewportRef.current!
        const height = Number.parseFloat(event.currentTarget.style.getPropertyValue('--calendar-week-height'))
        useCalendarStore.getState().navigateToDate(calendarWeekDate(Math.ceil(viewport.scrollTop / height)), 'nearest', true)
      }}
      aria-label={viewMode === 'week' ? '周日历' : '月日历'}
    >
      {/* Day headers */}
      <div className="calendar-weekdays grid grid-cols-7 shrink-0 mb-0.5" role="row" aria-rowindex={1}>
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
        ref={viewportRef}
        className="month-grid-body relative flex-1 min-h-0 rounded-md border"
        style={{ borderColor: cellBorderColor || 'rgba(255,255,255,0.15)', overflowY: blocked || menuOpen ? 'hidden' : 'auto' }}
        role="rowgroup"
      >
        <div ref={spaceRef} className="calendar-week-space relative" style={{ height: `calc(var(--calendar-week-height) * ${CALENDAR_WEEK_COUNT})` }}>
        {weekCells.map((week, wi) => {
          return (
            <div key={week[0].dateStr} role="row" data-week-index={range.first + wi} aria-rowindex={range.first + wi + 2} className="calendar-week-row absolute inset-x-0 grid grid-cols-7"
              style={{ top: `calc(var(--calendar-week-height) * ${calendarWeekIndex(week[0].day)})`, height: 'var(--calendar-week-height)' }}>
              {week.map((cell, di) => {
                const { day, dateStr } = cell
                return (
                  <DayCell
                    completedKeys={completedKeys}
                    todayKey={todayKey}
                    key={dateStr}
                    day={day}
                    dateStr={dateStr}
                    events={cell.events}
                    dailyTodos={dailyTodoSummary.itemsByDate.get(dateStr) || EMPTY_TODOS}
                    dailyTodoCount={dailyTodoSummary.counts.get(dateStr) || 0}
                    isCurrentMonth={viewMode === 'week' ? true : isSameMonth(day, browseDate)}
                    isToday={dateStr === todayKey}
                    compact={compact}
                    cellBorderColor={cellBorderColor}
                    holiday={getHoliday(dateStr)}
                    adjustedWorkday={getAdjustedWorkday(dateStr)}
                    showHolidayLabel={viewMode === 'week' && di === 0}
                    holidayStripeColor={holidayStripeColor}
                    holidayTextColor={holidayTextColor}
                    eventTextColor={eventTextColor}
                    scrollPositions={scrollPositions.current}
                    onMenuOpenChange={setMenuOpen}
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
    </div>
  )
})
