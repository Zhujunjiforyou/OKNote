import { useState, useEffect } from 'react'
import type { CalendarEvent } from '@/types/calendar.types'
import type { Note } from '@/types/notes.types'
import { useTagStore } from '@/stores/tag.store'
import { useCalendarStore } from '@/stores/calendar.store'
import { Clock } from 'lucide-react'
import { hexToLuminance, normalizeHexColor } from '@/lib/utils'

interface EchoEventListProps {
  note: Note
  onSelectEvent?: (event: CalendarEvent) => void
  compact?: boolean
}

function readableTextOn(hex: string): string {
  const luminance = hexToLuminance(normalizeHexColor(hex))
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#111827' : '#f8fafc'
}

export function EchoEventList({ note, onSelectEvent, compact = false }: EchoEventListProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const calendarEvents = useCalendarStore((s) => s.events)
  const getTagById = useTagStore((s) => s.getTagById)
  const selectedTagIds = Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
    ? note.viewTagIds
    : (note.echoTagId ? [note.echoTagId] : [])
  const selectedTagKey = selectedTagIds.join('|')
  const selectedTags = selectedTagIds.map((tagId) => getTagById(tagId)).filter(Boolean)
  const noteTextColor = readableTextOn(note.color)
  const lightNote = noteTextColor === '#111827'
  const surfaceBg = lightNote ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.42)'
  const surfaceBorder = lightNote ? 'rgba(17,24,39,0.16)' : 'rgba(255,255,255,0.18)'
  const mutedColor = lightNote ? 'rgba(17,24,39,0.72)' : 'rgba(248,250,252,0.78)'
  const formatDateShort = (dateStr?: string) => {
    if (!dateStr) return ''
    const [, month = '', day = ''] = dateStr.split('-')
    return month && day ? `${Number(month)}/${Number(day)}` : dateStr
  }
  const applyEventsSnapshot = (snapshot: unknown[]) => {
    const merged = new Map<string, CalendarEvent>()
    for (const event of snapshot as CalendarEvent[]) {
      if (!event?.id || !event.tagId || !selectedTagIds.includes(event.tagId)) continue
      merged.set(event.id, event)
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
        for (const event of data as CalendarEvent[]) {
          merged.set(event.id, event)
        }
      }
      setEvents([...merged.values()])
    } catch (e) {
      console.error('EchoEventList loadEvents failed:', e)
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

  // Sort: future dates first, then by startDate descending, then by time
  const sorted = [...events].sort((a, b) => {
    const sa = typeof a.startDate === 'string' ? a.startDate : ''
    const sb = typeof b.startDate === 'string' ? b.startDate : ''
    const dateCompare = sa.localeCompare(sb)
    if (dateCompare !== 0) return dateCompare
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
    if (a.startTime) return -1
    if (b.startTime) return 1
    return 0
  })

  if (events.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
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
      {sorted.map((event) => (
        <button
          key={event.id}
          onClick={() => onSelectEvent?.(event)}
          className={`w-full min-w-0 text-left rounded-lg border transition-colors flex items-center group echo-event-item ${compact ? 'px-2 py-1.5 gap-2' : 'px-2.5 py-2 gap-2.5'}`}
          style={{ borderColor: surfaceBorder, backgroundColor: surfaceBg, color: noteTextColor }}
        >
          {/* Date badge */}
          <div
            className={`shrink-0 text-center rounded-md ${compact ? 'w-8 py-0.5' : 'w-10 py-1'}`}
            style={{ backgroundColor: lightNote ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.28)', border: `1px solid ${surfaceBorder}` }}
          >
            <div className={`${compact ? 'text-[0.58em]' : 'text-[0.62em]'} leading-none whitespace-nowrap`} style={{ color: mutedColor }}>
              {compact
                ? (event.startDate ? `${Number(event.startDate.slice(5, 7))}月` : '')
                : (event.startDate ? new Date(event.startDate).toLocaleDateString('zh-CN', { month: 'short' }) : '')}
            </div>
            <div className={`${compact ? 'text-[0.82em]' : 'text-[0.95em]'} font-semibold leading-tight`} style={{ color: noteTextColor }}>
              {event.startDate ? new Date(event.startDate).getDate() : '?'}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className={`${compact ? 'text-[0.82em]' : 'text-[0.98em]'} font-bold truncate`} style={{ color: noteTextColor }}>{event.title}</div>
            <div className={`${compact ? 'text-[0.68em]' : 'text-[0.78em]'} flex min-w-0 items-center gap-1 mt-0.5 whitespace-nowrap overflow-hidden`} style={{ color: mutedColor }}>
              <Clock size={compact ? 8 : 9} className="shrink-0" />
              <span className="truncate">{event.isAllDay ? '全天' : (event.startTime || '未设时间')}</span>
              {event.endDate && event.endDate !== event.startDate && (
                <span className="shrink-0"> · 至 {compact ? formatDateShort(event.endDate) : event.endDate}</span>
              )}
            </div>
          </div>

          {/* Color dot */}
          <div className="w-1.5 h-1.5 rounded-full shrink-0 opacity-40 group-hover:opacity-75 transition-opacity" style={{ backgroundColor: event.color }} />
        </button>
      ))}
    </div>
  )
}
