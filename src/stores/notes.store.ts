import { create } from 'zustand'
import { Note, NoteItem, CountdownItem } from '@/types/notes.types'
import { generateId } from '@/lib/utils'

interface NotesStore {
  notes: Note[]
  countdowns: CountdownItem[]

  addNote: (note: Note) => void
  updateNote: (note: Note) => void
  deleteNote: (id: string) => void

  addItem: (noteId: string, content: string, options?: { todoDate?: string }) => void
  toggleItem: (noteId: string, itemId: string) => void
  deleteItem: (noteId: string, itemId: string) => void
  updateItemContent: (noteId: string, itemId: string, content: string) => void

  addCountdown: (c: CountdownItem) => void
  deleteCountdown: (id: string) => void

  loadNotes: (notes: Note[]) => void
  loadCountdowns: (countdowns: CountdownItem[]) => void
}

// Debounced per-note file save/delete helpers
const noteSaveTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const saveNoteFile = (note: Note) => {
  if (window.electronAPI?.isElectron) {
    if (noteSaveTimers[note.id]) clearTimeout(noteSaveTimers[note.id])
    noteSaveTimers[note.id] = setTimeout(() => {
      window.electronAPI!.saveAppData(`note_${note.id}`, note).then((ok) => {
        if (!ok) console.error('saveNoteFile failed for:', note.id)
      })
      delete noteSaveTimers[note.id]
    }, 300)
  }
}
const deleteNoteFile = (noteId: string) => {
  if (window.electronAPI?.isElectron) {
    if (noteSaveTimers[noteId]) { clearTimeout(noteSaveTimers[noteId]); delete noteSaveTimers[noteId] }
    window.electronAPI.deleteAppData(`note_${noteId}`).then((ok) => {
      if (!ok) console.error('deleteNoteFile failed for:', noteId)
    })
  }
}

let countdownSaveTimer: ReturnType<typeof setTimeout> | null = null
const saveCountdowns = () => {
  if (window.electronAPI?.isElectron) {
    if (countdownSaveTimer) clearTimeout(countdownSaveTimer)
    countdownSaveTimer = setTimeout(() => {
      window.electronAPI!.saveAppData('countdowns', useNotesStore.getState().countdowns)
      countdownSaveTimer = null
    }, 300)
  }
}
const now = () => new Date().toISOString()

export const useNotesStore = create<NotesStore>((set) => ({
  notes: [],
  countdowns: [],

  addNote: (note) => {
    set((s) => ({ notes: [note, ...s.notes] }))
    saveNoteFile(note)
  },
  updateNote: (note) => {
    set((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? note : n)) }))
    saveNoteFile(note)
  },
  deleteNote: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
    deleteNoteFile(id)
  },

  addItem: (noteId, content, options) => {
    set((s) => {
      const updated = s.notes.map((n) =>
        n.id === noteId
          ? {
              ...n,
              updatedAt: now(),
              items: [
                ...n.items,
                {
                  id: generateId(),
                  noteId,
                  content,
                  isCompleted: false,
                  sortOrder: n.items.length,
                  ...(options?.todoDate ? { todoDate: options.todoDate } : {}),
                },
              ],
            }
          : n
      )
      const note = updated.find((n) => n.id === noteId)
      if (note) saveNoteFile(note)
      return { notes: updated }
    })
  },

  toggleItem: (noteId, itemId) => {
    set((s) => {
      const updated = s.notes.map((n) =>
        n.id === noteId
          ? {
              ...n,
              updatedAt: now(),
              items: n.items.map((i) =>
                i.id === itemId
                  ? { ...i, isCompleted: !i.isCompleted, completedAt: !i.isCompleted ? now() : undefined }
                  : i
              ),
            }
          : n
      )
      const note = updated.find((n) => n.id === noteId)
      if (note) saveNoteFile(note)
      return { notes: updated }
    })
  },

  deleteItem: (noteId, itemId) => {
    set((s) => {
      const updated = s.notes.map((n) =>
        n.id === noteId
          ? { ...n, updatedAt: now(), items: n.items.filter((i) => i.id !== itemId) }
          : n
      )
      const note = updated.find((n) => n.id === noteId)
      if (note) saveNoteFile(note)
      return { notes: updated }
    })
  },

  updateItemContent: (noteId, itemId, content) => {
    set((s) => {
      const updated = s.notes.map((n) =>
        n.id === noteId
          ? { ...n, updatedAt: now(), items: n.items.map((i) => (i.id === itemId ? { ...i, content } : i)) }
          : n
      )
      const note = updated.find((n) => n.id === noteId)
      if (note) saveNoteFile(note)
      return { notes: updated }
    })
  },

  addCountdown: (c) => {
    set((s) => ({ countdowns: [c, ...s.countdowns] }))
    saveCountdowns()
  },
  deleteCountdown: (id) => {
    set((s) => ({ countdowns: s.countdowns.filter((c) => c.id !== id) }))
    saveCountdowns()
  },

  loadNotes: (notes) => set({ notes }),
  loadCountdowns: (countdowns) => set({ countdowns }),
}))
