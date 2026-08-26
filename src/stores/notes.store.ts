import { create } from 'zustand'
import { Note, NoteItem } from '@/types/notes.types'
import { generateId } from '@/lib/utils'
import { reportPersistenceIssue } from '@/stores/persistence.store'
import type { NoteSaveResult } from '@/types/electron'

interface NotesStore {
  notes: Note[]

  addNote: (note: Note) => void
  updateNote: (note: Note) => void
  deleteNote: (id: string) => void

  addItem: (noteId: string, content: string, options?: { todoDate?: string }) => void
  toggleItem: (noteId: string, itemId: string) => void
  deleteItem: (noteId: string, itemId: string) => NoteItem | null
  restoreItem: (noteId: string, item: NoteItem, index: number) => void
  updateItemContent: (noteId: string, itemId: string, content: string) => void

  loadNotes: (notes: Note[]) => void
}

interface NoteSaveQueueState {
  running: boolean
  pending: Note | null
  revision: number
}

const noteSaveQueues = new Map<string, NoteSaveQueueState>()

function noteRevision(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const revision = (value as { revision?: unknown }).revision
  return Number.isInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0
}

function reportNoteSaveFailure(note: Note, result: NoteSaveResult) {
  const conflict = result.code === 'conflict'
  reportPersistenceIssue(
    conflict ? '便签存在编辑冲突' : '便签尚未保存',
    result.message || (conflict
      ? '这张便签已在另一个窗口中更新；当前内容仍保留在本窗口，没有覆盖磁盘数据。'
      : `“${note.title || '未命名便签'}”未能写入磁盘，当前内容仍保留。`),
    conflict ? undefined : () => saveNoteFile(useNotesStore.getState().notes.find((item) => item.id === note.id) || note),
  )
}

async function drainNoteSaveQueue(noteId: string, state: NoteSaveQueueState) {
  if (!window.electronAPI?.isElectron || state.running) return
  state.running = true
  try {
    while (state.pending) {
      const queued = state.pending
      state.pending = null
      const snapshot = { ...queued, revision: state.revision }
      let result: NoteSaveResult
      try {
        result = await window.electronAPI.saveNote(noteId, snapshot)
      } catch (error) {
        result = {
          ok: false,
          code: 'save_failed',
          message: error instanceof Error ? error.message : '主进程没有响应，当前内容仍保留在窗口中。',
        }
      }
      if (!result.ok) {
        state.pending = null
        reportNoteSaveFailure(queued, result)
        break
      }
      const persistedRevision = noteRevision(result.note)
      state.revision = persistedRevision > state.revision ? persistedRevision : state.revision + 1
      useNotesStore.setState((current) => ({
        notes: current.notes.map((note) => note.id === noteId ? { ...note, revision: state.revision } : note),
      }))
    }
  } finally {
    state.running = false
    if (state.pending) void drainNoteSaveQueue(noteId, state)
  }
}

const saveNoteFile = (note: Note) => {
  if (!window.electronAPI?.isElectron) return
  let state = noteSaveQueues.get(note.id)
  if (!state) {
    state = { running: false, pending: null, revision: noteRevision(note) }
    noteSaveQueues.set(note.id, state)
  } else if (!state.running && !state.pending) {
    state.revision = noteRevision(note)
  }
  state.pending = { ...note }
  void drainNoteSaveQueue(note.id, state)
}
const now = () => new Date().toISOString()

export const useNotesStore = create<NotesStore>((set) => ({
  notes: [],

  addNote: (note) => {
    set((s) => ({ notes: [note, ...s.notes] }))
    saveNoteFile(note)
  },
  updateNote: (note) => {
    set((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? note : n)) }))
    saveNoteFile(note)
  },
  deleteNote: (id) => {
    if (window.electronAPI?.isElectron) {
      void window.electronAPI.deleteNote(id).then((result) => {
        if (result.ok) {
          noteSaveQueues.delete(id)
          set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
          return
        }
        if (result.canceled) return
        reportPersistenceIssue('便签未删除', result.message || '便签未能移入回收站。', () => useNotesStore.getState().deleteNote(id))
      }).catch((error) => {
        reportPersistenceIssue('便签未删除', error instanceof Error ? error.message : '主进程没有响应。', () => useNotesStore.getState().deleteNote(id))
      })
      return
    }
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
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
    let deletedItem: NoteItem | null = null
    set((s) => {
      const updated = s.notes.map((n) =>
        n.id === noteId ? (() => {
          deletedItem = n.items.find((item) => item.id === itemId) || null
          return deletedItem
            ? { ...n, updatedAt: now(), items: n.items.filter((item) => item.id !== itemId) }
            : n
        })() : n
      )
      const note = updated.find((n) => n.id === noteId)
      if (note && deletedItem) saveNoteFile(note)
      return { notes: updated }
    })
    return deletedItem
  },

  restoreItem: (noteId, item, index) => {
    set((s) => {
      const updated = s.notes.map((note) => {
        if (note.id !== noteId || note.items.some((existing) => existing.id === item.id)) return note
        const items = [...note.items]
        items.splice(Math.max(0, Math.min(index, items.length)), 0, item)
        return { ...note, updatedAt: now(), items }
      })
      const note = updated.find((entry) => entry.id === noteId)
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

  loadNotes: (notes) => set({ notes }),
}))
