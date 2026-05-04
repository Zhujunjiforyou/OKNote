import { useState } from 'react'
import { CalendarEvent } from '@/types/calendar.types'
import { useCalendarStore } from '@/stores/calendar.store'
import { cn } from '@/lib/utils'
import { isHolidayLabelDay } from '@/lib/holidays'

interface DayCellProps {
  day: Date
  dateStr: string
  events: CalendarEvent[]
  eventRows: Record<string, number>
  isCurrentMonth: boolean
  isToday: boolean
  compact?: boolean
  cellBorderColor?: string
  holiday?: string | null
  holidayStripeColor?: string
  holidayTextColor?: string
  onClick: () => void
  onDoubleClick: () => void
  onRightClick: (e: React.MouseEvent) => void
}

export function DayCell({ day, events, eventRows, isCurrentMonth, isToday, compact = false, cellBorderColor, holiday, holidayStripeColor, holidayTextColor, onClick, onDoubleClick, onRightClick, dateStr }: DayCellProps) {
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const setMultiDayMode = useCalendarStore((s) => s.setMultiDayMode)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const getEventBorderStyle = (event: CalendarEvent, dateStr: string): React.CSSProperties => {
    const isMultiDay = event.endDate && event.endDate !== event.startDate
    if (!isMultiDay) {
      return {
        backgroundColor: `${event.color}18`,
        color: event.color,
        borderLeft: `2px solid ${event.color}`,
        borderRight: `2px solid ${event.color}`,
        padding: compact ? '1px 3px' : '1px 5px',
      }
    }
    const isStart = dateStr === event.startDate
    const isEnd = dateStr === event.endDate
    return {
      backgroundColor: `${event.color}22`,
      color: event.color,
      borderLeft: isStart ? `2px solid ${event.color}` : 'none',
      borderRight: isEnd ? `2px solid ${event.color}` : 'none',
      padding: compact ? '1px 3px' : '1px 5px',
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
    onRightClick(e)
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

  return (
    <>
      {/* Transparent overlay mask to close context menu on outside click */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-[99]"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }}
        />
      )}

      <div
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={handleContextMenu}
        className={cn(
          'relative transition-colors cursor-pointer group flex flex-col',
          'border hover:bg-accent/20',
          isToday && 'bg-primary/6 border-primary/25',
          !isCurrentMonth && 'opacity-25',
          compact ? 'p-0.5 gap-px' : 'p-1.5 min-h-[80px] gap-0.5',
        )}
        style={{
          borderColor: cellBorderColor || 'rgba(255,255,255,0.15)',
          ...(holiday && holidayStripeColor ? {
            backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 3px, ${holidayStripeColor} 3px, ${holidayStripeColor} 6px)`,
          } : {}),
        }}
      >
        {/* Day number + holiday name */}
        <div className={cn('flex items-center gap-1 shrink-0', compact ? 'min-h-0' : 'h-6')}>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full shrink-0 font-semibold',
              'text-[0.85em]',
              isToday && 'bg-primary text-primary-foreground',
              !isToday && 'opacity-60',
              !isCurrentMonth && 'opacity-20',
              compact ? 'w-5 h-5' : 'w-6 h-6',
            )}
          >
            {day.getDate()}
          </span>
          {holiday && isHolidayLabelDay(dateStr) && (
            <span
              className={cn(
                'truncate font-medium',
                compact ? 'text-[0.55em]' : 'text-[0.65em]',
              )}
              style={holidayTextColor ? { color: holidayTextColor } : undefined}
              title={holiday}
            >
              {holiday}
            </span>
          )}
        </div>

        {/* Event badges - scrollable container */}
        <div className={cn('flex-1 min-h-0 overflow-y-auto space-y-px', compact ? 'mt-px' : 'mt-0.5')}>
          {events.map((event) => {
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
                key={event.id}
                onClick={(e) => {
                  e.stopPropagation()
                  selectEvent(event.id)
                }}
                className={cn(
                  'flex items-center gap-0.5 text-[0.65em] leading-tight truncate cursor-pointer transition-opacity hover:opacity-75',
                  roundingClass
                )}
                style={{
                  ...getEventBorderStyle(event, dateStr),
                  ...multiMargins,
                }}
                title={`${event.title}${event.startTime ? ' ' + event.startTime : ''}`}
              >
                {!event.isAllDay && event.startTime && (
                  <span className="opacity-50 shrink-0 text-[0.92em]">{event.startTime}</span>
                )}
                <span className="truncate">{event.title}</span>
              </div>
            )
          })}
        </div>

        {/* Right-click context menu */}
        {contextMenu && (
          <div
            className="fixed z-[100] bg-background/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleNewSingleDay}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            >
              新建单日事件
            </button>
            <button
              onClick={handleNewMultiDay}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors"
            >
              新建跨日事件
            </button>
          </div>
        )}
      </div>
    </>
  )
}
