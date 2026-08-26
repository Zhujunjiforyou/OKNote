import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import { useTagStore } from '@/stores/tag.store'
import { Clock, Repeat } from 'lucide-react'
import { useAppSettings } from '@/hooks/useAppSettings'
import { buildDailyTodoItemsByDate, filterEventsByDate, getEventInstanceKey, isLightColor } from '@/lib/utils'

function formatRemaining(diffMs: number): string {
  const absMs = Math.abs(diffMs)
  const minutes = Math.ceil(absMs / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.ceil(hours / 24)} 天`
}

function formatRemainingCompact(diffMs: number): string {
  const absMs = Math.abs(diffMs)
  const minutes = Math.ceil(absMs / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.ceil(hours / 24)}d`
}

type DeadlineTone = 'late' | 'soon' | 'normal' | 'started'

function getDeadlineStatus(ev: { endDate?: string; startDate: string; startTime?: string; endTime?: string; isAllDay?: boolean }, displayDate: string, now: number): { label: string; compactLabel: string; tone: DeadlineTone } | null {
  const hasDeadline = !!ev.endTime
  const targetTime = ev.endTime || (!ev.isAllDay ? ev.startTime : undefined)
  if (!targetTime) return null
  const targetDate = hasDeadline ? (ev.endDate || ev.startDate || displayDate) : (ev.startDate || displayDate)
  const targetMs = new Date(`${targetDate}T${targetTime}:00`).getTime()
  if (!Number.isFinite(targetMs)) return null
  const diffMs = targetMs - now
  if (diffMs < 0) return {
    label: hasDeadline ? `已过期 ${formatRemaining(diffMs)}` : `已经开始 ${formatRemaining(diffMs)}`,
    compactLabel: `${hasDeadline ? '逾期' : '已开始'} ${formatRemainingCompact(diffMs)}`,
    tone: hasDeadline ? 'late' : 'started',
  }
  if (diffMs <= 30 * 60 * 1000) return {
    label: `${formatRemaining(diffMs)}后${hasDeadline ? '截止' : '开始'}`,
    compactLabel: `${formatRemainingCompact(diffMs)} 后${hasDeadline ? '截止' : '开始'}`,
    tone: 'soon',
  }
  if (diffMs <= 48 * 60 * 60 * 1000) return {
    label: `${formatRemaining(diffMs)}后${hasDeadline ? '截止' : '开始'}`,
    compactLabel: `${formatRemainingCompact(diffMs)} 后${hasDeadline ? '截止' : '开始'}`,
    tone: 'normal',
  }
  return null
}

function getDeadlineStyle(tone: DeadlineTone, lightBg: boolean, mutedText: string, chipBg: string, chipBorder: string) {
  if (tone === 'late') {
    return {
      color: lightBg ? '#991b1b' : '#fecaca',
      backgroundColor: lightBg ? 'rgba(239,68,68,0.16)' : 'rgba(127,29,29,0.50)',
      border: `1px solid ${lightBg ? 'rgba(185,28,28,0.25)' : 'rgba(248,113,113,0.34)'}`,
    }
  }
  if (tone === 'soon') {
    return {
      color: lightBg ? '#7c2d12' : '#fff7ed',
      backgroundColor: lightBg ? 'rgba(251,146,60,0.24)' : 'rgba(180,83,9,0.48)',
      border: `1px solid ${lightBg ? 'rgba(194,65,12,0.28)' : 'rgba(251,191,36,0.36)'}`,
    }
  }
  if (tone === 'started') {
    return {
      color: lightBg ? '#065f46' : '#bbf7d0',
      backgroundColor: lightBg ? 'rgba(16,185,129,0.17)' : 'rgba(6,95,70,0.42)',
      border: `1px solid ${lightBg ? 'rgba(5,150,105,0.26)' : 'rgba(52,211,153,0.32)'}`,
    }
  }
  return {
    color: mutedText,
    backgroundColor: chipBg,
    border: `1px solid ${chipBorder}`,
  }
}

