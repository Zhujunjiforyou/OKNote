import { create } from 'zustand'
import { generateId } from '@/lib/utils'

interface UndoEntry {
  id: string
  message: string
  action: () => void
}

interface UndoStore {
  entries: UndoEntry[]
  add: (message: string, action: () => void, durationMs?: number) => void
  dismiss: (id: string) => void
  run: (id: string) => void
}

const timers = new Map<string, number>()

function clearEntryTimer(id: string) {
  const timer = timers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  timers.delete(id)
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  entries: [],
  add: (message, action, durationMs = 8000) => {
    const id = generateId()
    set((state) => ({ entries: [...state.entries, { id, message, action }].slice(-3) }))
    timers.set(id, window.setTimeout(() => {
      timers.delete(id)
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }))
    }, durationMs))
  },
  dismiss: (id) => {
    clearEntryTimer(id)
    set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }))
  },
  run: (id) => {
    const entry = get().entries.find((item) => item.id === id)
    if (!entry) return
    clearEntryTimer(id)
    set((state) => ({ entries: state.entries.filter((item) => item.id !== id) }))
    entry.action()
  },
}))
