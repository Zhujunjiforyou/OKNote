import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import { useAppStore } from '@/stores/app.store'
import { useTagStore } from '@/stores/tag.store'
import type { CalendarEvent } from '@/types/calendar.types'
import type { Note } from '@/types/notes.types'
import { Bell, ChevronLeft, ChevronRight, MoreHorizontal, Plus, X, Settings } from 'lucide-react'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import { clampFontSize, getAdaptiveDisplayFontSize } from '@/lib/typography'
import { useAppSettings } from '@/hooks/useAppSettings'
import { EventForm } from '@/components/calendar/EventForm'
import { EventDetailModal } from '@/components/calendar/EventDetailModal'
import { DayEventsModal } from '@/components/calendar/DayEventsModal'
import { DockArea } from '@/components/dock/DockArea'
import type { DockedNoteDraftKind } from '@/components/dock/DockedNoteCard'
import { ensureReadableTextColor, focusAdjacentInteractiveElement, isImeComposing, isLightColor, normalizeCalendarEvent, normalizeCalendarEvents, normalizeHexColor, normalizeNote } from '@/lib/utils'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'
import { useCurrentDateKey } from '@/hooks/useCurrentDateKey'
import { ReminderCenter, normalizeReminderHistoryEntries, type ReminderHistoryEntry } from '@/components/calendar/ReminderCenter'
import { reportPersistenceIssue } from '@/stores/persistence.store'
import type { WindowDraftEntry, WindowDraftKind } from '@/types/electron'

function normalizePersistedNote(raw: unknown, fallbackId: string, forceFallbackId = true): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const persistedId = typeof record.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(record.id)
    ? record.id
    : fallbackId
  return normalizeNote({
    ...record,
    id: forceFallbackId && fallbackId ? fallbackId : persistedId,
  })
}

function getViewNoteTagIds(note: Note): string[] {
  if (note.noteType !== 'echo') return []
  return [...new Set([
    ...(Array.isArray(note.viewTagIds) ? note.viewTagIds : []),
    note.echoTagId,
  ].filter((tagId): tagId is string => typeof tagId === 'string' && tagId.length > 0))]
}

function keepSingleDailyNote(notes: Note[]): Note[] {
  let hasDaily = false
  return notes.filter((note) => {
    if (note.noteType !== 'daily') return true
    if (hasDaily) return false
    hasDaily = true
    return true
  })
}

const DOCK_HEIGHT_STORAGE_KEY = 'oknote.calendarDockHeight'
const DEFAULT_DOCK_HEIGHT = 260
const MIN_DOCK_HEIGHT = 118
const MIN_CALENDAR_CONTENT_HEIGHT = 170
const COMPACT_MIN_DOCK_HEIGHT = 96
const COMPACT_MIN_CALENDAR_CONTENT_HEIGHT = 148
const MIN_SUPPORTED_YEAR = 1900
const MAX_SUPPORTED_YEAR = 2100
const NOTE_CREATE_MENU_ITEM_CLASS = 'w-full rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none'

function getViewportSize() {
  if (typeof window === 'undefined') return { width: 900, height: 760 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function getCalendarDensity(width: number, height: number): number {
  const widthScale = width < 480 ? 0.7 : width < 620 ? 0.8 : width < 780 ? 0.9 : width < 1000 ? 0.96 : 1
  const heightScale = height < 420 ? 0.68 : height < 560 ? 0.78 : height < 700 ? 0.88 : height < 850 ? 0.95 : 1
  return Math.min(widthScale, heightScale)
}

function getDockHeightLimits(viewportHeight: number) {
  const compact = viewportHeight < 620
  const min = compact ? COMPACT_MIN_DOCK_HEIGHT : MIN_DOCK_HEIGHT
  const minCalendar = compact ? COMPACT_MIN_CALENDAR_CONTENT_HEIGHT : MIN_CALENDAR_CONTENT_HEIGHT
  const ratioMax = Math.round(viewportHeight * (compact ? 0.42 : 0.5))
  return {
    min,
    max: Math.max(min, Math.min(720, viewportHeight - minCalendar, ratioMax)),
  }
}

function getPreferredDockHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_DOCK_HEIGHT
  const saved = Number(window.localStorage.getItem(DOCK_HEIGHT_STORAGE_KEY))
  return Number.isFinite(saved) ? saved : DEFAULT_DOCK_HEIGHT
}

function getInitialDockHeight(): number {
  const value = getPreferredDockHeight()
  if (typeof window === 'undefined') return value
  const limits = getDockHeightLimits(window.innerHeight)
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)))
}

