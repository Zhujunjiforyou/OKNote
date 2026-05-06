import { create } from 'zustand'
import { CalendarEvent } from '@/types/calendar.types'
import { filterEventsByDate } from '@/lib/utils'

interface CalendarStore {
  currentDate: Date
  selectedDate: string | null
  events: CalendarEvent[]
  selectedEventId: string | null
  isEventFormOpen: boolean
  editingEvent: CalendarEvent | null
  multiDayMode: boolean
  tagFilter: string | null
  hideNoTime: boolean
  viewNoteTagFilter: string[]

  setCurrentDate: (date: Date) => void
  goPrevMonth: () => void
  goNextMonth: () => void
  goToday: () => void
  selectEvent: (id: string | null) => void
  openEventForm: (event?: CalendarEvent | null) => void
  closeEventForm: () => void
  setMultiDayMode: (mode: boolean) => void
  addEvent: (event: CalendarEvent) => void
  updateEvent: (event: CalendarEvent) => void
  deleteEvent: (id: string) => void
  getEventsByDate: (dateStr: string) => CalendarEvent[]
  loadEvents: (events: CalendarEvent[]) => void
  setSelectedDate: (dateStr: string | null) => void
  setTagFilter: (tagId: string | null) => void
  setHideNoTime: (hide: boolean) => void
  setViewNoteTagFilter: (tagIds: string[]) => void
  toggleViewNoteTag: (tagId: string) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveEvents = async () => {
  if (window.electronAPI?.isElectron) {
    await window.electronAPI.saveAppData('events', useCalendarStore.getState().events)
    window.electronAPI.notifyEventsChanged()
  }
}
const debouncedSaveEvents = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveEvents(); saveTimer = null }, 300)
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  currentDate: new Date(),
  selectedDate: null,
  events: [],
  selectedEventId: null,
  isEventFormOpen: false,
  editingEvent: null,
  multiDayMode: false,
  tagFilter: null,
  hideNoTime: false,
  viewNoteTagFilter: [],

  setCurrentDate: (date) => set({ currentDate: date }),
  goPrevMonth: () => set((s) => {
    const d = new Date(s.currentDate)
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return { currentDate: d }
  }),
  goNextMonth: () => set((s) => {
    const d = new Date(s.currentDate)
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    return { currentDate: d }
  }),
  goToday: () => set({ currentDate: new Date() }),
  selectEvent: (id) => set({ selectedEventId: id }),
  openEventForm: (event) => set({ isEventFormOpen: true, editingEvent: event ?? null }),
  closeEventForm: () => set({ isEventFormOpen: false, editingEvent: null }),
  setMultiDayMode: (mode) => set({ multiDayMode: mode }),

  addEvent: (event) => {
    set((s) => ({ events: [...s.events, event] }))
    debouncedSaveEvents()
  },
  updateEvent: (event) => {
    set((s) => ({ events: s.events.map((e) => (e.id === event.id ? event : e)) }))
    debouncedSaveEvents()
  },
  deleteEvent: (id) => {
    set((s) => ({
      events: s.events.filter((e) => e.id !== id),
      selectedEventId: s.selectedEventId === id ? null : s.selectedEventId,
    }))
    debouncedSaveEvents()
  },

  loadEvents: (events) => set({ events }),

  setSelectedDate: (dateStr) => set({ selectedDate: dateStr }),
  setTagFilter: (tagId) => set({ tagFilter: tagId }),
  setHideNoTime: (hide) => set({ hideNoTime: hide }),
  setViewNoteTagFilter: (tagIds) => set({ viewNoteTagFilter: tagIds }),
  toggleViewNoteTag: (tagId) => set((s) => {
    const ids = s.viewNoteTagFilter.includes(tagId)
      ? s.viewNoteTagFilter.filter((id) => id !== tagId)
      : [...s.viewNoteTagFilter, tagId]
    return { viewNoteTagFilter: ids }
  }),

  getEventsByDate: (dateStr) => filterEventsByDate(get().events, dateStr),
}))
