import { create } from 'zustand'
import { CalendarEvent } from '@/types/calendar.types'
import { filterEventsByDate, normalizeCalendarEvents } from '@/lib/utils'
import type { EventMutationRequest, EventMutationResult } from '@/types/electron'
import { reportPersistenceIssue } from '@/stores/persistence.store'

interface CalendarStore {
  currentDate: Date
  events: CalendarEvent[]
  eventsRevision: number
  selectedEventId: string | null
  selectedEventOccurrenceDate: string | null
  isEventFormOpen: boolean
  editingEvent: CalendarEvent | null
  multiDayMode: boolean
  viewNoteTagFilter: string[]

  setCurrentDate: (date: Date) => void
  goPrevMonth: () => void
  goNextMonth: () => void
  goToday: () => void
  selectEvent: (id: string | null, occurrenceDate?: string | null) => void
  openEventForm: (event?: CalendarEvent | null) => void
  closeEventForm: () => void
  setMultiDayMode: (mode: boolean) => void
  addEvent: (event: CalendarEvent) => Promise<EventMutationResult>
  updateEvent: (event: CalendarEvent) => Promise<EventMutationResult>
  deleteEvent: (id: string) => void
  getEventsByDate: (dateStr: string) => CalendarEvent[]
  loadEvents: (events: CalendarEvent[], revision?: number) => void
  setViewNoteTagFilter: (tagIds: string[]) => void
  toggleViewNoteTag: (tagId: string) => void
}

type PendingEventMutation =
  | { token: symbol; type: 'upsert'; event: CalendarEvent }
  | { token: symbol; type: 'delete'; id: string }

const pendingEventMutations = new Map<string, PendingEventMutation>()
let serverEvents: CalendarEvent[] = []
const MIN_SUPPORTED_YEAR = 1900
const MAX_SUPPORTED_YEAR = 2100

function clampSupportedDate(value: Date): Date {
  const date = Number.isNaN(value.getTime()) ? new Date() : new Date(value)
  if (date.getFullYear() < MIN_SUPPORTED_YEAR) return new Date(MIN_SUPPORTED_YEAR, 0, 1)
  if (date.getFullYear() > MAX_SUPPORTED_YEAR) return new Date(MAX_SUPPORTED_YEAR, 11, 31)
  return date
}

function overlayPendingEvents(events: CalendarEvent[]): CalendarEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]))
  for (const mutation of pendingEventMutations.values()) {
    if (mutation.type === 'delete') byId.delete(mutation.id)
    else byId.set(mutation.event.id, mutation.event)
  }
  return [...byId.values()]
}

function applyServerEvents(rawEvents: unknown[], revision = 0) {
  const state = useCalendarStore.getState()
  if (revision < state.eventsRevision) {
    useCalendarStore.setState({ events: overlayPendingEvents(serverEvents) })
    return
  }
  serverEvents = normalizeCalendarEvents(rawEvents)
  useCalendarStore.setState({
    events: overlayPendingEvents(serverEvents),
    eventsRevision: revision,
  })
}

