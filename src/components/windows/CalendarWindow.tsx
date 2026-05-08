import { useEffect, useState, useRef } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import { useAppStore } from '@/stores/app.store'
import { useTagStore } from '@/stores/tag.store'
import type { CalendarEvent } from '@/types/calendar.types'
import type { Note, CountdownItem } from '@/types/notes.types'
import { ChevronLeft, ChevronRight, Plus, X, Settings } from 'lucide-react'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import { useAppSettings } from '@/hooks/useAppSettings'
import { EventForm } from '@/components/calendar/EventForm'
import { EventDetailModal } from '@/components/calendar/EventDetailModal'
import { DayEventsModal } from '@/components/calendar/DayEventsModal'
import { DockArea } from '@/components/dock/DockArea'
import { DEFAULT_NOTE_COLOR, hexToLuminance, isLightColor, normalizeHexColor, normalizeNote } from '@/lib/utils'

function noteIdFromDataFile(fileName: string): string {
  return fileName.replace(/\.json$/, '').replace(/^note_/, '')
}

function normalizePersistedNote(raw: unknown, fallbackId: string): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  return normalizeNote({
    ...record,
    id: typeof record.id === 'string' && record.id.trim() ? record.id : fallbackId,
  })
}

const DOCK_HEIGHT_STORAGE_KEY = 'oknote.calendarDockHeight'
const DEFAULT_DOCK_HEIGHT = 260
const MIN_DOCK_HEIGHT = 150
const MIN_CALENDAR_CONTENT_HEIGHT = 190
const COMPACT_MIN_DOCK_HEIGHT = 118
const COMPACT_MIN_CALENDAR_CONTENT_HEIGHT = 170

function getViewportSize() {
  if (typeof window === 'undefined') return { width: 900, height: 760 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function getCalendarDensity(width: number, height: number): number {
  const widthScale = width < 520 ? 0.78 : width < 700 ? 0.86 : width < 900 ? 0.93 : 1
  const heightScale = height < 560 ? 0.78 : height < 700 ? 0.86 : height < 850 ? 0.94 : 1
  return Math.min(widthScale, heightScale)
}

function getDockHeightLimits(viewportHeight: number) {
  const compact = viewportHeight < 650
  const min = compact ? COMPACT_MIN_DOCK_HEIGHT : MIN_DOCK_HEIGHT
  const minCalendar = compact ? COMPACT_MIN_CALENDAR_CONTENT_HEIGHT : MIN_CALENDAR_CONTENT_HEIGHT
  const ratioMax = Math.round(viewportHeight * (compact ? 0.34 : 0.42))
  return {
    min,
    max: Math.max(min, Math.min(460, viewportHeight - minCalendar, ratioMax)),
  }
}

function getInitialDockHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_DOCK_HEIGHT
  const saved = Number(window.localStorage.getItem(DOCK_HEIGHT_STORAGE_KEY))
  const limits = getDockHeightLimits(window.innerHeight)
  const value = Number.isFinite(saved) ? saved : DEFAULT_DOCK_HEIGHT
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)))
}

function isDefaultTextColor(value: string): boolean {
  return ['#e2e8f0', '#1a1a2e', '#111827', '#f8fafc'].includes(value.toLowerCase())
}

function getAdaptiveCalendarTextColor(backgroundColor: string, opacity: number, configuredTextColor: string): string {
  if (configuredTextColor && !isDefaultTextColor(configuredTextColor)) return configuredTextColor
  if (opacity < 0.42) return '#f8fafc'
  const luminance = hexToLuminance(normalizeHexColor(backgroundColor))
  return luminance > 0.52 ? '#111827' : '#f8fafc'
}

function getAdaptiveTextShadow(textColor: string, opacity: number): string {
  const lightText = textColor.toLowerCase() !== '#111827' && textColor.toLowerCase() !== '#1f2937'
  const outline = lightText ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.54)'
  const soft = lightText ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.28)'
  return opacity < 0.65
    ? `0 1px 1px ${outline}, 0 0 4px ${soft}`
    : `0 1px 1px ${soft}`
}

