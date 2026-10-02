import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarEvent } from '@/types/calendar.types'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { cn, focusAdjacentInteractiveElement, getEventInstanceKey, hexToLuminance, isDateKey, normalizeHexColor, isEventCompleted, isTodoOverdue, type CalendarTodoPreview } from '@/lib/utils'
import { openTodoSource } from '@/lib/todo-navigation'
import { isHolidayLabelDay } from '@/lib/holidays'
import { format, isSameDay } from 'date-fns'
import { CalendarPlus, CalendarRange, ListTodo } from '@/components/ui/icons'
import { calendarKeyboardDate } from '@/lib/calendar-viewport'

const CONTEXT_MENU_WIDTH = 224
const CONTEXT_MENU_HEIGHT = 150
const CONTEXT_MENU_MARGIN = 10

function TagDot({ tagId }: { tagId: string }) {
  const tags = useTagStore((s) => s.tags)
  const tag = tags.find((item) => item.id === tagId)
  if (!tag) return null
  return (
    <span
      className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
      style={{ backgroundColor: tag.color, boxShadow: '0 0 0 1px rgba(255,255,255,0.55), 0 0 0 2px rgba(0,0,0,0.12)' }}
      title={tag.name}
    />
  )
}

function getReadableEventTextColor(color: string): string {
  const luminance = hexToLuminance(normalizeHexColor(color))
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#111827' : '#f8fafc'
}

interface DayCellProps {
  completedKeys?: ReadonlySet<string>
  todayKey?: string
  day: Date
  dateStr: string
  events: CalendarEvent[]
  dailyTodos?: CalendarTodoPreview[]
  dailyTodoCount?: number
  isCurrentMonth: boolean
  isToday: boolean
  compact?: boolean
  cellBorderColor?: string
  holiday?: string | null
  adjustedWorkday?: string | null
  showHolidayLabel?: boolean
  holidayStripeColor?: string
  holidayTextColor?: string
  eventTextColor?: string
  scrollPositions?: Map<string, number>
  onMenuOpenChange?: (open: boolean) => void
  onClick: () => void
  onDoubleClick: () => void
  onRightClick: (e: React.MouseEvent) => void
}