async function persistEventMutation(
  key: string,
  token: symbol,
  request: EventMutationRequest,
  retry: () => void,
  reportFailure = true,
): Promise<EventMutationResult> {
  if (!window.electronAPI?.isElectron) {
    return {
      ok: false,
      code: 'internal',
      message: '当前环境不支持持久化事件',
      events: serverEvents,
      revision: useCalendarStore.getState().eventsRevision,
    }
  }
  let result: EventMutationResult
  try {
    result = await window.electronAPI.mutateEvent(request)
  } catch (error) {
    result = {
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : '主进程没有响应',
      events: serverEvents,
      revision: useCalendarStore.getState().eventsRevision,
    }
  }
  if (pendingEventMutations.get(key)?.token === token) pendingEventMutations.delete(key)
  if (Array.isArray(result.events)) applyServerEvents(result.events, Number(result.revision) || 0)
  if (!result.ok && reportFailure) {
    const canRetry = result.code === 'save_failed' || result.code === 'internal'
    reportPersistenceIssue(
      result.code === 'conflict' ? '事件存在编辑冲突' : '事件未保存',
      result.message || '磁盘写入失败，当前界面已恢复为最后一次成功保存的内容。',
      canRetry ? retry : undefined,
    )
  }
  return result
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  currentDate: new Date(),
  events: [],
  eventsRevision: 0,
  selectedEventId: null,
  selectedEventOccurrenceDate: null,
  isEventFormOpen: false,
  editingEvent: null,
  multiDayMode: false,
  viewNoteTagFilter: [],

  setCurrentDate: (date) => set({ currentDate: clampSupportedDate(date) }),
  goPrevMonth: () => set((s) => {
    const d = new Date(s.currentDate)
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return { currentDate: clampSupportedDate(d) }
  }),
  goNextMonth: () => set((s) => {
    const d = new Date(s.currentDate)
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    return { currentDate: clampSupportedDate(d) }
  }),
  goToday: () => set({ currentDate: clampSupportedDate(new Date()) }),
  selectEvent: (id, occurrenceDate = null) => set({
    selectedEventId: id,
    selectedEventOccurrenceDate: id ? occurrenceDate : null,
  }),
  openEventForm: (event) => set({ isEventFormOpen: true, editingEvent: event ?? null }),
  closeEventForm: () => set({ isEventFormOpen: false, editingEvent: null }),
  setMultiDayMode: (mode) => set({ multiDayMode: mode }),

  addEvent: (event) => {
    if (!window.electronAPI?.isElectron) {
      const events = [...get().events.filter((item) => item.id !== event.id), event]
      set({ events })
      return Promise.resolve({ ok: true, event, events, revision: get().eventsRevision })
    }
    const token = Symbol(event.id)
    pendingEventMutations.set(event.id, { token, type: 'upsert', event })
    set({ events: overlayPendingEvents(serverEvents) })
    const retry = () => { void get().addEvent(event) }
    return persistEventMutation(event.id, token, {
      type: 'create',
      event,
      expectedRevision: get().eventsRevision,
    }, retry, false)
  },
  updateEvent: (event) => {
    if (!window.electronAPI?.isElectron) {
      const events = get().events.map((item) => item.id === event.id ? event : item)
      set({ events })
      return Promise.resolve({ ok: true, event, events, revision: get().eventsRevision })
    }
    const previous = get().events.find((item) => item.id === event.id)
    const token = Symbol(event.id)
    pendingEventMutations.set(event.id, { token, type: 'upsert', event })
    set({ events: overlayPendingEvents(serverEvents) })
    const retry = () => { void get().updateEvent(event) }
    return persistEventMutation(event.id, token, {
      type: 'update',
      event,
      expectedRevision: get().eventsRevision,
      expectedUpdatedAt: previous?.updatedAt,
    }, retry, false)
  },
  deleteEvent: (id) => {
    if (!window.electronAPI?.isElectron) {
      set((s) => ({
        events: s.events.filter((event) => event.id !== id),
        selectedEventId: s.selectedEventId === id ? null : s.selectedEventId,
        selectedEventOccurrenceDate: s.selectedEventId === id ? null : s.selectedEventOccurrenceDate,
      }))
      return
    }
    const previous = get().events.find((event) => event.id === id)
    const token = Symbol(id)
    pendingEventMutations.set(id, { token, type: 'delete', id })
    set((s) => ({
      events: overlayPendingEvents(serverEvents),
      selectedEventId: s.selectedEventId === id ? null : s.selectedEventId,
      selectedEventOccurrenceDate: s.selectedEventId === id ? null : s.selectedEventOccurrenceDate,
    }))
    const retry = () => get().deleteEvent(id)
    void persistEventMutation(id, token, {
      type: 'delete',
      id,
      expectedRevision: get().eventsRevision,
      expectedUpdatedAt: previous?.updatedAt,
    }, retry)
  },

  loadEvents: (events, revision = get().eventsRevision) => applyServerEvents(events, revision),

  setViewNoteTagFilter: (tagIds) => set({ viewNoteTagFilter: tagIds }),
  toggleViewNoteTag: (tagId) => set((s) => {
    const ids = s.viewNoteTagFilter.includes(tagId)
      ? s.viewNoteTagFilter.filter((id) => id !== tagId)
      : [...s.viewNoteTagFilter, tagId]
    return { viewNoteTagFilter: ids }
  }),

  getEventsByDate: (dateStr) => filterEventsByDate(get().events, dateStr),
}))