export function CalendarWindow() {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const goPrevMonth = useCalendarStore((s) => s.goPrevMonth)
  const goNextMonth = useCalendarStore((s) => s.goNextMonth)
  const goToday = useCalendarStore((s) => s.goToday)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const closeEventForm = useCalendarStore((s) => s.closeEventForm)
  const isEventFormOpen = useCalendarStore((s) => s.isEventFormOpen)
  const multiDayMode = useCalendarStore((s) => s.multiDayMode)
  const setMultiDayMode = useCalendarStore((s) => s.setMultiDayMode)

  const { settings, themeMode } = useAppSettings('calendar')
  const [isDayEventsOpen, setIsDayEventsOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [showNoteCreateMenu, setShowNoteCreateMenu] = useState(false)
  const [calendarCollapsed, setCalendarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [dockHeight, setDockHeight] = useState(getInitialDockHeight)
  const [visibleTitleActions, setVisibleTitleActions] = useState(3)
  const [viewportSize, setViewportSize] = useState(getViewportSize)
  const didRestoreRef = useRef(false)
  const titlebarRef = useRef<HTMLDivElement>(null)
  const monthNavRef = useRef<HTMLDivElement>(null)
  const measureTodayActionRef = useRef<HTMLButtonElement>(null)
  const measureEventActionRef = useRef<HTMLButtonElement>(null)
  const measureNoteActionRef = useRef<HTMLButtonElement>(null)
  const noteCreateMenuRef = useRef<HTMLDivElement>(null)
  const dockHeightRef = useRef(dockHeight)
  const preferredDockHeightRef = useRef(dockHeight)
  const calendarCollapsedRef = useRef(false)
  const dockResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const tags = useTagStore((s) => s.tags)

  const calendarDensity = getCalendarDensity(viewportSize.width, viewportSize.height)
  const effectiveFontSize = Math.max(11, Math.round(settings.fontSize * calendarDensity * 10) / 10)
  const isCompactDensity = calendarDensity < 0.93

  useEffect(() => {
    document.documentElement.style.fontSize = `${effectiveFontSize}px`
    return () => { document.documentElement.style.fontSize = '' }
  }, [effectiveFontSize])

  useEffect(() => {
    document.documentElement.classList.toggle('light', themeMode === 'light')
    document.documentElement.classList.add('electron-transparent')
  }, [themeMode])

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      return window.electronAPI.onAction((action) => {
        if (action === 'new-event') {
          setMultiDayMode(false)
          openEventForm(null)
        }
      })
    }
  }, [openEventForm, setMultiDayMode])

  useEffect(() => {
    if (!showNoteCreateMenu) return
    const handler = (event: MouseEvent) => {
      if (!noteCreateMenuRef.current?.contains(event.target as Node)) {
        setShowNoteCreateMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNoteCreateMenu])

  useEffect(() => {
    const updateTitleActions = () => {
      const titlebar = titlebarRef.current
      const monthNav = monthNavRef.current
      if (!titlebar || !monthNav) return

      const titlebarRect = titlebar.getBoundingClientRect()
      const monthRect = monthNav.getBoundingClientRect()
      const paddingLeft = Number.parseFloat(window.getComputedStyle(titlebar).paddingLeft) || 0
      const leftAvailable = Math.max(0, monthRect.left - titlebarRect.left - paddingLeft - 2)
      const gap = 4
      const widths = [
        measureTodayActionRef.current?.getBoundingClientRect().width || 52,
        measureEventActionRef.current?.getBoundingClientRect().width || 66,
        measureNoteActionRef.current?.getBoundingClientRect().width || 66,
      ].map(Math.ceil)
      const required = (count: number) => (
        widths.slice(0, count).reduce((sum, width) => sum + width, 0) + Math.max(0, count - 1) * gap
      )
      const showBuffer = 10

      setVisibleTitleActions((current) => {
        let next = current
        while (next > 0 && required(next) > leftAvailable) next -= 1
        while (next < 3 && required(next + 1) <= leftAvailable - showBuffer) next += 1
        return current === next ? current : next
      })
    }

    let frame = 0
    const scheduleTitleActionsUpdate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateTitleActions()
      })
    }

    scheduleTitleActionsUpdate()
    const observer = new ResizeObserver(scheduleTitleActionsUpdate)
    if (titlebarRef.current) observer.observe(titlebarRef.current)
    if (monthNavRef.current) observer.observe(monthNavRef.current)
    window.addEventListener('resize', scheduleTitleActionsUpdate)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleTitleActionsUpdate)
    }
  }, [effectiveFontSize, viewMode])

  useEffect(() => {
    const updateViewportSize = () => setViewportSize(getViewportSize())
    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    return () => window.removeEventListener('resize', updateViewportSize)
  }, [])

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      const unsub1 = window.electronAPI.onEchoEventCreated((eventData: unknown) => {
        const ev = eventData as CalendarEvent
        useCalendarStore.getState().addEvent(ev)
      })
      const unsub2 = window.electronAPI.onToggleCollapse((collapsed: boolean) => {
        calendarCollapsedRef.current = collapsed
        setCalendarCollapsed(collapsed)
      })
      const unsub3 = window.electronAPI.onEventsChanged((data) => {
        if (Array.isArray(data?.events)) {
          useCalendarStore.getState().loadEvents(data.events as CalendarEvent[])
          return
        }
        // Reload events from disk (e.g. after tag deletion cascades)
        window.electronAPI!.loadAppData('events').then((data) => {
          if (Array.isArray(data)) {
            useCalendarStore.getState().loadEvents(data as CalendarEvent[])
          }
        })
      })
      const unsub4 = window.electronAPI.onTagsChanged(() => {
        // Reload tags from disk (e.g. after creating/editing tags in settings)
        window.electronAPI!.getTags().then((data) => {
          if (Array.isArray(data)) {
            useTagStore.getState().loadTags(data as import('@/types/tag.types').EventTag[])
          }
        })
      })
      const unsub5 = window.electronAPI.onNotesChanged(() => {
        // Reload notes from disk (e.g. after dock/undock)
        window.electronAPI!.listAppData('note_').then((files) => {
          Promise.all(files.map((f) => window.electronAPI!.loadAppData(f.replace('.json', ''))))
            .then((rawNotes) => {
              const normalized = rawNotes
                .map((raw, index) => normalizePersistedNote(raw, noteIdFromDataFile(files[index])))
                .filter((note): note is Note => !!note)
              useNotesStore.getState().loadNotes(normalized)
            })
            .catch(() => {})
        }).catch(() => {})
      })
      const unsub6 = window.electronAPI.onDayContextAction((payload) => {
        if (!payload?.dateStr) return
        useCalendarStore.getState().setCurrentDate(new Date(payload.dateStr + 'T00:00:00'))
        setMultiDayMode(payload.mode === 'multi')
        openEventForm(null)
      })
      const unsub7 = window.electronAPI.onOpenEventEditor(async (eventData) => {
        if (!eventData || typeof eventData !== 'object') return
        const event = eventData as CalendarEvent
        if (!event.id) return
        const latest = await window.electronAPI!.loadAppData('events')
        if (Array.isArray(latest)) {
          useCalendarStore.getState().loadEvents(latest as CalendarEvent[])
          const currentEvent = (latest as CalendarEvent[]).find((item) => item.id === event.id)
          if (!currentEvent) return
          setMultiDayMode(!!(currentEvent.endDate && currentEvent.endDate !== currentEvent.startDate))
          openEventForm(currentEvent)
          return
        }
        setMultiDayMode(!!(event.endDate && event.endDate !== event.startDate))
        openEventForm(event)
      })
      return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7() }
    }
  }, [openEventForm, setMultiDayMode])

  // Load persisted data on mount (events, notes, countdowns, tags)
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    let cancelled = false

    const loadNotesData = async (): Promise<Note[]> => {
      const files = await window.electronAPI!.listAppData('note_')
      if (cancelled) return []
      if (files.length > 0) {
        const notes: Note[] = []
        for (const f of files) {
          const rawKey = f.replace('.json', '')
          const data = await window.electronAPI!.loadAppData(rawKey)
          if (cancelled) return []
          const normalized = normalizePersistedNote(data, noteIdFromDataFile(f))
          if (normalized) {
            notes.push(normalized)
            window.electronAPI!.saveAppData(`note_${normalized.id}`, normalized)
          }
        }
        return notes
      }
      // Fallback: load legacy notes.json
      const data = await window.electronAPI!.loadAppData('notes')
      if (cancelled) return []
      if (Array.isArray(data) && data.length > 0) {
        const validNotes = data
          .map((raw, index) => normalizePersistedNote(raw, `legacy_${index}`))
          .filter((note): note is Note => !!note)
        if (validNotes.length > 0) {
          await Promise.all(validNotes.map((n: Note) => window.electronAPI!.saveAppData(`note_${n.id}`, n)))
        }
        window.electronAPI!.deleteAppData('notes')
        return validNotes
      }
      return []
    }

    Promise.all([
      window.electronAPI.loadAppData('events').then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) {
          useCalendarStore.getState().loadEvents(data as CalendarEvent[])
        }
      }),
      loadNotesData().then((notes) => {
        if (cancelled) return
        useNotesStore.getState().loadNotes(notes)
      }),
      window.electronAPI.loadAppData('countdowns').then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) {
          useNotesStore.getState().loadCountdowns(data as CountdownItem[])
        }
      }),
      window.electronAPI.getTags().then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) {
          useTagStore.getState().loadTags(data as import('@/types/tag.types').EventTag[])
        }
      }),
    ]).then(() => {
      if (cancelled) return
      useAppStore.getState().setDataReady()
      const allNotes = useNotesStore.getState().notes

      // Auto-create default view note if not exists
      if (!allNotes.find((n: Note) => n.noteType === 'view')) {
        const viewNote: Note = {
          id: 'note_view_default',
          title: '视图',
          color: DEFAULT_NOTE_COLOR,
          items: [],
          transparency: 0.88,
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          noteType: 'view' as const,
          viewTagIds: [],
          isDocked: true,
          isPinned: false,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        useNotesStore.getState().addNote(viewNote)
        window.electronAPI!.saveAppData(`note_note_view_default`, viewNote)
      }

      // Only restore undocked notes as windows (docked notes render in calendar)
      const undockedIds = allNotes.filter((n: Note) => !n.isDocked && !n.isHidden).map((n: Note) => n.id)
      if (undockedIds.length > 0 && !didRestoreRef.current) {
        didRestoreRef.current = true
        window.electronAPI!.restoreNotes(undockedIds)
      }
    }).catch((err) => {
      if (cancelled) return
      console.error('Data loading failed:', err)
      useAppStore.getState().setDataReady()
    })

    return () => { cancelled = true }
  }, [])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1
  const monthValue = `${year}-${String(month).padStart(2, '0')}`
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
  const titleText = viewMode === 'week'
    ? `${format(weekStart, 'M月d日')} - ${format(weekEnd, 'M月d日')}`
    : `${year}年${month}月`
  const bgHex = settings.backgroundColor.replace('#', '')
  const bgWithAlpha = `#${bgHex}${Math.round(settings.backgroundOpacity * 255).toString(16).padStart(2, '0')}`
  const calendarTextColor = getAdaptiveCalendarTextColor(settings.backgroundColor, settings.backgroundOpacity, settings.textColor)
  const calendarTextShadow = getAdaptiveTextShadow(calendarTextColor, settings.backgroundOpacity)

  const cellBorderColor = isLightColor(settings.backgroundColor)
    ? 'rgba(0,0,0,0.18)'
    : 'rgba(255,255,255,0.20)'

  const lightBg = isLightColor(settings.backgroundColor)
  const holidayStripeColor = lightBg
    ? 'rgba(220, 38, 38, 0.18)'
    : 'rgba(255, 126, 126, 0.24)'
  const holidayTextColor = lightBg
    ? 'rgba(180, 30, 30, 0.85)'
    : 'rgba(255, 140, 140, 0.85)'
  const eventTextColor = calendarTextColor
  const handlePrev = () => {
    if (viewMode === 'month') {
      goPrevMonth()
      return
    }
    const next = new Date(currentDate)
    next.setDate(next.getDate() - 7)
    useCalendarStore.getState().setCurrentDate(next)
  }
  const handleNext = () => {
    if (viewMode === 'month') {
      goNextMonth()
      return
    }
    const next = new Date(currentDate)
    next.setDate(next.getDate() + 7)
    useCalendarStore.getState().setCurrentDate(next)
  }
  const clampDockHeight = (height: number) => {
    const limits = getDockHeightLimits(window.innerHeight)
    return Math.round(Math.min(limits.max, Math.max(limits.min, height)))
  }
  const handleDockResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dockResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: dockHeight,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('resizing-dock')
  }
  const handleDockResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dockResizeRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextHeight = clampDockHeight(drag.startHeight - (event.clientY - drag.startY))
    dockHeightRef.current = nextHeight
    preferredDockHeightRef.current = nextHeight
    setDockHeight(nextHeight)
  }
  const finishDockResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dockResizeRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dockResizeRef.current = null
    document.body.classList.remove('resizing-dock')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    window.localStorage.setItem(DOCK_HEIGHT_STORAGE_KEY, String(preferredDockHeightRef.current))
  }

  useEffect(() => {
    dockHeightRef.current = dockHeight
  }, [dockHeight])

  useEffect(() => {
    const handleResize = () => {
      if (calendarCollapsedRef.current) return
      setDockHeight(() => {
        const next = clampDockHeight(preferredDockHeightRef.current)
        dockHeightRef.current = next
        return next
      })
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      document.body.classList.remove('resizing-dock')
    }
  }, [])

  return (
    <div
      className={`calendar-window relative h-screen w-screen flex flex-col select-none ${calendarCollapsed ? 'calendar-collapsed' : ''} ${isCompactDensity ? 'calendar-density-compact' : ''}`}
      style={{
        fontFamily: `"${settings.fontFamily}", system-ui, sans-serif`,
        color: calendarTextColor,
        ['--calendar-text' as string]: calendarTextColor,
        ['--calendar-text-shadow' as string]: calendarTextShadow,
        ['--calendar-density' as string]: calendarDensity,
      }}
    >
      {/* Background overlay */}
      <div className="cal-window-bg absolute inset-0 z-0" style={{ backgroundColor: bgWithAlpha }} />

      {/* Title bar */}
      <div
        ref={titlebarRef}
        className="cal-titlebar relative z-[60] items-center px-4 py-2.5 shrink-0 border-b"
        style={{ WebkitAppRegion: 'drag', borderColor: `${calendarTextColor}18` } as React.CSSProperties}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <div className="cal-left-actions-measure" aria-hidden="true">
          <button ref={measureTodayActionRef} className="cal-action cal-action-today px-2.5 py-1 text-[0.8em] rounded-md border">
            <span className="cal-action-label">今天</span>
          </button>
          <button ref={measureEventActionRef} className="cal-action cal-action-event px-2.5 py-1 text-[0.8em] rounded-md border flex items-center gap-1">
            <Plus size={11} />
            <span className="cal-action-label">事件</span>
          </button>
          <button ref={measureNoteActionRef} className="cal-action cal-action-note px-2.5 py-1 text-[0.8em] rounded-md border flex items-center gap-1">
            <Plus size={11} />
            <span className="cal-action-label">便签</span>
          </button>
        </div>
        {/* Left: actions */}
        <div className="cal-left-actions flex items-center gap-1 calendar-text-readable" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={goToday}
            className={`cal-action cal-action-today px-2.5 py-1 text-[0.8em] rounded-md opacity-50 hover:opacity-80 transition-opacity border ${visibleTitleActions >= 1 ? '' : 'cal-action-hidden'}`}
            style={{ borderColor: `${calendarTextColor}18` }}
          >
            <span className="cal-action-label">今天</span>
          </button>
          <button
            onClick={() => { setMultiDayMode(false); openEventForm(null) }}
            className={`cal-action cal-action-event px-2.5 py-1 text-[0.8em] rounded-md opacity-50 hover:opacity-80 transition-opacity border flex items-center gap-1 ${visibleTitleActions >= 2 ? '' : 'cal-action-hidden'}`}
            style={{ borderColor: `${calendarTextColor}18` }}
          >
            <Plus size={11} />
            <span className="cal-action-label">事件</span>
          </button>
          <div ref={noteCreateMenuRef} className="relative">
            <button
              onClick={() => setShowNoteCreateMenu((open) => !open)}
              className={`cal-action cal-action-note px-2.5 py-1 text-[0.8em] rounded-md opacity-50 hover:opacity-80 transition-opacity border flex items-center gap-1 ${visibleTitleActions >= 3 ? '' : 'cal-action-hidden'}`}
              style={{ borderColor: `${calendarTextColor}18` }}
            >
              <Plus size={11} />
              <span className="cal-action-label">便签</span>
            </button>
            {showNoteCreateMenu && (
              <div
                className="absolute left-0 top-full mt-1 w-56 rounded-xl border p-2 shadow-2xl z-[10000]"
                style={{
                  backgroundColor: lightBg ? 'rgba(255,255,255,0.98)' : 'rgba(13,13,16,0.96)',
                  borderColor: lightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.16)',
                  color: calendarTextColor,
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                }}
              >
                <button
                  onClick={() => {
                    window.electronAPI?.createNote({ noteType: 'independent' })
                    setShowNoteCreateMenu(false)
                  }}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-white/10 transition-colors"
                >
                  <div className="font-medium opacity-80">独立便签</div>
                  <div className="mt-0.5 text-[0.85em] opacity-35">待办与自由记录</div>
                </button>
                <button
                  onClick={() => {
                    window.electronAPI?.createNote({ noteType: 'daily', title: '每日待办' })
                    setShowNoteCreateMenu(false)
                  }}
                  className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-white/10 transition-colors"
                >
                  <div className="font-medium opacity-80">每日待办</div>
                  <div className="mt-0.5 text-[0.85em] opacity-35">按日期查看历史待办</div>
                </button>
                <div className="my-1 border-t" style={{ borderColor: `${calendarTextColor}18` }} />
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest opacity-30">视图便签</div>
                <div className="px-2.5 pb-1 text-[10px] leading-relaxed opacity-40">显示指定标签的事件</div>
                <div className="max-h-40 overflow-y-auto">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => {
                        window.electronAPI?.createNote({ noteType: 'echo', echoTagId: tag.id, title: tag.name, color: tag.color })
                        setShowNoteCreateMenu(false)
                      }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-white/10 transition-colors flex items-center gap-2"
                    >
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  ))}
                  {tags.length === 0 && (
                    <div className="px-2.5 py-2 text-xs opacity-30">暂无标签，请先在设置中创建</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center: navigation arrows + month title + picker */}
        <div
          ref={monthNavRef}
          className="cal-month-nav relative z-[70] flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
        >
          <button
            onClick={handlePrev}
            className="cal-chevron-left w-7 h-7 rounded-lg flex items-center justify-center opacity-40 hover:opacity-80 hover:bg-white/5 transition-all"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="calendar-text-readable text-sm font-semibold tracking-wide opacity-85 min-w-[90px] text-center hover:opacity-100 hover:bg-white/5 rounded-lg px-2 py-0.5 transition-all relative"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {titleText}
          </button>
          <button
            onClick={handleNext}
            className="cal-chevron-right w-7 h-7 rounded-lg flex items-center justify-center opacity-40 hover:opacity-80 hover:bg-white/5 transition-all"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ChevronRight size={17} />
          </button>

          {/* Year/Month Picker */}
          {showPicker && (
            <>
              <div className="fixed inset-0 z-[9998]" onClick={() => setShowPicker(false)} />
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-[9999] border rounded-xl shadow-2xl p-4 w-[320px]"
                style={{
                  backgroundColor: lightBg ? 'rgba(255,255,255,0.98)' : 'rgba(13,13,16,0.96)',
                  borderColor: lightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.16)',
                  color: calendarTextColor,
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  boxShadow: lightBg ? '0 22px 60px rgba(20, 24, 32, 0.20)' : '0 22px 60px rgba(0, 0, 0, 0.45)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest opacity-35 mb-2 text-center">快速跳转</div>
                  <input
                    type="month"
                    value={monthValue}
                    onChange={(e) => {
                      if (!e.target.value) return
                      const [nextYear, nextMonth] = e.target.value.split('-').map(Number)
                      if (!nextYear || !nextMonth) return
                      useCalendarStore.getState().setCurrentDate(new Date(nextYear, nextMonth - 1, 1))
                    }}
                    className="w-full rounded-lg border bg-white/80 px-3 py-2 text-center text-sm font-semibold outline-none transition-colors focus:border-primary/50 dark:bg-black/25"
                    style={{ borderColor: `${calendarTextColor}20`, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  />
                </div>
                <div className="mb-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest opacity-35 mb-2 text-center">年份</div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: 21 }, (_, i) => year - 10 + i).map((y) => (
                      <button
                        key={y}
                        onClick={() => {
                          const newDate = new Date(currentDate)
                          newDate.setDate(1)
                          newDate.setFullYear(y)
                          useCalendarStore.getState().setCurrentDate(newDate)
                        }}
                        className={`py-1.5 text-xs rounded-md transition-all ${
                          y === year
                            ? 'bg-primary/20 text-primary font-semibold'
                            : 'opacity-50 hover:opacity-90 hover:bg-white/5'
                        }`}
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest opacity-35 mb-2 text-center">月份</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          const newDate = new Date(currentDate)
                          newDate.setDate(1)
                          newDate.setMonth(m - 1)
                          useCalendarStore.getState().setCurrentDate(newDate)
                        }}
                        className={`py-1.5 text-xs rounded-md transition-all ${
                          m === month
                            ? 'bg-primary/20 text-primary font-semibold'
                            : 'opacity-50 hover:opacity-90 hover:bg-white/5'
                        }`}
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        {m}月
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: settings + close */}
        <div className="cal-right-actions calendar-text-readable flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="cal-view-switch mr-1 flex rounded-md border p-0.5" style={{ borderColor: `${calendarTextColor}18` }}>
            {(['month', 'week'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2 py-0.5 text-[0.72em] rounded transition-all ${
                  viewMode === mode ? 'bg-primary/20 text-primary opacity-90' : 'opacity-30 hover:opacity-70'
                }`}
                title={mode === 'month' ? '月视图' : '周视图'}
              >
                {mode === 'month' ? '月' : '周'}
              </button>
            ))}
          </div>
          <button onClick={() => window.electronAPI?.openSettings()} className="w-6 h-6 rounded flex items-center justify-center opacity-35 hover:opacity-75 transition-all" title="设置">
            <Settings size={13} />
          </button>
          <button onClick={() => window.electronAPI?.closeWindow()} className="w-6 h-6 rounded flex items-center justify-center opacity-35 hover:opacity-80 hover:text-red-400 transition-all">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="cal-main-content relative z-[30] flex-1 flex flex-col overflow-hidden px-3 pb-3">
        <div className="flex-1 overflow-hidden">
          <MonthGrid compact viewMode={viewMode} cellBorderColor={cellBorderColor} holidayStripeColor={holidayStripeColor} holidayTextColor={holidayTextColor} eventTextColor={eventTextColor} onDayDoubleClick={() => setIsDayEventsOpen(true)} />
        </div>
      </div>

      {/* Dock area with view note panel + carousel */}
      <div
        className={`dock-resizer relative z-[45] h-2 shrink-0 cursor-row-resize ${isEventFormOpen ? 'dock-resizer-disabled' : ''}`}
        style={{ WebkitAppRegion: 'no-drag', borderColor: `${calendarTextColor}18` } as React.CSSProperties}
        onPointerDown={handleDockResizeStart}
        onPointerMove={handleDockResizeMove}
        onPointerUp={finishDockResize}
        onPointerCancel={finishDockResize}
        title="拖动调整挂载区高度"
      >
        <div className="dock-resizer-line absolute left-0 right-0 top-1/2 h-px -translate-y-1/2" />
        <div className="dock-resizer-grip absolute left-1/2 top-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      </div>
      <DockArea height={dockHeight} />

      {/* Modals */}
      <EventDetailModal />
      <DayEventsModal isOpen={isDayEventsOpen} onClose={() => setIsDayEventsOpen(false)} />
      {isEventFormOpen && (
        <EventForm
          onClose={closeEventForm}
          initialMultiDay={multiDayMode}
        />
      )}
    </div>
  )
}
