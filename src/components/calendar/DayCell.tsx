import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarEvent } from '@/types/calendar.types'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { cn, getEventInstanceKey, hexToLuminance, normalizeHexColor, type CalendarTodoPreview } from '@/lib/utils'
import { isHolidayLabelDay } from '@/lib/holidays'
import { format, isSameDay } from 'date-fns'
import { CalendarPlus, CalendarRange } from 'lucide-react'

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
  onClick: () => void
  onDoubleClick: () => void
  onRightClick: (e: React.MouseEvent) => void
}

export function DayCell({ day, events, dailyTodos = [], dailyTodoCount = 0, isCurrentMonth, isToday, compact = false, cellBorderColor, holiday, adjustedWorkday, showHolidayLabel = false, holidayStripeColor, holidayTextColor, eventTextColor, onClick, onDoubleClick, onRightClick, dateStr }: DayCellProps) {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const setMultiDayMode = useCalendarStore((s) => s.setMultiDayMode)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  const eventListRef = useRef<HTMLDivElement>(null)
  const isSelected = isSameDay(day, currentDate)

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

  const handleCellWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const list = eventListRef.current
    if (!list || event.deltaY === 0 || list.scrollHeight <= list.clientHeight) return
    const maxScrollTop = list.scrollHeight - list.clientHeight
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, list.scrollTop + event.deltaY))
    if (nextScrollTop === list.scrollTop) return
    event.preventDefault()
    event.stopPropagation()
    list.scrollTop = nextScrollTop
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
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onWheel={handleCellWheel}
        onContextMenu={handleContextMenu}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const cells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')]
            const currentIndex = cells.indexOf(event.currentTarget)
            const rowStart = Math.floor(currentIndex / 7) * 7
            const targetIndex = event.key === 'ArrowLeft' ? currentIndex - 1
              : event.key === 'ArrowRight' ? currentIndex + 1
                : event.key === 'ArrowUp' ? currentIndex - 7
                  : event.key === 'ArrowDown' ? currentIndex + 7
                    : event.key === 'Home' ? rowStart
                      : rowStart + 6
            const target = cells[targetIndex]
            if (target) {
              target.focus()
              target.click()
            }
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
        tabIndex={isSelected ? 0 : -1}
        aria-selected={isSelected}
        aria-label={`${format(day, 'yyyy年M月d日')}${holiday ? `，${holiday}放假` : ''}${adjustedWorkday ? `，${adjustedWorkday}` : ''}，${events.length} 个事件${dailyTodoCount > 0 ? `，${dailyTodoCount} 个未完成待办` : ''}`}
        className={cn(
          'relative transition-colors cursor-pointer group flex flex-col overflow-hidden',
          'border hover:bg-accent/20',
          isToday && 'bg-primary/6 border-primary/25',
          isSelected && !isToday && 'ring-1 ring-inset ring-primary/40 bg-primary/4',
          isSelected && isToday && 'ring-1 ring-inset ring-primary/40',
          !isCurrentMonth && 'opacity-[0.42]',
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
        <div className={cn('flex shrink-0 items-center gap-1 min-w-0', compact ? 'min-h-6' : 'h-7')}>
          <span
            className={cn(
              'calendar-day-number inline-flex items-center justify-center rounded-full shrink-0 font-semibold',
              'text-[0.85em]',
              isToday && 'bg-primary text-primary-foreground',
              isSelected && !isToday && 'bg-primary/25 text-primary',
              !isToday && !isSelected && 'opacity-60',
              !isCurrentMonth && 'opacity-[0.38]',
              compact ? 'w-6 h-6' : 'w-7 h-7',
            )}
          >
            {day.getDate()}
          </span>
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
          {dailyTodoCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                window.electronAPI?.createNote({ noteType: 'daily', title: '每日待办', activeDate: dateStr })
              }}
              className={cn(
                'daily-calendar-chip z-10 ml-auto flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full border p-0 font-semibold leading-none',
                compact ? 'h-6 min-h-6 w-6 min-w-6 text-[0.7em]' : 'h-7 min-h-7 w-7 min-w-7 text-[0.74em]'
              )}
              title={`${dateStr} 有 ${dailyTodoCount} 个未完成待办`}
              aria-label={`打开 ${dateStr} 的每日待办，共 ${dailyTodoCount} 个未完成项`}
            >
              <span className="daily-calendar-chip-count tabular-nums">{dailyTodoCount}</span>
            </button>
          )}
        </div>

        {/* Event badges - scrollable container */}
        <div ref={eventListRef} className={cn('day-event-list flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-px', compact ? 'mt-px' : 'mt-0.5')}>
          {dailyTodos.map((todo) => (
            <button
              key={`todo-${todo.noteId}-${todo.id}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                window.electronAPI?.createNote({ noteType: 'daily', title: '每日待办', activeDate: dateStr })
              }}
              className="calendar-todo-preview flex min-h-5 w-full min-w-0 items-center rounded-sm px-1 text-left text-[0.76em] font-medium leading-tight transition-opacity hover:opacity-80"
              title={`待办：${todo.content}`}
              aria-label={`打开待办：${todo.content}`}
            >
              <span className="truncate">{todo.content}</span>
            </button>
          ))}
          {events.map((event) => {
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
                <span className="truncate">{event.title}</span>
              </div>
            )
          })}
        </div>

      </div>
    </>
  )
}
