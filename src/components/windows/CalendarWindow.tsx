import { useEffect, useState, useRef } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import { useAppStore } from '@/stores/app.store'
import type { CalendarEvent } from '@/types/calendar.types'
import type { Note, CountdownItem } from '@/types/notes.types'
import { ChevronLeft, ChevronRight, Plus, X, Settings } from 'lucide-react'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import { useAppSettings } from '@/hooks/useAppSettings'
import { EventForm } from '@/components/calendar/EventForm'
import { EventDetailModal } from '@/components/calendar/EventDetailModal'
import { DayEventsModal } from '@/components/calendar/DayEventsModal'
import { isLightColor } from '@/lib/utils'

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
  const didRestoreRef = useRef(false)

  useEffect(() => {
    document.documentElement.style.fontSize = settings.fontSize + 'px'
    return () => { document.documentElement.style.fontSize = '' }
  }, [settings.fontSize])

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

  // Load persisted data on mount (events, notes, countdowns)
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    let cancelled = false

    const isStubNote = (note: Note): boolean => {
      if (note.title !== '新便签') return false
      if (note.items && note.items.length > 0) return false
      if (note.isPinned || note.isArchived) return false
      return true
    }

    const loadNotesData = async (): Promise<Note[]> => {
      const files = await window.electronAPI!.listAppData('note_')
      if (cancelled) return []
      if (files.length > 0) {
        const notes: Note[] = []
        const stubsToCleanup: string[] = []
        for (const f of files) {
          const rawKey = f.replace('.json', '')
          const data = await window.electronAPI!.loadAppData(rawKey)
          if (cancelled) return []
          if (data && typeof data === 'object' && 'id' in data) {
            const note = data as Note
            if (isStubNote(note)) {
              stubsToCleanup.push(rawKey)
            } else {
              notes.push(note)
            }
          }
        }
        if (stubsToCleanup.length > 0) {
          await Promise.all(stubsToCleanup.map(key => window.electronAPI!.deleteAppData(key)))
        }
        return notes
      }
      // Fallback: load legacy notes.json
      const data = await window.electronAPI!.loadAppData('notes')
      if (cancelled) return []
      if (Array.isArray(data) && data.length > 0) {
        const allNotes = data as Note[]
        const validNotes = allNotes.filter(n => !isStubNote(n))
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
        if (notes.length > 0) {
          useNotesStore.getState().loadNotes(notes)
        }
      }),
      window.electronAPI.loadAppData('countdowns').then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) {
          useNotesStore.getState().loadCountdowns(data as CountdownItem[])
        }
      }),
    ]).then(() => {
      if (cancelled) return
      useAppStore.getState().setDataReady()
      const noteIds = useNotesStore.getState().notes.map((n: Note) => n.id)
      if (noteIds.length > 0 && !didRestoreRef.current) {
        didRestoreRef.current = true
        window.electronAPI!.restoreNotes(noteIds)
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
  const bgHex = settings.backgroundColor.replace('#', '')
  const bgWithAlpha = `#${bgHex}${Math.round(settings.backgroundOpacity * 255).toString(16).padStart(2, '0')}`

  const cellBorderColor = isLightColor(settings.backgroundColor)
    ? 'rgba(0,0,0,0.18)'
    : 'rgba(255,255,255,0.20)'

  const lightBg = isLightColor(settings.backgroundColor)
  const holidayStripeColor = lightBg
    ? 'rgba(200, 40, 40, 0.10)'
    : 'rgba(255, 110, 110, 0.09)'
  const holidayTextColor = lightBg
    ? 'rgba(180, 30, 30, 0.85)'
    : 'rgba(255, 140, 140, 0.85)'

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ fontFamily: `"${settings.fontFamily}", system-ui, sans-serif`, color: settings.textColor }}
    >
      {/* Background overlay */}
      <div className="absolute inset-0" style={{ backgroundColor: bgWithAlpha }} />

      {/* Title bar */}
      <div
        className="relative flex items-center justify-between px-4 py-2.5 shrink-0 border-b"
        style={{ WebkitAppRegion: 'drag', borderColor: `${settings.textColor}10` } as React.CSSProperties}
      >
        {/* Left: actions */}
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={goToday}
            className="px-2.5 py-1 text-[0.8em] rounded-md opacity-35 hover:opacity-70 transition-opacity border"
            style={{ borderColor: `${settings.textColor}10` }}
          >
            今天
          </button>
          <button
            onClick={() => { setMultiDayMode(false); openEventForm(null) }}
            className="px-2.5 py-1 text-[0.8em] rounded-md opacity-35 hover:opacity-70 transition-opacity border flex items-center gap-1"
            style={{ borderColor: `${settings.textColor}10` }}
          >
            <Plus size={11} />
            事件
          </button>
        </div>

        {/* Center: navigation arrows + month title + picker */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={goPrevMonth}
            className="w-7 h-7 rounded-lg flex items-center justify-center opacity-40 hover:opacity-80 hover:bg-white/5 transition-all"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-sm font-semibold tracking-wide opacity-70 min-w-[90px] text-center hover:opacity-100 hover:bg-white/5 rounded-lg px-2 py-0.5 transition-all relative"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {year}年{month}月
          </button>
          <button
            onClick={goNextMonth}
            className="w-7 h-7 rounded-lg flex items-center justify-center opacity-40 hover:opacity-80 hover:bg-white/5 transition-all"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ChevronRight size={17} />
          </button>

          {/* Year/Month Picker */}
          {showPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 backdrop-blur-xl border rounded-xl shadow-2xl p-4 w-[320px]"
                style={{ backgroundColor: bgWithAlpha, borderColor: `${settings.textColor}10` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3">
                  <div className="text-[10px] font-semibold uppercase tracking-widest opacity-25 mb-2 text-center">年份</div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: 21 }, (_, i) => year - 10 + i).map((y) => (
                      <button
                        key={y}
                        onClick={() => {
                          const newDate = new Date(currentDate)
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
                  <div className="text-[10px] font-semibold uppercase tracking-widest opacity-25 mb-2 text-center">月份</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          const newDate = new Date(currentDate)
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
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => window.electronAPI?.openSettings()} className="w-6 h-6 rounded flex items-center justify-center opacity-20 hover:opacity-70 transition-all" title="设置">
            <Settings size={13} />
          </button>
          <button onClick={() => window.electronAPI?.closeWindow()} className="w-6 h-6 rounded flex items-center justify-center opacity-20 hover:opacity-80 hover:text-red-400 transition-all">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 flex flex-col overflow-hidden px-3 pb-3">
        <div className="flex-1 overflow-hidden">
          <MonthGrid compact cellBorderColor={cellBorderColor} holidayStripeColor={holidayStripeColor} holidayTextColor={holidayTextColor} onDayDoubleClick={() => setIsDayEventsOpen(true)} />
        </div>
      </div>

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