function getAdaptiveCalendarTextColor(backgroundColor: string, opacity: number, configuredTextColor: string): string {
  const readable = ensureReadableTextColor(backgroundColor, configuredTextColor)
  if (opacity < 0.42 && readable.toLowerCase() === '#111827') return '#111827'
  return readable
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
  const setCurrentDate = useCalendarStore((s) => s.setCurrentDate)
  const goPrevMonth = useCalendarStore((s) => s.goPrevMonth)
  const goNextMonth = useCalendarStore((s) => s.goNextMonth)
  const goToday = useCalendarStore((s) => s.goToday)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const closeEventForm = useCalendarStore((s) => s.closeEventForm)
  const isEventFormOpen = useCalendarStore((s) => s.isEventFormOpen)
  const multiDayMode = useCalendarStore((s) => s.multiDayMode)
  const setMultiDayMode = useCalendarStore((s) => s.setMultiDayMode)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1

  const { settings, themeMode } = useAppSettings('calendar')
  const [isDayEventsOpen, setIsDayEventsOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const pickerDialogRef = useDialogFocusTrap(showPicker)
  const [pickerYearInput, setPickerYearInput] = useState(() => String(new Date().getFullYear()))
  const [pickerYearError, setPickerYearError] = useState('')
  const [showNoteCreateMenu, setShowNoteCreateMenu] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showReminderCenter, setShowReminderCenter] = useState(false)
  const [eventFormDirty, setEventFormDirty] = useState(false)
  const [dockDrafts, setDockDrafts] = useState<Record<string, DockedNoteDraftKind>>({})
  const [reminderHistory, setReminderHistory] = useState<ReminderHistoryEntry[]>([])
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
  const measureOverflowActionRef = useRef<HTMLButtonElement>(null)
  const noteCreateMenuRef = useRef<HTMLDivElement>(null)
  const noteCreateTriggerRef = useRef<HTMLButtonElement>(null)
  const overflowMenuRef = useRef<HTMLDivElement>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement>(null)
  const yearStripRef = useRef<HTMLDivElement>(null)
  const yearStripDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null)
  const suppressYearClickRef = useRef(false)
  const dockHeightRef = useRef(dockHeight)
  const preferredDockHeightRef = useRef(getPreferredDockHeight())
  const calendarCollapsedRef = useRef(false)
  const dockResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const tags = useTagStore((s) => s.tags)
  const notes = useNotesStore((s) => s.notes)
  const todayKey = useCurrentDateKey()
  const previousTodayKeyRef = useRef(todayKey)
  const existingViewNoteTagIds = useMemo(
    () => new Set(notes.flatMap(getViewNoteTagIds)),
    [notes],
  )

  useEffect(() => {
    const previousToday = previousTodayKeyRef.current
    previousTodayKeyRef.current = todayKey
    if (previousToday === todayKey) return
    const [previousYear, previousMonth] = previousToday.split('-').map(Number)
    if (currentDate.getFullYear() === previousYear && currentDate.getMonth() + 1 === previousMonth) {
      const [nextYear, nextMonth, nextDay] = todayKey.split('-').map(Number)
      setCurrentDate(new Date(nextYear, nextMonth - 1, nextDay))
    }
  }, [currentDate, setCurrentDate, todayKey])

  const viewportDensity = getCalendarDensity(viewportSize.width, viewportSize.height)
  const requestedFontSize = clampFontSize(settings.fontSize)
  // Density belongs to the available viewport, not to the typography setting.
  // Font size must remain continuous while the surrounding geometry stays stable.
  const calendarDensity = viewportDensity
  const effectiveFontSize = getAdaptiveDisplayFontSize(requestedFontSize)
  const calendarGridMinHeight = Math.max(360, Math.ceil(effectiveFontSize * 13.2))
  const calendarGridMinWidth = Math.max(560, Math.ceil(effectiveFontSize * 21))
  const isCompactDensity = calendarDensity < 0.92
  const isSmallType = requestedFontSize <= 11
  const isLargeType = requestedFontSize >= 19
  const isExtraLargeType = requestedFontSize >= 25
  const isMaximumType = requestedFontSize >= 37
  const isNarrowViewport = viewportSize.width < 700
  const isShortViewport = viewportSize.height < 620
  const isTinyWorkspace = viewportSize.width < 400 || viewportSize.height < 340
  const effectiveViewMode: 'month' | 'week' = isTinyWorkspace ? 'week' : viewMode
  const dockHeightLimits = getDockHeightLimits(viewportSize.height)
  const typographyDockMinimum = requestedFontSize >= 49
    ? Math.min(320, dockHeightLimits.max)
    : requestedFontSize >= 37
      ? Math.min(280, dockHeightLimits.max)
      : requestedFontSize >= 25
        ? Math.min(240, dockHeightLimits.max)
        : dockHeightLimits.min
  const displayedDockHeight = Math.max(dockHeight, typographyDockMinimum)
  const showDockArea = settings.showDockArea !== false && !isTinyWorkspace
  const hasDockDrafts = Object.keys(dockDrafts).length > 0
  // Keep an actively edited dock mounted until its draft is saved or explicitly
  // discarded. Hiding the area or crossing a responsive breakpoint must never
  // silently destroy local input state.
  const renderDockArea = showDockArea || hasDockDrafts

  const handleDockDraftChange = useCallback((key: string, kind: DockedNoteDraftKind, dirty: boolean) => {
    setDockDrafts((current) => {
      if (dirty && current[key] === kind) return current
      if (!dirty && !(key in current)) return current
      const next = { ...current }
      if (dirty) next[key] = kind
      else delete next[key]
      return next
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    const entries: Array<WindowDraftKind | WindowDraftEntry> = eventFormDirty ? ['event-form'] : []
    for (const [key, kind] of Object.entries(dockDrafts)) {
      const noteId = key.split(':', 1)[0]
      entries.push(noteId ? { kind, noteId } : kind)
    }
    window.electronAPI.setWindowDraftState(entries)
  }, [dockDrafts, eventFormDirty])

  useEffect(() => () => {
    window.electronAPI?.setWindowDraftState([])
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('light', themeMode === 'light')
    document.documentElement.classList.add('electron-transparent')
  }, [themeMode])

  useEffect(() => {
    if (!showPicker) return
    setPickerYearInput(String(year))
    const frame = window.requestAnimationFrame(() => {
      const strip = yearStripRef.current
      const active = strip?.querySelector<HTMLElement>('[data-active-year="true"]')
      if (strip && active) {
        strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2
      }
    })
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPicker(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [showPicker, year])

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      return window.electronAPI.onAction((action) => {
        if (action === 'new-event') {
          setMultiDayMode(false)
          openEventForm(null)
        }
        if (action === 'show-reminders') setShowReminderCenter(true)
      })
    }
  }, [openEventForm, setMultiDayMode])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    let cancelled = false
    window.electronAPI.getReminderHistory().then((history) => {
      if (!cancelled) setReminderHistory(normalizeReminderHistoryEntries(history))
    }).catch((error) => {
      reportPersistenceIssue('提醒记录读取失败', error instanceof Error ? error.message : '无法读取提醒记录。')
    })
    const unsubscribe = window.electronAPI.onReminderHistoryChanged((history) => setReminderHistory(normalizeReminderHistoryEntries(history)))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const unreadReminderCount = reminderHistory.filter((entry) => !entry.read).length

  const markAllRemindersRead = async () => {
    if (!window.electronAPI?.isElectron) return
    setReminderHistory((entries) => entries.map((entry) => ({ ...entry, read: true })))
    const saved = await window.electronAPI.markReminderHistoryRead()
    if (!saved) reportPersistenceIssue('提醒状态未保存', '“全部已读”未能写入磁盘，请稍后重试。', markAllRemindersRead)
  }

  const openReminderEvent = (entry: ReminderHistoryEntry) => {
    setReminderHistory((items) => items.map((item) => item.id === entry.id ? { ...item, read: true } : item))
    if (window.electronAPI?.isElectron) {
      void window.electronAPI.markReminderHistoryRead(entry.id).then((saved) => {
        if (!saved) reportPersistenceIssue('提醒状态未保存', '这条提醒未能标记为已读，请稍后重试。')
      })
    }
    const event = useCalendarStore.getState().events.find((item) => item.id === entry.eventId)
    if (!event) {
      reportPersistenceIssue('事件已不存在', '这条提醒对应的事件可能已被删除。')
      return
    }
    setShowReminderCenter(false)
    setMultiDayMode(!!(event.endDate && event.endDate !== event.startDate))
    openEventForm(event)
  }

  const handleTitleMenuKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    close: () => void,
    trigger: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      window.requestAnimationFrame(() => trigger.current?.focus())
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const backwards = event.shiftKey
      close()
      window.setTimeout(() => focusAdjacentInteractiveElement(trigger.current, backwards), 0)
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

  useEffect(() => {
    if (!showNoteCreateMenu && !showOverflowMenu) return
    const handler = (event: MouseEvent) => {
      if (showNoteCreateMenu && !noteCreateMenuRef.current?.contains(event.target as Node)) {
        setShowNoteCreateMenu(false)
      }
      if (showOverflowMenu && !overflowMenuRef.current?.contains(event.target as Node)) setShowOverflowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNoteCreateMenu, showOverflowMenu])

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
      const overflowWidth = Math.ceil(measureOverflowActionRef.current?.getBoundingClientRect().width || 32)
      const required = (count: number) => (
        widths.slice(0, count).reduce((sum, width) => sum + width, 0)
        + (count < 3 ? overflowWidth : 0)
        + Math.max(0, count + (count < 3 ? 1 : 0) - 1) * gap
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
  }, [effectiveFontSize, effectiveViewMode])

  useEffect(() => {
    const updateViewportSize = () => setViewportSize(getViewportSize())
    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    return () => window.removeEventListener('resize', updateViewportSize)
  }, [])

  useEffect(() => {
    if (visibleTitleActions === 3) setShowOverflowMenu(false)
  }, [visibleTitleActions])

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      const reloadNotesFromDisk = () => {
        window.electronAPI!.getNotesState().then((rawNotes) => {
          const normalized = rawNotes
            .map((raw, index) => normalizePersistedNote(
              raw,
              raw && typeof raw === 'object' && 'id' in raw ? String((raw as Record<string, unknown>).id) : `invalid_${index}`,
            ))
            .filter((note): note is Note => !!note && note.noteType !== 'view')
          useNotesStore.getState().loadNotes(keepSingleDailyNote(normalized))
        }).catch((error) => {
          reportPersistenceIssue('便签列表读取失败', error instanceof Error ? error.message : '无法刷新便签列表。', reloadNotesFromDisk)
        })
      }
      const unsub2 = window.electronAPI.onToggleCollapse((collapsed: boolean) => {
        calendarCollapsedRef.current = collapsed
        setCalendarCollapsed(collapsed)
      })
      const unsub3 = window.electronAPI.onEventsChanged((data) => {
        if (Array.isArray(data?.events)) {
          useCalendarStore.getState().loadEvents(normalizeCalendarEvents(data.events), Number(data.revision) || 0)
          return
        }
        window.electronAPI!.getEventsState().then((state) => {
          if (state.loadError) reportPersistenceIssue('事件数据无法读取', state.loadError)
          if (Array.isArray(state.events)) {
            useCalendarStore.getState().loadEvents(normalizeCalendarEvents(state.events), state.revision)
          }
        }).catch((error) => reportPersistenceIssue('事件读取失败', error instanceof Error ? error.message : '无法刷新事件数据。'))
      })
      const unsub4 = window.electronAPI.onTagsChanged(() => {
        // Reload tags from disk (e.g. after creating/editing tags in settings)
        window.electronAPI!.getTags().then((data) => {
          useTagStore.getState().loadTagsState(data)
        }).catch((error) => reportPersistenceIssue('标签读取失败', error instanceof Error ? error.message : '无法刷新标签。'))
      })
      const unsub5 = window.electronAPI.onNotesChanged((payload) => {
        if (payload?.deletedId) {
          const current = useNotesStore.getState().notes
          useNotesStore.getState().loadNotes(current.filter((note) => note.id !== payload.deletedId))
          return
        }
        if (payload?.note && typeof payload.note === 'object') {
          const normalized = normalizePersistedNote(payload.note, '')
          if (normalized && normalized.noteType !== 'view') {
            const current = useNotesStore.getState().notes
            useNotesStore.getState().loadNotes([
              normalized,
              ...current.filter((note) => note.id !== normalized.id && (normalized.noteType !== 'daily' || note.noteType !== 'daily')),
            ])
            return
          }
        }
        reloadNotesFromDisk()
      })
      const unsub6 = window.electronAPI.onOpenEventEditor(async (eventData) => {
        if (!eventData || typeof eventData !== 'object') return
        const event = eventData as CalendarEvent
        if (!event.id) return
        const latest = await window.electronAPI!.getEventsState()
        if (Array.isArray(latest.events)) {
          const normalizedEvents = normalizeCalendarEvents(latest.events)
          useCalendarStore.getState().loadEvents(normalizedEvents, latest.revision)
          const currentEvent = normalizedEvents.find((item) => item.id === event.id)
          if (!currentEvent) return
          setMultiDayMode(!!(currentEvent.endDate && currentEvent.endDate !== currentEvent.startDate))
          openEventForm(currentEvent)
          return
        }
        setMultiDayMode(!!(event.endDate && event.endDate !== event.startDate))
        openEventForm(event)
      })
      return () => { unsub2(); unsub3(); unsub4(); unsub5(); unsub6() }
    }
  }, [openEventForm, setMultiDayMode])

  // Load persisted data on mount (events, notes, tags)
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    let cancelled = false

    const loadNotesData = async (): Promise<Note[]> => {
      const notesById = new Map<string, Note>()
      const rawNotes = await window.electronAPI!.getNotesState()
      if (cancelled) return []
      for (const [index, raw] of rawNotes.entries()) {
        const fallbackId = raw && typeof raw === 'object' && 'id' in raw ? String((raw as Record<string, unknown>).id) : `invalid_${index}`
        const normalized = normalizePersistedNote(raw, fallbackId)
        if (normalized && normalized.noteType !== 'view') {
          notesById.set(normalized.id, normalized)
        }
      }
      return keepSingleDailyNote([...notesById.values()])
    }

    void Promise.allSettled([
      window.electronAPI.getEventsState().then((data) => {
        if (cancelled) return
        if (data.loadError) reportPersistenceIssue('事件数据无法读取', data.loadError)
        if (Array.isArray(data.events)) {
          const normalizedEvents = normalizeCalendarEvents(data.events)
          useCalendarStore.getState().loadEvents(normalizedEvents, data.revision)
        }
      }),
      loadNotesData().then((notes) => {
        if (cancelled) return
        useNotesStore.getState().loadNotes(notes)
      }),
      window.electronAPI.getTags().then((data) => {
        if (cancelled) return
        useTagStore.getState().loadTagsState(data)
      }),
    ]).then((results) => {
      if (cancelled) return
      const labels = ['事件', '便签', '标签']
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const message = result.reason instanceof Error ? result.reason.message : '主进程没有响应'
          reportPersistenceIssue(`${labels[index]}数据读取失败`, `${message}。其他已成功读取的数据仍可继续使用。`)
        }
      })
      useAppStore.getState().setDataReady()
      const allNotes = useNotesStore.getState().notes

      // Only restore undocked notes as windows (docked notes render in calendar)
      const undockedIds = allNotes.filter((n: Note) => !n.isDocked && !n.isHidden).map((n: Note) => n.id)
      if (undockedIds.length > 0 && !didRestoreRef.current) {
        didRestoreRef.current = true
        window.electronAPI!.restoreNotes(undockedIds)
      }
    })

    return () => { cancelled = true }
  }, [])

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
  const fullTitleText = effectiveViewMode === 'week'
    ? `${format(weekStart, 'M月d日')} - ${format(weekEnd, 'M月d日')}`
    : `${year}年${month}月`
  const titleText = viewportSize.width < 400
    ? effectiveViewMode === 'week'
      ? `${format(weekStart, 'M/d')}–${format(weekEnd, 'M/d')}`
      : `${year}/${month}`
    : fullTitleText
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
  const canNavigate = (direction: -1 | 1) => {
    const target = new Date(currentDate)
    if (effectiveViewMode === 'month') {
      target.setDate(1)
      target.setMonth(target.getMonth() + direction)
      return target.getFullYear() >= MIN_SUPPORTED_YEAR && target.getFullYear() <= MAX_SUPPORTED_YEAR
    }
    target.setDate(target.getDate() + direction * 7)
    const targetWeekStart = startOfWeek(target, { weekStartsOn: 1 })
    const targetWeekEnd = endOfWeek(target, { weekStartsOn: 1 })
    return targetWeekEnd >= new Date(MIN_SUPPORTED_YEAR, 0, 1)
      && targetWeekStart <= new Date(MAX_SUPPORTED_YEAR, 11, 31)
  }
  const canGoPrev = canNavigate(-1)
  const canGoNext = canNavigate(1)
  const handlePrev = () => {
    if (!canGoPrev) return
    if (effectiveViewMode === 'month') {
      goPrevMonth()
      return
    }
    const next = new Date(currentDate)
    next.setDate(next.getDate() - 7)
    useCalendarStore.getState().setCurrentDate(next)
  }
  const handleNext = () => {
    if (!canGoNext) return
    if (effectiveViewMode === 'month') {
      goNextMonth()
      return
    }
    const next = new Date(currentDate)
    next.setDate(next.getDate() + 7)
    useCalendarStore.getState().setCurrentDate(next)
  }
  const readPickerYear = () => {
    const value = Number.parseInt(pickerYearInput, 10)
    return Number.isFinite(value) && value >= MIN_SUPPORTED_YEAR && value <= MAX_SUPPORTED_YEAR ? value : null
  }
  const goToPickerYear = (nextYear: number, closePicker = false) => {
    const next = new Date(currentDate)
    next.setDate(1)
    next.setFullYear(nextYear)
    useCalendarStore.getState().setCurrentDate(next)
    setPickerYearInput(String(nextYear))
    setPickerYearError('')
    if (closePicker) setShowPicker(false)
  }
  const commitPickerYear = () => {
    const nextYear = readPickerYear()
    if (nextYear === null) {
      setPickerYearError(`请输入 ${MIN_SUPPORTED_YEAR}–${MAX_SUPPORTED_YEAR} 之间的四位年份`)
      return
    }
    goToPickerYear(nextYear)
  }
  const goToPickerMonth = (nextMonth: number) => {
    const nextYear = readPickerYear()
    if (nextYear === null) {
      setPickerYearError(`请输入 ${MIN_SUPPORTED_YEAR}–${MAX_SUPPORTED_YEAR} 之间的四位年份`)
      return
    }
    const next = new Date(currentDate)
    next.setDate(1)
    next.setFullYear(nextYear)
    next.setMonth(nextMonth - 1)
    useCalendarStore.getState().setCurrentDate(next)
    setShowPicker(false)
  }
  const handleYearStripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    suppressYearClickRef.current = false
    yearStripDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = 'true'
  }
  const handleYearStripPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = yearStripDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > 4) suppressYearClickRef.current = true
    event.currentTarget.scrollLeft = drag.scrollLeft - delta
  }
  const finishYearStripDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = yearStripDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    yearStripDragRef.current = null
    delete event.currentTarget.dataset.dragging
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    window.setTimeout(() => { suppressYearClickRef.current = false }, 0)
  }
  const pickerYearStart = Math.min(MAX_SUPPORTED_YEAR - 80, Math.max(MIN_SUPPORTED_YEAR, year - 40))
  const pickerYears = Array.from({ length: 81 }, (_, index) => pickerYearStart + index)
  const clampDockHeight = useCallback((height: number) => {
    const limits = getDockHeightLimits(window.innerHeight)
    return Math.round(Math.min(limits.max, Math.max(limits.min, height)))
  }, [])
  const handleDockResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isEventFormOpen) return
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
  const resizeDockByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEventFormOpen || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const limits = getDockHeightLimits(window.innerHeight)
    const next = event.key === 'Home'
      ? limits.min
      : event.key === 'End'
        ? limits.max
        : clampDockHeight(dockHeight + (event.key === 'ArrowUp' ? 16 : -16))
    preferredDockHeightRef.current = next
    setDockHeight(next)
    window.localStorage.setItem(DOCK_HEIGHT_STORAGE_KEY, String(next))
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
  }, [clampDockHeight])

  return (
    <div
      className={`calendar-window relative h-screen w-screen flex flex-col ${calendarCollapsed ? 'calendar-collapsed' : ''} ${isCompactDensity ? 'calendar-density-compact' : ''} ${isSmallType ? 'calendar-type-small' : ''} ${isLargeType ? 'calendar-type-large' : ''} ${isExtraLargeType ? 'calendar-type-xlarge' : ''} ${isMaximumType ? 'calendar-type-max' : ''} ${isNarrowViewport ? 'calendar-viewport-narrow' : ''} ${isShortViewport ? 'calendar-viewport-short' : ''}`}
      style={{
        fontFamily: `"${settings.fontFamily}", system-ui, sans-serif`,
        fontSize: effectiveFontSize,
        color: calendarTextColor,
        ['--calendar-text' as string]: calendarTextColor,
        ['--calendar-text-shadow' as string]: calendarTextShadow,
        ['--calendar-density' as string]: calendarDensity,
        ['--calendar-font-size' as string]: `${effectiveFontSize}px`,
        ['--calendar-requested-font-size' as string]: requestedFontSize,
        ['--calendar-grid-min-height' as string]: `${calendarGridMinHeight}px`,
        ['--calendar-grid-min-width' as string]: `${calendarGridMinWidth}px`,
      }}
    >
      {/* Background overlay */}
      <div className="cal-window-bg absolute inset-0 z-0" style={{ backgroundColor: bgWithAlpha }} />

      {/* Title bar */}
      <div
        ref={titlebarRef}
        className="cal-titlebar relative z-[60] items-center px-4 py-2.5 shrink-0 border-b select-none"
        style={{ WebkitAppRegion: 'drag', borderColor: `${calendarTextColor}18` } as React.CSSProperties}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <div className="cal-left-actions-measure" aria-hidden="true">
          <button ref={measureTodayActionRef} tabIndex={-1} className="cal-action cal-action-today px-2.5 py-1 text-[0.8em] rounded-md border">
            <span className="cal-action-label">今天</span>
          </button>
          <button ref={measureEventActionRef} tabIndex={-1} className="cal-action cal-action-event px-2.5 py-1 text-[0.8em] rounded-md border flex items-center gap-1">
            <Plus size={11} />
            <span className="cal-action-label">事件</span>
          </button>
          <button ref={measureNoteActionRef} tabIndex={-1} className="cal-action cal-action-note px-2.5 py-1 text-[0.8em] rounded-md border flex items-center gap-1">
            <Plus size={11} />
            <span className="cal-action-label">便签</span>
          </button>
          <button ref={measureOverflowActionRef} tabIndex={-1} className="cal-action h-8 w-8 rounded-md border" aria-label="更多操作">
            <MoreHorizontal size={15} />
          </button>
        </div>
        {/* Left: actions */}
        <div className="cal-left-actions flex items-center gap-1 calendar-text-readable" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={goToday}
            className={`cal-action cal-action-today px-2.5 py-1 text-[0.8em] rounded-md opacity-50 hover:opacity-80 transition-opacity border ${visibleTitleActions >= 1 ? '' : 'cal-action-hidden'}`}
            style={{ borderColor: `${calendarTextColor}18` }}
            tabIndex={visibleTitleActions >= 1 ? 0 : -1}
            aria-hidden={visibleTitleActions < 1}
          >
            <span className="cal-action-label">今天</span>
          </button>
          <button
            onClick={() => { setMultiDayMode(false); openEventForm(null) }}
            className={`cal-action cal-action-event px-2.5 py-1 text-[0.8em] rounded-md opacity-50 hover:opacity-80 transition-opacity border flex items-center gap-1 ${visibleTitleActions >= 2 ? '' : 'cal-action-hidden'}`}
            style={{ borderColor: `${calendarTextColor}18` }}
            tabIndex={visibleTitleActions >= 2 ? 0 : -1}
            aria-hidden={visibleTitleActions < 2}
          >
            <Plus size={11} />
            <span className="cal-action-label">事件</span>
          </button>
          <div ref={noteCreateMenuRef} className="relative">
            <button
              ref={noteCreateTriggerRef}
              onClick={() => {
                setShowOverflowMenu(false)
                setShowNoteCreateMenu((open) => !open)
              }}
              className={`cal-action cal-action-note px-2.5 py-1 text-[0.8em] rounded-md opacity-50 hover:opacity-80 transition-opacity border flex items-center gap-1 ${visibleTitleActions >= 3 ? '' : 'cal-action-hidden'}`}
              style={{ borderColor: `${calendarTextColor}18` }}
              tabIndex={visibleTitleActions >= 3 ? 0 : -1}
              aria-hidden={visibleTitleActions < 3}
              aria-haspopup="menu"
              aria-expanded={showNoteCreateMenu}
            >
              <Plus size={11} />
              <span className="cal-action-label">便签</span>
            </button>
            {showNoteCreateMenu && (
              <>
                <div
                  className="fixed inset-0 z-[9998]"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  onPointerDown={() => setShowNoteCreateMenu(false)}
                  aria-hidden="true"
                />
                <div
                  className="absolute left-0 top-full mt-1 w-56 rounded-xl border p-2 shadow-2xl z-[10000]"
                  style={{
                    backgroundColor: lightBg ? 'rgba(255,255,255,0.98)' : 'rgba(13,13,16,0.96)',
                    borderColor: lightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.16)',
                    color: calendarTextColor,
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    WebkitAppRegion: 'no-drag',
                  } as React.CSSProperties}
                  role="menu"
                  aria-label="新建便签"
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => handleTitleMenuKeyDown(event, () => setShowNoteCreateMenu(false), visibleTitleActions < 3 ? overflowTriggerRef : noteCreateTriggerRef)}
                >
                  <button
                    onClick={() => {
                      window.electronAPI?.createNote({ noteType: 'independent' })
                      setShowNoteCreateMenu(false)
                    }}
                    className={NOTE_CREATE_MENU_ITEM_CLASS}
                    role="menuitem"
                    autoFocus
                  >
                    <div className="font-medium opacity-80">独立便签</div>
                    <div className="mt-0.5 text-[0.85em] opacity-35">待办与自由记录</div>
                  </button>
                  <button
                    onClick={() => {
                      window.electronAPI?.createNote({ noteType: 'daily', title: '每日待办' })
                      setShowNoteCreateMenu(false)
                    }}
                    className={NOTE_CREATE_MENU_ITEM_CLASS}
                    role="menuitem"
                  >
                    <div className="font-medium opacity-80">每日待办</div>
                    <div className="mt-0.5 text-[0.85em] opacity-35">按日期查看历史待办</div>
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: `${calendarTextColor}18` }} />
                  <div className="rounded-lg px-2.5 py-2 text-xs" role="group" aria-label="按标签创建标签视图便签">
                    <div className="font-medium opacity-80">标签视图便签</div>
                    <div className="mt-0.5 text-[0.85em] opacity-45">汇总所选标签的事件，并随事件同步</div>
                    {tags.length > 0 ? (
                      <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
                        {tags.map((tag) => {
                          const alreadyExists = existingViewNoteTagIds.has(tag.id)
                          return (
                            <button
                              key={tag.id}
                              onClick={() => {
                                window.electronAPI?.createNote({ noteType: 'echo', echoTagId: tag.id, title: tag.name, color: tag.color })
                                setShowNoteCreateMenu(false)
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                              role="menuitem"
                              title={alreadyExists ? `打开“${tag.name}”标签视图便签` : `新建“${tag.name}”标签视图便签`}
                            >
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                              <span className="shrink-0 text-[0.82em] opacity-35">{alreadyExists ? '打开' : '新建'}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-md px-2 py-1.5 text-[0.85em] opacity-40">暂无标签，请先在设置中创建</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          {visibleTitleActions < 3 && (
            <div ref={overflowMenuRef} className="relative">
              <button
                ref={overflowTriggerRef}
                type="button"
                onClick={() => {
                  setShowNoteCreateMenu(false)
                  setShowOverflowMenu((open) => !open)
                }}
                className="cal-action h-8 w-8 rounded-md border opacity-55 transition-all hover:bg-white/5 hover:opacity-95"
                style={{ borderColor: `${calendarTextColor}18` }}
                aria-label="更多新建操作"
                aria-haspopup="menu"
                aria-expanded={showOverflowMenu}
              >
                <MoreHorizontal size={15} />
              </button>
              {showOverflowMenu && (
                <div
                  className="absolute left-0 top-full z-[10000] mt-1 w-44 rounded-xl border p-1.5 shadow-2xl"
                  style={{
                    backgroundColor: lightBg ? 'rgba(255,255,255,0.99)' : 'rgba(13,13,16,0.98)',
                    borderColor: lightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.16)',
                    color: calendarTextColor,
                  }}
                  role="menu"
                  aria-label="更多新建操作"
                  onKeyDown={(event) => handleTitleMenuKeyDown(event, () => setShowOverflowMenu(false), overflowTriggerRef)}
                >
                  {visibleTitleActions < 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      autoFocus
                      className="min-h-9 w-full rounded-lg px-3 text-left text-xs opacity-75 hover:bg-white/10 hover:opacity-100"
                      onClick={() => { goToday(); setShowOverflowMenu(false) }}
                    >
                      回到今天
                    </button>
                  )}
                  {visibleTitleActions < 2 && (
                    <button
                      type="button"
                      role="menuitem"
                      autoFocus={visibleTitleActions >= 1}
                      className="min-h-9 w-full rounded-lg px-3 text-left text-xs opacity-75 hover:bg-white/10 hover:opacity-100"
                      onClick={() => {
                        setMultiDayMode(false)
                        openEventForm(null)
                        setShowOverflowMenu(false)
                      }}
                    >
                      新建事件
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus={visibleTitleActions >= 2}
                    className="min-h-9 w-full rounded-lg px-3 text-left text-xs opacity-75 hover:bg-white/10 hover:opacity-100"
                    onClick={() => {
                      setShowOverflowMenu(false)
                      setShowNoteCreateMenu(true)
                    }}
                  >
                    新建便签…
                  </button>
                </div>
              )}
            </div>
          )}
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
            disabled={!canGoPrev}
            className="cal-chevron-left w-8 h-8 rounded-lg flex items-center justify-center opacity-50 hover:opacity-90 hover:bg-white/5 transition-all disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            aria-label={effectiveViewMode === 'month' ? '上一个月' : '上一周'}
            title={!canGoPrev ? '已到支持范围下限（1900年）' : undefined}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={() => {
              if (!showPicker) setPickerYearInput(String(year))
              setShowPicker(!showPicker)
            }}
            className="cal-month-title calendar-text-readable min-h-6 text-[1em] font-semibold tracking-wide opacity-85 min-w-[90px] text-center hover:opacity-100 hover:bg-white/5 rounded-lg px-2 py-0.5 transition-all relative"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            aria-haspopup="dialog"
            aria-expanded={showPicker}
            title={fullTitleText}
          >
            {titleText}
          </button>
          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className="cal-chevron-right w-8 h-8 rounded-lg flex items-center justify-center opacity-50 hover:opacity-90 hover:bg-white/5 transition-all disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            aria-label={effectiveViewMode === 'month' ? '下一个月' : '下一周'}
            title={!canGoNext ? '已到支持范围上限（2100年）' : undefined}
          >
            <ChevronRight size={17} />
          </button>

          {/* Year/Month Picker */}
          {showPicker && (
            <>
              <div
                className="fixed inset-0 z-[9998]"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onPointerDown={() => setShowPicker(false)}
                aria-hidden="true"
              />
              <div
                ref={pickerDialogRef}
                className="calendar-date-picker absolute top-full left-1/2 -translate-x-1/2 mt-1 z-[9999] w-[min(360px,calc(100vw-20px))] rounded-xl p-4"
                style={{
                  backgroundColor: lightBg ? 'rgba(255,255,255,0.99)' : 'rgba(10,18,31,0.99)',
                  color: calendarTextColor,
                  boxShadow: lightBg ? '0 22px 60px rgba(20, 24, 32, 0.20)' : '0 22px 60px rgba(0, 0, 0, 0.45)',
                }}
                onPointerDown={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="选择年份和月份"
              >
                <div className="mb-4 flex items-end gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1.5 block text-[11px] font-semibold opacity-60">直接输入年份</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      minLength={4}
                      maxLength={4}
                      value={pickerYearInput}
                      onChange={(event) => {
                        setPickerYearInput(event.target.value.replace(/\D/g, '').slice(0, 4))
                        setPickerYearError('')
                      }}
                      onKeyDown={(event) => {
                        if (!isImeComposing(event) && event.key === 'Enter') commitPickerYear()
                      }}
                      aria-label="年份"
                      aria-describedby={pickerYearError ? 'calendar-year-error calendar-year-range' : 'calendar-year-range'}
                      aria-invalid={pickerYearError ? 'true' : undefined}
                      className="calendar-year-input w-full rounded-lg border px-3 py-2 text-center text-base font-semibold tabular-nums outline-none transition-colors focus:border-primary/60"
                      style={{ borderColor: `${calendarTextColor}20`, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={commitPickerYear}
                    className="h-[38px] rounded-lg bg-primary/20 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/28"
                  >
                    定位
                  </button>
                </div>
                {pickerYearError && <p id="calendar-year-error" role="alert" className="-mt-2 mb-3 text-center text-[11px] text-red-500">{pickerYearError}</p>}
                <p id="calendar-year-range" className="-mt-2 mb-3 text-center text-[11px] opacity-55">支持 1900–2100 年的农历与节假日显示</p>
                <div className="mb-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold opacity-60">
                    <span>年份</span>
                    <span className="font-normal opacity-70">横向拖动</span>
                  </div>
                  <div
                    ref={yearStripRef}
                    className="calendar-year-strip flex cursor-grab snap-x gap-1.5 overflow-x-auto pb-2"
                    onPointerDown={handleYearStripPointerDown}
                    onPointerMove={handleYearStripPointerMove}
                    onPointerUp={finishYearStripDrag}
                    onPointerCancel={finishYearStripDrag}
                    onWheel={(event) => {
                      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
                      const dialog = pickerDialogRef.current
                      if (dialog && dialog.scrollHeight > dialog.clientHeight) return
                      event.preventDefault()
                      event.currentTarget.scrollLeft += event.deltaY
                    }}
                    aria-label="年份横向选择"
                  >
                    {pickerYears.map((pickerYear) => (
                      <button
                        key={pickerYear}
                        onClick={() => {
                          if (suppressYearClickRef.current) return
                          goToPickerYear(pickerYear)
                        }}
                        className={`shrink-0 snap-center rounded-md px-2.5 py-1.5 text-xs tabular-nums transition-colors ${
                          pickerYear === year
                            ? 'bg-primary/20 text-primary font-semibold'
                            : 'opacity-50 hover:bg-white/5 hover:opacity-90'
                        }`}
                        data-active-year={pickerYear === year ? 'true' : undefined}
                        aria-current={pickerYear === year ? 'date' : undefined}
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        {pickerYear}
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
                        onClick={() => goToPickerMonth(m)}
                        className={`py-1.5 text-xs rounded-md transition-all ${
                          m === month
                            ? 'bg-primary/20 text-primary font-semibold'
                            : 'opacity-50 hover:opacity-90 hover:bg-white/5'
                        }`}
                        aria-pressed={m === month}
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
                onClick={() => { if (!(isTinyWorkspace && mode === 'month')) setViewMode(mode) }}
                disabled={isTinyWorkspace && mode === 'month'}
                className={`px-2 py-0.5 text-[0.72em] rounded transition-all ${
                  effectiveViewMode === mode ? 'bg-primary/20 text-primary opacity-90' : 'opacity-50 hover:opacity-75'
                }`}
                 title={mode === 'month' && isTinyWorkspace ? '当前窗口过小，暂用周视图' : (mode === 'month' ? '月视图' : '周视图')}
                  aria-pressed={effectiveViewMode === mode}
              >
                {mode === 'month' ? '月' : '周'}
              </button>
            ))}
          </div>
          <button onClick={() => setShowReminderCenter(true)} className="touch-target relative flex h-7 w-7 items-center justify-center rounded-lg opacity-60 transition-all hover:bg-white/5 hover:opacity-90" title="提醒记录" aria-label={unreadReminderCount > 0 ? `提醒记录，${unreadReminderCount} 条未读` : '提醒记录'}>
            <Bell size={14} />
            {unreadReminderCount > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />}
          </button>
          <button onClick={() => window.electronAPI?.openSettings()} className="touch-target w-8 h-8 rounded-lg flex items-center justify-center opacity-60 hover:opacity-90 hover:bg-white/5 transition-all" title="设置" aria-label="打开设置">
            <Settings size={13} />
          </button>
          <button onClick={() => window.electronAPI?.closeWindow()} className="touch-target w-8 h-8 rounded-lg flex items-center justify-center opacity-60 hover:opacity-90 hover:bg-white/5 hover:text-red-400 transition-all" aria-label="关闭日历" title="关闭日历">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="cal-main-content relative z-[30] flex-1 flex flex-col overflow-hidden px-3 pb-3">
        <div className="calendar-grid-scroll flex-1 overflow-hidden">
          <MonthGrid compact viewMode={effectiveViewMode} cellBorderColor={cellBorderColor} holidayStripeColor={holidayStripeColor} holidayTextColor={holidayTextColor} eventTextColor={eventTextColor} todayKey={todayKey} onDayDoubleClick={() => setIsDayEventsOpen(true)} />
        </div>
      </div>

      {/* Dock area with view note panel + carousel */}
      {renderDockArea && (
        <>
          <div
            className={`dock-resizer relative z-[45] h-2 shrink-0 cursor-row-resize ${isEventFormOpen ? 'dock-resizer-disabled' : ''}`}
            style={{ WebkitAppRegion: 'no-drag', borderColor: `${calendarTextColor}18` } as React.CSSProperties}
            onPointerDown={handleDockResizeStart}
            onPointerMove={handleDockResizeMove}
            onPointerUp={finishDockResize}
            onPointerCancel={finishDockResize}
            onKeyDown={resizeDockByKeyboard}
            role="separator"
            aria-orientation="horizontal"
            aria-label="调整挂载区高度"
            aria-valuemin={typographyDockMinimum}
            aria-valuemax={dockHeightLimits.max}
            aria-valuenow={displayedDockHeight}
            aria-disabled={isEventFormOpen}
            tabIndex={isEventFormOpen ? -1 : 0}
            title="拖动调整挂载区高度"
          >
            <div className="dock-resizer-line absolute left-0 right-0 top-1/2 h-px -translate-y-1/2" />
            <div className="dock-resizer-grip absolute left-1/2 top-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full" />
          </div>
          <DockArea height={displayedDockHeight} onDraftChange={handleDockDraftChange} />
        </>
      )}

      {/* Modals */}
      <EventDetailModal />
      <DayEventsModal isOpen={isDayEventsOpen} onClose={() => setIsDayEventsOpen(false)} />
      {isEventFormOpen && (
        <EventForm
          onClose={closeEventForm}
          initialMultiDay={multiDayMode}
          onDirtyChange={setEventFormDirty}
        />
      )}
      <ReminderCenter
        open={showReminderCenter}
        entries={reminderHistory}
        onClose={() => setShowReminderCenter(false)}
        onMarkAllRead={markAllRemindersRead}
        onOpenEvent={openReminderEvent}
      />
    </div>
  )
}
