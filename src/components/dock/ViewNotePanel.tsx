import { useMemo } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { Clock } from 'lucide-react'
import { useAppSettings } from '@/hooks/useAppSettings'
import { isLightColor } from '@/lib/utils'

export function ViewNotePanel() {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const selectedDate = useCalendarStore((s) => s.selectedDate)
  const events = useCalendarStore((s) => s.events)
  const viewNoteTagFilter = useCalendarStore((s) => s.viewNoteTagFilter)
  const toggleViewNoteTag = useCalendarStore((s) => s.toggleViewNoteTag)
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const tags = useTagStore((s) => s.tags)
  const { settings } = useAppSettings('calendar')
  const lightBg = isLightColor(settings.backgroundColor)
  const panelBg = lightBg ? 'rgba(15,23,42,0.045)' : 'rgba(255,255,255,0.055)'
  const panelBorder = lightBg ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255,255,255,0.12)'
  const chipBg = lightBg ? 'rgba(15,23,42,0.075)' : 'rgba(255,255,255,0.10)'
  const activeChipBg = lightBg ? 'rgba(37,99,235,0.16)' : 'rgba(96,165,250,0.20)'
  const activeChipColor = lightBg ? '#1d4ed8' : '#93c5fd'
  const readableText = 'var(--calendar-text)'
  const mutedText = 'color-mix(in srgb, var(--calendar-text) 72%, transparent)'

  const displayDate = selectedDate || format(currentDate, 'yyyy-MM-dd')
  const dateLabel = useMemo(() => {
    try {
      const d = new Date(displayDate + 'T00:00:00')
      return format(d, 'M月d日 EEEE', { locale: zhCN })
    } catch {
      return displayDate
    }
  }, [displayDate])

  // Filter events for the selected date, with optional tag filter
  const filteredEvents = useMemo(() => {
    const dayEvents = events.filter((ev) => {
      if (ev.endDate && ev.endDate !== ev.startDate) {
        return displayDate >= ev.startDate && displayDate <= ev.endDate
      }
      return ev.startDate === displayDate
    })
    if (viewNoteTagFilter.length === 0) return dayEvents
    return dayEvents.filter((ev) => ev.tagId && viewNoteTagFilter.includes(ev.tagId))
  }, [events, displayDate, viewNoteTagFilter])

  return (
    <div
      className="view-note-panel relative flex flex-col w-[300px] shrink-0 border-r"
      style={{ borderColor: panelBorder, backgroundColor: panelBg, color: readableText }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="text-[0.78em] font-semibold opacity-75">{dateLabel}</div>
        <div className="mt-0.5 text-[0.66em] opacity-48">{filteredEvents.length} 个事件</div>
      </div>

      {/* Tag filter bar */}
      <div className="px-3 pb-2 flex flex-wrap gap-1.5 shrink-0">
        <button
          onClick={() => useCalendarStore.getState().setViewNoteTagFilter([])}
          className="px-2.5 py-1 rounded-full text-[0.66em] transition-colors"
          style={{
            backgroundColor: viewNoteTagFilter.length === 0 ? activeChipBg : chipBg,
            color: viewNoteTagFilter.length === 0 ? activeChipColor : readableText,
            opacity: viewNoteTagFilter.length === 0 ? 1 : 0.62,
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
              className="px-2.5 py-1 rounded-full text-[0.66em] transition-colors flex items-center gap-1.5"
              style={{
                backgroundColor: isActive ? `${tag.color}26` : `${tag.color}14`,
                border: `1px solid ${isActive ? tag.color : `${tag.color}55`}`,
                color: readableText,
                opacity: isActive ? 1 : 0.62,
                boxShadow: isActive ? `0 0 0 1px ${tag.color}22 inset` : undefined,
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: tag.color, boxShadow: '0 0 0 1px rgba(255,255,255,0.65), 0 0 0 2px rgba(0,0,0,0.10)' }} />
              {tag.name}
            </button>
          )
        })}
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1.5">
        {filteredEvents.length === 0 ? (
          <div className="text-[0.72em] opacity-42 text-center py-7">当天无事件</div>
        ) : (
          filteredEvents.map((ev) => {
            const tag = ev.tagId ? tags.find((t) => t.id === ev.tagId) : null
            return (
              <button
                key={ev.id}
                onClick={() => selectEvent(ev.id)}
                className="w-full text-left px-2.5 py-2 rounded-md transition-colors flex items-center gap-2 group"
                style={{ backgroundColor: chipBg, color: readableText }}
              >
                <div className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: ev.color, boxShadow: '0 0 0 1px rgba(255,255,255,0.65), 0 0 0 2px rgba(0,0,0,0.10)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[0.76em] truncate leading-tight font-medium">{ev.title}</div>
                  <div className="flex items-center gap-1.5 text-[0.65em] mt-0.5" style={{ color: mutedText }}>
                    <Clock size={9} />
                    <span>{ev.isAllDay ? '全天' : ev.startTime || '未设时间'}</span>
                    {tag && (
                      <span
                        className="px-1 rounded text-[0.85em] max-w-[60px] truncate"
                        style={{ backgroundColor: `${tag.color}22`, border: `1px solid ${tag.color}66`, color: readableText }}
                      >
                        {tag.name}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
