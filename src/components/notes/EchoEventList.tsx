import { useState, useEffect, useMemo } from 'react'
import type { CalendarEvent } from '@/types/calendar.types'
import type { Note } from '@/types/notes.types'
import { useTagStore } from '@/stores/tag.store'
import { useCalendarStore } from '@/stores/calendar.store'
import { Clock, Repeat } from 'lucide-react'
import { getEventInstanceKey, getTagViewEventInstances, hexToLuminance, normalizeCalendarEvents, normalizeHexColor } from '@/lib/utils'
import { useCurrentDateKey } from '@/hooks/useCurrentDateKey'
import { reportPersistenceIssue } from '@/stores/persistence.store'

interface EchoEventListProps {
  note: Note
  onSelectEvent?: (event: CalendarEvent) => void
  compact?: boolean
  surfaceColor?: string
  textColor?: string
}

function readableTextOn(hex: string): string {
  const luminance = hexToLuminance(normalizeHexColor(hex))
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#111827' : '#f8fafc'
}

export function EchoEventList({ note, onSelectEvent, compact = false, surfaceColor, textColor: configuredTextColor }: EchoEventListProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const calendarEvents = useCalendarStore((s) => s.events)
  const tags = useTagStore((s) => s.tags)
  const selectedTagIds = Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
    ? note.viewTagIds
    : (note.echoTagId ? [note.echoTagId] : [])
  const selectedTagKey = selectedTagIds.join('|')
  const selectedTags = selectedTagIds.map((tagId) => tags.find((tag) => tag.id === tagId)).filter(Boolean)
  const today = useCurrentDateKey()
  const noteTextColor = configuredTextColor || readableTextOn(surfaceColor || note.color)
  const lightNote = noteTextColor === '#111827'
  const surfaceBg = lightNote ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.14)'
  const recurringSurfaceBg = lightNote ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.10)'
  const surfaceBorder = lightNote ? 'rgba(17,24,39,0.14)' : 'rgba(255,255,255,0.18)'
  const mutedColor = lightNote ? 'rgba(17,24,39,0.72)' : 'rgba(248,250,252,0.78)'
  const formatDateShort = (dateStr?: string) => {
    if (!dateStr) return ''
    const [, month = '', day = ''] = dateStr.split('-')
    return month && day ? `${Number(month)}/${Number(day)}` : dateStr
  }
  const compareEventStart = (a: CalendarEvent, b: CalendarEvent) => {
    const aValue = `${a.startDate || ''}T${a.isAllDay ? '00:00' : (a.startTime || '23:59')}`
    const bValue = `${b.startDate || ''}T${b.isAllDay ? '00:00' : (b.startTime || '23:59')}`
    return aValue.localeCompare(bValue)
  }
  const visibleEvents = useMemo(() => {
    return getTagViewEventInstances(events, today)
  }, [events, today])

  const applyEventsSnapshot = (snapshot: unknown[]) => {
    const merged = new Map<string, CalendarEvent>()
    for (const event of normalizeCalendarEvents(snapshot)) {
      if (!event?.id || !event.tagId || !selectedTagIds.includes(event.tagId)) continue
      merged.set(event.seriesId || event.id, event)
    }
    setEvents([...merged.values()])
  }

  const loadEvents = async () => {
    if (!window.electronAPI?.isElectron || selectedTagIds.length === 0) {
      setEvents([])
      return
    }
    try {
      const results = await Promise.all(selectedTagIds.map((tagId) => window.electronAPI!.getEventsByTag(tagId)))
      const merged = new Map<string, CalendarEvent>()
      for (const data of results) {
        if (!Array.isArray(data)) continue
        for (const event of normalizeCalendarEvents(data)) {
          merged.set(event.seriesId || event.id, event)
        }
      }
      setEvents([...merged.values()])
    } catch (e) {
      console.error('EchoEventList loadEvents failed:', e)
      reportPersistenceIssue('回响事件读取失败', e instanceof Error ? e.message : '无法读取标签下的事件。', loadEvents)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [selectedTagKey])

  useEffect(() => {
    if (calendarEvents.length === 0 && events.length === 0) return
    applyEventsSnapshot(calendarEvents)
  }, [calendarEvents, selectedTagKey])

  // Listen for event changes broadcast
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onEventsChanged((data) => {
      if (Array.isArray(data?.events)) {
        applyEventsSnapshot(data.events)
        return
      }
      loadEvents()
    })
  }, [selectedTagKey])

  // Upcoming events are easiest to act on; history follows in reverse order.
  const sorted = [...visibleEvents].sort((a, b) => {
    const sa = typeof a.startDate === 'string' ? a.startDate : ''
    const sb = typeof b.startDate === 'string' ? b.startDate : ''
    const aFuture = (a.endDate || sa) >= today
    const bFuture = (b.endDate || sb) >= today
    if (aFuture !== bFuture) return aFuture ? -1 : 1
    const dateCompare = aFuture ? sa.localeCompare(sb) : sb.localeCompare(sa)
    if (dateCompare !== 0) return dateCompare
    const sameDayCompare = compareEventStart(a, b)
    return aFuture ? sameDayCompare : -sameDayCompare
  })

  if (visibleEvents.length === 0) {
    return (
      <div className="echo-empty-state flex-1 flex flex-col items-center justify-center text-center px-4">
        <p className="text-[0.9em] opacity-35 py-3">
          {selectedTags.length > 0 ? '所选标签下暂无事件' : '请先选择监听标签'}
        </p>
      </div>
    )
  }

  return (
    <div
      className={`relative z-[2] flex-1 overflow-y-auto ${compact ? 'px-2 py-1 space-y-1' : 'px-2 py-1.5 space-y-1.5'}`}
      style={{ color: noteTextColor, textShadow: lightNote ? '0 1px 0 rgba(255,255,255,0.22)' : '0 1px 1px rgba(0,0,0,0.45)' }}
    >
      {sorted.map((event) => {
        const isRecurring = !!event.recurrence
        return (
        <button
          key={getEventInstanceKey(event)}
          onClick={() => onSelectEvent?.(event)}
          className={`w-full min-w-0 text-left rounded-lg border transition-colors flex items-center group echo-event-item ${isRecurring ? 'echo-event-item-recurring' : ''} ${compact ? 'px-2 py-1.5 gap-2' : 'px-2.5 py-2 gap-2.5'}`}
          style={{
            borderColor: isRecurring ? normalizeHexColor(event.color) : surfaceBorder,
            backgroundColor: isRecurring ? recurringSurfaceBg : surfaceBg,
            color: noteTextColor,
            ['--event-color' as string]: normalizeHexColor(event.color),
            ['--event-recurring-bg' as string]: recurringSurfaceBg,
          }}
        >
          {/* Date badge */}
          <div
            className={`shrink-0 text-center rounded-md ${compact ? 'w-8 py-0.5' : 'w-10 py-1'}`}
            style={{ backgroundColor: lightNote ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.12)', border: `1px solid ${surfaceBorder}` }}
          >
            <div className={`${compact ? 'text-[0.58em]' : 'text-[0.62em]'} leading-none whitespace-nowrap`} style={{ color: mutedColor }}>
              {compact
                ? (event.startDate ? `${Number(event.startDate.slice(5, 7))}月` : '')
                : (event.startDate ? `${Number(event.startDate.slice(5, 7))}月` : '')}
            </div>
            <div className={`${compact ? 'text-[0.82em]' : 'text-[0.95em]'} font-semibold leading-tight`} style={{ color: noteTextColor }}>
              {event.startDate ? Number(event.startDate.slice(8, 10)) : '?'}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className={`${compact ? 'text-[0.82em]' : 'text-[0.98em]'} font-bold truncate`} style={{ color: noteTextColor }}>{event.title}</div>
            <div className={`${compact ? 'text-[0.68em]' : 'text-[0.78em]'} flex min-w-0 items-center gap-1 mt-0.5 whitespace-nowrap overflow-hidden`} style={{ color: mutedColor }}>
              <Clock size={compact ? 8 : 9} className="shrink-0" />
              {isRecurring && (
                <span className="echo-recurring-chip shrink-0 inline-flex items-center gap-0.5 rounded px-1">
                  <Repeat size={compact ? 8 : 9} />
                  循环
                </span>
              )}
              <span className="truncate">{event.isAllDay ? '全天' : (event.startTime || '未设时间')}</span>
              {event.endDate && event.endDate !== event.startDate && (
                <span className="shrink-0"> · 至 {compact ? formatDateShort(event.endDate) : event.endDate}</span>
              )}
            </div>
          </div>

          {/* Color dot */}
          <div className="w-1.5 h-1.5 rounded-full shrink-0 opacity-40 group-hover:opacity-75 transition-opacity" style={{ backgroundColor: event.color }} />
        </button>
        )
      })}
    </div>
  )
}