export function ViewNotePanel() {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const events = useCalendarStore((s) => s.events)
  const notes = useNotesStore((s) => s.notes)
  const viewNoteTagFilter = useCalendarStore((s) => s.viewNoteTagFilter)
  const toggleViewNoteTag = useCalendarStore((s) => s.toggleViewNoteTag)
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const tags = useTagStore((s) => s.tags)
  const { settings } = useAppSettings('calendar')
  const [now, setNow] = useState(() => Date.now())
  const lightBg = isLightColor(settings.backgroundColor)
  const panelBg = lightBg ? 'rgba(15,23,42,0.045)' : 'rgba(255,255,255,0.055)'
  const panelBorder = lightBg ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255,255,255,0.12)'
  const chipBg = lightBg ? 'rgba(15,23,42,0.070)' : 'rgba(255,255,255,0.095)'
  const activeChipBg = lightBg ? 'rgba(37,99,235,0.14)' : 'rgba(96,165,250,0.18)'
  const chipBorder = lightBg ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.12)'
  const activeChipBorder = lightBg ? 'rgba(37,99,235,0.32)' : 'rgba(147,197,253,0.34)'
  const activeChipColor = lightBg ? '#1d4ed8' : '#93c5fd'
  const readableText = 'var(--calendar-text)'
  const mutedText = 'color-mix(in srgb, var(--calendar-text) 72%, transparent)'

  const displayDate = format(currentDate, 'yyyy-MM-dd')
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const dateLabel = useMemo(() => {
    try {
      const d = new Date(displayDate + 'T00:00:00')
      return format(d, 'M月d日 EEEE', { locale: zhCN })
    } catch {
      return displayDate
    }
  }, [displayDate])
  const shortDateLabel = useMemo(() => {
    try {
      return format(new Date(displayDate + 'T00:00:00'), 'M月d日')
    } catch {
      return displayDate
    }
  }, [displayDate])

  // Filter events for the selected date, with optional tag filter
  const filteredEvents = useMemo(() => {
    const dayEvents = filterEventsByDate(events, displayDate)
    if (viewNoteTagFilter.length === 0) return dayEvents
    return dayEvents.filter((ev) => ev.tagId && viewNoteTagFilter.includes(ev.tagId))
  }, [events, displayDate, viewNoteTagFilter])

  const dailyTodos = useMemo(() => {
    return buildDailyTodoItemsByDate(notes, displayDate, displayDate).get(displayDate) || []
  }, [displayDate, notes])

  const itemCount = filteredEvents.length + dailyTodos.length

  return (
    <div
      className="view-note-panel relative flex flex-col shrink-0 border-r"
      style={{ borderColor: panelBorder, backgroundColor: panelBg, color: readableText }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 text-[0.78em] font-semibold opacity-75">
            <span className="view-date-full block truncate">{dateLabel}</span>
            <span className="view-date-short hidden whitespace-nowrap">{shortDateLabel}</span>
          </div>
          <div className="view-event-count shrink-0 text-[0.66em] opacity-48">
            {filteredEvents.length} 个事件{dailyTodos.length > 0 ? ` · ${dailyTodos.length} 个待办` : ''}
          </div>
        </div>
      </div>

      {/* Tag filter bar */}
      <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
        <button
          onClick={() => useCalendarStore.getState().setViewNoteTagFilter([])}
          className="view-filter-chip min-h-6 px-2.5 py-1 rounded-full text-[0.66em] transition-colors"
          style={{
            backgroundColor: viewNoteTagFilter.length === 0 ? activeChipBg : chipBg,
            border: `1px solid ${viewNoteTagFilter.length === 0 ? activeChipBorder : chipBorder}`,
            color: viewNoteTagFilter.length === 0 ? activeChipColor : readableText,
            opacity: viewNoteTagFilter.length === 0 ? 1 : 0.62,
            boxShadow: viewNoteTagFilter.length === 0 ? '0 0 0 1px rgba(255,255,255,0.10) inset, 0 6px 18px rgba(4,10,24,0.08)' : undefined,
          }}
        >
          全部
        </button>
        {tags.map((tag) => {
          const isActive = viewNoteTagFilter.includes(tag.id)
          return (
            <button
              key={tag.id}
              onClick={() => toggleViewNoteTag(tag.id)}
              className="view-filter-chip min-h-6 px-2.5 py-1 rounded-full text-[0.66em] transition-colors flex items-center gap-1.5"
              style={{
                backgroundColor: isActive ? activeChipBg : chipBg,
                border: `1px solid ${isActive ? activeChipBorder : chipBorder}`,
                color: readableText,
                opacity: isActive ? 0.96 : 0.68,
                boxShadow: isActive ? '0 0 0 1px rgba(255,255,255,0.10) inset, 0 6px 18px rgba(4,10,24,0.08)' : undefined,
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: tag.color, boxShadow: isActive ? `0 0 0 1px rgba(255,255,255,0.72), 0 0 0 3px color-mix(in srgb, ${tag.color} 24%, transparent)` : '0 0 0 1px rgba(255,255,255,0.65), 0 0 0 2px rgba(0,0,0,0.10)' }} />
              {tag.name}
            </button>
          )
        })}
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
        {itemCount === 0 ? (
          <div className="py-7 text-center text-[0.72em] opacity-42">当天无事项</div>
        ) : (
          <>
            {dailyTodos.map((todo) => (
              <button
                key={`todo-${todo.noteId}-${todo.id}`}
                type="button"
                onClick={() => window.electronAPI?.createNote({ noteType: 'daily', title: '每日待办', activeDate: displayDate })}
                className="view-todo-item grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md px-2.5 py-2 text-left transition-colors"
                style={{
                  backgroundColor: lightBg ? 'rgba(22,163,74,0.09)' : 'rgba(34,197,94,0.10)',
                  border: `1px solid ${lightBg ? 'rgba(22,163,74,0.20)' : 'rgba(74,222,128,0.20)'}`,
                  color: readableText,
                }}
                title={`打开每日待办：${todo.content}`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: lightBg ? '#16a34a' : '#4ade80' }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[0.76em] font-medium leading-tight">{todo.content}</span>
                  <span className="mt-0.5 block text-[0.62em] leading-tight" style={{ color: mutedText }}>每日待办</span>
                </span>
              </button>
            ))}
            {filteredEvents.map((ev) => {
            const tag = ev.tagId ? tags.find((t) => t.id === ev.tagId) : null
            const deadline = getDeadlineStatus(ev, displayDate, now)
            const isRecurring = !!ev.recurrence
            return (
              <button
                key={getEventInstanceKey(ev)}
                onClick={() => selectEvent(ev.seriesId || ev.id, ev.occurrenceDate || ev.startDate)}
                className={`view-event-item w-full text-left px-2.5 py-2 rounded-md transition-colors grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 group ${isRecurring ? 'view-event-item-recurring' : ''}`}
                style={{
                  backgroundColor: isRecurring ? (lightBg ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.075)') : chipBg,
                  color: readableText,
                  border: isRecurring ? `1px solid color-mix(in srgb, ${ev.color} 38%, transparent)` : '1px solid transparent',
                  ['--event-color' as string]: ev.color,
                }}
              >
                <div className="view-event-dot mt-[0.32em] w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: ev.color, boxShadow: '0 0 0 1px rgba(255,255,255,0.65), 0 0 0 2px rgba(0,0,0,0.10)' }} />
                <div className="flex-1 min-w-0">
                  <div className="view-event-title text-[0.76em] truncate leading-tight font-medium">{ev.title}</div>
                  <div className="view-event-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.65em] mt-0.5" style={{ color: mutedText }}>
                    <Clock size={9} />
                    {isRecurring && (
                      <span className="view-recurring-chip inline-flex items-center gap-0.5 rounded px-1">
                        <Repeat size={9} />
                        循环
                      </span>
                    )}
                    <span>{ev.isAllDay ? '全天' : ev.startTime || '未设时间'}</span>
                    {tag && (
                      <span
                        className="px-1 rounded text-[0.85em] max-w-[60px] truncate"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${tag.color} 14%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${tag.color} 30%, transparent)`,
                          color: readableText,
                        }}
                      >
                        {tag.name}
                      </span>
                    )}
                    {deadline && (
                      <span
                        className="view-deadline-chip inline-flex max-w-full items-center whitespace-normal rounded px-1.5 py-0.5 font-medium leading-tight"
                        style={getDeadlineStyle(deadline.tone, lightBg, mutedText, chipBg, chipBorder)}
                      >
                        <span className="view-deadline-full">{deadline.label}</span>
                        <span className="view-deadline-compact hidden">{deadline.compactLabel}</span>
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
            })}
          </>
        )}
      </div>
    </div>
  )
}
