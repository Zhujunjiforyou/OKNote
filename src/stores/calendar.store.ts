import { create } from 'zustand'
import { CalendarEvent } from '@/types/calendar.types'
import { filterEventsByDate } from '@/lib/utils'

interface CalendarStore {
  currentDate: Date
  events: CalendarEvent[]
  selectedEventId: string | null
  isEventFormOpen: boolean
  editingEvent: CalendarEvent | null
  multiDayMode: boolean

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
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveEvents = () => {
  if (window.electronAPI?.isElectron) {
    window.electronAPI.saveAppData('events', useCalendarStore.getState().events)
  }
}
const debouncedSaveEvents = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveEvents(); saveTimer = null }, 300)
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  currentDate: new Date(),
  events: [],
  selectedEventId: null,
  isEventFormOpen: false,
  editingEvent: null,
  multiDayMode: false,

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

  getEventsByDate: (dateStr) => filterEventsByDate(get().events, dateStr),
}))