export const DayCell = memo(function DayCell({ day, events, dailyTodos = [], dailyTodoCount = 0, isCurrentMonth, isToday, compact = false, cellBorderColor, holiday, adjustedWorkday, showHolidayLabel = false, holidayStripeColor, holidayTextColor, eventTextColor, scrollPositions, onMenuOpenChange, onClick, onDoubleClick, onRightClick, dateStr, completedKeys, todayKey = format(new Date(), 'yyyy-MM-dd') }: DayCellProps) {
  const isSelected = useCalendarStore((s) => isSameDay(day, s.currentDate))
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const setMultiDayMode = useCalendarStore((s) => s.setMultiDayMode)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  const eventListRef = useRef<HTMLDivElement>(null)
  const isSupportedDate = isDateKey(dateStr)

  useLayoutEffect(() => {
    const list = eventListRef.current!
    list.scrollTop = scrollPositions?.get(dateStr) || 0
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return
      if (list.scrollHeight <= list.clientHeight + 1) return
      event.stopPropagation()
      if ((event.deltaY < 0 && list.scrollTop <= 0)
        || (event.deltaY > 0 && list.scrollTop >= list.scrollHeight - list.clientHeight - 1)) event.preventDefault()
    }
    const remember = () => {
      if (!scrollPositions) return
      scrollPositions.delete(dateStr)
      scrollPositions.set(dateStr, list.scrollTop)
      if (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value!)
    }
    list.addEventListener('wheel', wheel, { passive: false })
    list.addEventListener('scroll', remember, { passive: true })
    return () => {
      list.removeEventListener('wheel', wheel)
      list.removeEventListener('scroll', remember)
    }
  }, [dateStr, scrollPositions])

  useEffect(() => {
    if (!contextMenu) return
    onMenuOpenChange?.(true)
    return () => onMenuOpenChange?.(false)
  }, [contextMenu, onMenuOpenChange])

  useEffect(() => {
    if (!contextMenu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        window.requestAnimationFrame(() => cellRef.current?.focus())
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [contextMenu])

  const getEventBorderStyle = (event: CalendarEvent, dateStr: string): React.CSSProperties => {
    const isMultiDay = event.endDate && event.endDate !== event.startDate
    if (!isMultiDay) {
      const safeColor = normalizeHexColor(event.color)
      return {
        backgroundColor: `${safeColor}24`,
        color: eventTextColor || getReadableEventTextColor(safeColor),
        borderLeft: `2px solid ${safeColor}`,
        borderRight: `2px solid ${safeColor}`,
        borderTop: `1px solid ${safeColor}66`,
        borderBottom: `1px solid ${safeColor}66`,
        padding: compact ? '1px 3px' : '1px 5px',
        textShadow: 'none',
      }
    }
    const safeColor = normalizeHexColor(event.color)
    const isStart = dateStr === event.startDate
    const isEnd = dateStr === event.endDate
    return {
      backgroundColor: `${safeColor}28`,
      color: eventTextColor || getReadableEventTextColor(safeColor),
      borderLeft: isStart ? `2px solid ${safeColor}` : 'none',
      borderRight: isEnd ? `2px solid ${safeColor}` : 'none',
      borderTop: `1px solid ${safeColor}66`,
      borderBottom: `1px solid ${safeColor}66`,
      padding: compact ? '1px 3px' : '1px 5px',
      textShadow: 'none',
    }
  }

  const openContextMenuAt = (clientX: number, clientY: number) => {
    const maxX = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)
    const maxY = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN)
    setContextMenu({
      x: Math.min(Math.max(CONTEXT_MENU_MARGIN, clientX), maxX),
      y: Math.min(Math.max(CONTEXT_MENU_MARGIN, clientY), maxY),
    })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!isSupportedDate) return
    e.stopPropagation()
    onRightClick(e)
    openContextMenuAt(e.clientX, e.clientY)
  }

  const handleNewSingleDay = () => {
    setContextMenu(null)
    setMultiDayMode(false)
    openEventForm(null)
  }

  const handleNewMultiDay = () => {
    setContextMenu(null)
    setMultiDayMode(true)
    openEventForm(null)
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setContextMenu(null)
      window.requestAnimationFrame(() => cellRef.current?.focus())
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const backwards = event.shiftKey
      setContextMenu(null)
      window.setTimeout(() => focusAdjacentInteractiveElement(cellRef.current, backwards), 0)
      return
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    let targetIndex = currentIndex
    if (event.key === 'ArrowDown') targetIndex = (currentIndex + 1 + items.length) % items.length
    else if (event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + items.length) % items.length
    else if (event.key === 'Home') targetIndex = 0
    else if (event.key === 'End') targetIndex = items.length - 1
    else return
    event.preventDefault()
    items[targetIndex]?.focus()
  }

  return (
    <>
      {contextMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-[99990]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }}
          />
          <div
            className="day-context-menu fixed z-[99999] w-56 overflow-hidden rounded-xl p-1.5"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleMenuKeyDown}
            role="menu"
            aria-label={`${dateStr} 的操作菜单`}
          >
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold tabular-nums opacity-60">
              {format(day, 'yyyy年M月d日')}
            </div>
            <button
              onClick={handleNewSingleDay}
              className="day-context-action w-full rounded-lg px-2.5 py-2 text-left transition-colors"
              role="menuitem"
              autoFocus
            >
              <CalendarPlus size={15} />
              <span>
                <strong>新建单日事件</strong>
                <small>仅安排在这一天</small>
              </span>
            </button>
            <button
              onClick={handleNewMultiDay}
              className="day-context-action w-full rounded-lg px-2.5 py-2 text-left transition-colors"
              role="menuitem"
            >
              <CalendarRange size={15} />
              <span>
                <strong>新建跨日事件</strong>
                <small>从这一天开始选择范围</small>
              </span>
            </button>
          </div>
        </>,
        document.body
      )}

      <div
        ref={cellRef}
        onClick={isSupportedDate ? onClick : undefined}
        onDoubleClick={isSupportedDate ? onDoubleClick : undefined}
        onContextMenu={handleContextMenu}
        onKeyDown={(event) => {
          if (!isSupportedDate) return
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const target = calendarKeyboardDate(day, event.key)
            if (target) useCalendarStore.getState().navigateToDate(target, 'nearest', true)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            onClick()
            onDoubleClick()
          } else if (event.key === ' ') {
            event.preventDefault()
            onClick()
          } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            onClick()
            const rect = event.currentTarget.getBoundingClientRect()
            openContextMenuAt(rect.left + Math.min(rect.width / 2, 80), rect.top + Math.min(rect.height / 2, 60))
          }
        }}
        role="gridcell"
        data-date={dateStr}
        data-outside-month={!isCurrentMonth || undefined}
        tabIndex={isSupportedDate && isSelected ? 0 : -1}
        aria-selected={isSupportedDate ? isSelected : undefined}
        aria-disabled={!isSupportedDate || undefined}
        aria-label={isSupportedDate
          ? `${format(day, 'yyyy年M月d日')}${holiday ? `，${holiday}放假` : ''}${adjustedWorkday ? `，${adjustedWorkday}` : ''}，${events.length} 个事件${dailyTodoCount > 0 ? `，${dailyTodoCount} 个未完成待办` : ''}`
          : `${format(day, 'yyyy年M月d日')}，超出支持范围，不可选择`}
        className={cn(
          'calendar-day-cell relative transition-colors group flex flex-col overflow-hidden border',
          isSupportedDate ? 'cursor-pointer hover:bg-accent/20' : 'cursor-not-allowed opacity-[0.42]',
          isToday && 'bg-primary/6 border-primary/25',
          isSelected && !isToday && 'ring-1 ring-inset ring-primary/40 bg-primary/4',
          isSelected && isToday && 'ring-1 ring-inset ring-primary/40',
          compact ? 'p-0.5 gap-px' : 'p-1.5 min-h-[80px] gap-0.5',
        )}
        style={{
          borderColor: cellBorderColor || 'rgba(255,255,255,0.15)',
          ...(holiday && holidayStripeColor ? {
            backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${holidayStripeColor} 4px, ${holidayStripeColor} 9px)`,
          } : {}),
        }}
      >
        {/* Day number + holiday name */}
        <div className={cn('calendar-day-header shrink-0 min-w-0', compact ? 'min-h-6' : 'min-h-7')}>
          <span
            className={cn(
              'calendar-day-number inline-flex items-center justify-center rounded-full shrink-0 font-semibold',
              'text-[0.85em]',
              isToday && 'bg-primary text-primary-foreground',
              isSelected && !isToday && 'bg-primary/25 text-primary',
              !isToday && !isSelected && isCurrentMonth && 'opacity-60',
              !isToday && !isSelected && !isCurrentMonth && 'opacity-50',
              compact ? 'w-6 h-6' : 'w-7 h-7',
            )}
          >
            {day.getDate()}
          </span>
          {(day.getDate() === 1 || (holiday && (showHolidayLabel || isHolidayLabelDay(dateStr))) || adjustedWorkday) && (
            <div className="calendar-day-meta flex min-w-0 items-center gap-1">
              {day.getDate() === 1 && <span className="calendar-month-marker text-[0.68em] font-semibold" title={format(day, 'yyyy年M月')}>
                {format(day, day.getMonth() === 0 ? 'yyyy年M月' : 'M月')}
              </span>}
              {holiday && (showHolidayLabel || isHolidayLabelDay(dateStr)) && (
                <span
                  className={cn(
                    'min-w-0 truncate font-medium',
                    compact ? 'text-[0.72em]' : 'text-[0.76em]',
                  )}
                  style={holidayTextColor ? { color: holidayTextColor } : undefined}
                  title={holiday}
                >
                  {holiday}
                </span>
              )}
              {adjustedWorkday && (
                <span className="day-adjusted-workday shrink-0 rounded px-1 text-[0.7em] font-semibold" title={adjustedWorkday}>班</span>
              )}
            </div>
          )}
          {isSupportedDate && dailyTodoCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                window.electronAPI?.createNote({ noteType: 'daily', title: '每日待办', activeDate: dateStr })
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn(
                'daily-calendar-chip z-10 inline-flex shrink-0 items-center justify-center gap-0.5 whitespace-nowrap rounded px-1 font-semibold leading-none',
                compact ? 'text-[0.7em]' : 'text-[0.74em]'
              )}
              title={`${dateStr} 有 ${dailyTodoCount} 个未完成待办（含未完成的事件），点击打开每日待办`}
              aria-label={`打开 ${dateStr} 的每日待办，共 ${dailyTodoCount} 个未完成项`}
            >
              <ListTodo className="calendar-todo-icon" aria-hidden="true" />
              <span className="daily-calendar-chip-count tabular-nums">{dailyTodoCount}</span>
            </button>
          )}
        </div>

        {/* Event badges - scrollable container */}
        <div ref={eventListRef} className={cn('day-event-list flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-px', compact ? 'mt-px' : 'mt-0.5')}>
          {isSupportedDate && dailyTodos.map((todo) => (
            <button
              key={`todo-${todo.noteId}-${todo.id}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void openTodoSource(todo)
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn('calendar-todo-preview flex min-h-5 w-full min-w-0 items-center gap-1 rounded-sm px-1 text-left text-[0.76em] font-medium leading-tight transition-colors', todo.isCompleted && 'task-completed', isTodoOverdue(todo, todayKey) && 'task-overdue')}
              title={`待办：${todo.content}`}
              aria-label={`打开待办：${todo.content}`}
            >
              <ListTodo className="calendar-todo-icon" aria-hidden="true" />
              <span className="truncate">{todo.content}</span>
            </button>
          ))}
          {isSupportedDate && events.map((event) => {
            const eventKey = getEventInstanceKey(event)
            const hasEndDate = event.endDate && event.endDate !== event.startDate
            const isMultiStart = hasEndDate && dateStr === event.startDate
            const isMultiEnd = hasEndDate && dateStr === event.endDate
            const multiMargins = hasEndDate ? {
              marginLeft: isMultiStart ? '0' : '-3px',
              marginRight: isMultiEnd ? '0' : '-3px',
            } : {}
            const roundingClass = hasEndDate
              ? (isMultiStart ? 'rounded-l-sm' : isMultiEnd ? 'rounded-r-sm' : 'rounded-none')
              : 'rounded-sm'
            return (
              <div
                key={eventKey}
                onClick={(e) => {
                  e.stopPropagation()
                  selectEvent(event.seriesId || event.id, event.occurrenceDate || event.startDate)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    selectEvent(event.seriesId || event.id, event.occurrenceDate || event.startDate)
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`打开事件：${event.title}${event.startTime ? `，${event.startTime}` : ''}`}
                className={cn(
                  'flex min-h-5 max-w-full min-w-0 items-center gap-0.5 text-[0.76em] leading-tight truncate cursor-pointer transition-opacity hover:opacity-75',
                  'font-medium',
                  isEventCompleted(event, completedKeys) && 'calendar-event-completed',
                  roundingClass
                )}
                style={{
                  ...getEventBorderStyle(event, dateStr),
                  ...multiMargins,
                }}
                title={`${event.title}${event.startTime ? ' ' + event.startTime : ''}`}
              >
                {!event.isAllDay && event.startTime && (
                  <span className="calendar-event-time shrink-0 text-[0.92em] tabular-nums">{event.startTime}</span>
                )}
                {event.tagId && (
                  <TagDot tagId={event.tagId} />
                )}
                <span className="calendar-event-title truncate">{event.title}</span>
              </div>
            )
          })}
        </div>

      </div>
    </>
  )
})
