import { useState, useEffect, useRef } from 'react'
import { useNotesStore } from '@/stores/notes.store'
import { Plus, MoreHorizontal, X, GripHorizontal, Settings } from 'lucide-react'
import { TodoItem } from '@/components/notes/TodoItem'
import { useAppSettings } from '@/hooks/useAppSettings'
import { isLightColor } from '@/lib/utils'
import type { Note } from '@/types/notes.types'

interface NoteWindowProps { noteId: string; isNew?: boolean }

const NOTE_COLORS = ['#FF8C42', '#22D3EE', '#FB7185', '#A78BFA', '#FBBF24', '#34D399', '#F472B6', '#60A5FA', '#F59E0B', '#818CF8', '#FB923C', '#38BDF8', '#A3E635', '#E879F9', '#FDA4AF', '#67E8F9']

function createDefaultNote(noteId: string): Note {
  const ts = new Date().toISOString()
  return {
    id: noteId, title: '新便签',
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    transparency: 0.88, items: [], fontFamily: 'Microsoft YaHei',
    fontSize: 14, isPinned: false, isArchived: false,
    createdAt: ts, updatedAt: ts,
  }
}

export function NoteWindow({ noteId, isNew }: NoteWindowProps) {
  const notes = useNotesStore((s) => s.notes)
  const addNote = useNotesStore((s) => s.addNote)
  const updateNote = useNotesStore((s) => s.updateNote)
  const deleteNote = useNotesStore((s) => s.deleteNote)
  const addItem = useNotesStore((s) => s.addItem)
  const loadNotes = useNotesStore((s) => s.loadNotes)

  const { settings, themeMode, loaded } = useAppSettings('notes')

  useEffect(() => {
    document.documentElement.style.fontSize = settings.fontSize + 'px'
    return () => { document.documentElement.style.fontSize = '' }
  }, [settings.fontSize])

  useEffect(() => {
    document.documentElement.classList.toggle('light', themeMode === 'light')
    document.documentElement.classList.add('electron-transparent')
  }, [themeMode])

  const note = notes.find((n) => n.id === noteId)

  // Initialize: load from per-note file, fallback to legacy, auto-create only if isNew
  useEffect(() => {
    if (!loaded || !window.electronAPI?.isElectron || notes.find((n) => n.id === noteId)) return

    window.electronAPI.loadAppData(`note_${noteId}`).then((data) => {
      if (data && typeof data === 'object' && 'id' in data) {
        loadNotes([data as Note])
        return
      }
      // Try legacy notes.json as second fallback
      return window.electronAPI!.loadAppData('notes').then((legacy) => {
        if (Array.isArray(legacy)) {
          const found = (legacy as Note[]).find((n: Note) => n.id === noteId)
          if (found) {
            loadNotes([found])
            window.electronAPI!.saveAppData(`note_${found.id}`, found)
            return
          }
        }
        // Only auto-create if this is a genuinely new note (from tray / IPC)
        if (isNew) {
          const state = useNotesStore.getState()
          if (!state.notes.find((n) => n.id === noteId)) {
            addNote(createDefaultNote(noteId))
          }
        }
      })
    }).catch((err) => {
      console.error('NoteWindow init failed:', noteId, err)
      // Only auto-create on catch if this is a genuinely new note
      if (isNew) {
        const state = useNotesStore.getState()
        if (!state.notes.find((n) => n.id === noteId)) {
          addNote(createDefaultNote(noteId))
        }
      }
    })
  }, [loaded, noteId, isNew])

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const startEditTitle = () => {
    if (!note) return
    setTitleDraft(note.title)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 50)
  }

  const saveTitle = () => {
    if (note && titleDraft.trim()) {
      useNotesStore.getState().updateNote({ ...note, title: titleDraft.trim(), updatedAt: new Date().toISOString() })
    }
    setEditingTitle(false)
  }

  const [newTodo, setNewTodo] = useState('')
  const [showMenu, setShowMenu] = useState(false)

  if (!note) {
    return <div className="h-screen w-screen flex items-center justify-center text-xs opacity-20 select-none">...</div>
  }

  const handleAddTodo = () => {
    if (newTodo.trim()) { addItem(note.id, newTodo.trim()); setNewTodo('') }
  }

  const handleDeleteNote = () => {
    deleteNote(note.id)
    window.electronAPI?.deleteNote(note.id)
  }

  const noteColorHex = note.color
  const bgHex = noteColorHex.replace('#', '')
  const noteOpacity = note.transparency !== undefined ? note.transparency : settings.backgroundOpacity
  const bgWithAlpha = `#${bgHex}${Math.round(noteOpacity * 255).toString(16).padStart(2, '0')}`
  const noteFont = settings.fontFamily
  const noteFontSize = settings.fontSize

  const lightBg = isLightColor(noteColorHex)

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ fontFamily: `"${noteFont}", system-ui, sans-serif`, color: settings.textColor, fontSize: noteFontSize }}
    >
      <div className="absolute inset-0" style={{ backgroundColor: bgWithAlpha }} />

      {/* Title bar */}
      <div
        className="relative flex items-center justify-between px-3 py-2 shrink-0"
        style={{ WebkitAppRegion: 'drag', backgroundColor: `${noteColorHex}14` } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <GripHorizontal size={10} className="opacity-25 shrink-0" />
          <div className="h-2.5 w-0.5 rounded-full shrink-0" style={{ backgroundColor: noteColorHex, opacity: 0.5 }} />

          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
              className="flex-1 bg-white/5 rounded px-1.5 py-0.5 text-sm font-semibold outline-none min-w-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              autoFocus
            />
          ) : (
            <span
              onClick={startEditTitle}
              className="text-sm font-semibold tracking-wide truncate cursor-text hover:opacity-70 transition-opacity"
              style={{ WebkitAppRegion: 'no-drag', color: settings.textColor } as React.CSSProperties}
              title="点击编辑标题"
            >
              {note.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => setShowMenu(!showMenu)} className="w-5 h-5 rounded flex items-center justify-center opacity-30 hover:opacity-70 transition-opacity">
            <MoreHorizontal size={11} />
          </button>
          {showMenu && (
            <div
              className="absolute right-1 top-8 w-44 bg-background/95 backdrop-blur-xl border border-white/8 rounded-lg shadow-2xl py-1 z-30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1">
                <div className="flex gap-1 flex-wrap max-w-[152px]">
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { updateNote({ ...note, color: c, updatedAt: new Date().toISOString() }); setShowMenu(false) }}
                      className={`w-4 h-4 rounded-full transition-transform hover:scale-125 ${c === noteColorHex ? 'ring-1.5 ring-white/70 ring-offset-1 ring-offset-background' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <hr className="border-white/5" />
              <button
                onClick={handleDeleteNote}
                className="w-full text-left px-2.5 py-1 text-[0.8em] text-red-400/70 hover:text-red-400 hover:bg-red-500/5 transition-colors"
              >
                删除
              </button>
            </div>
          )}
          <button onClick={() => window.electronAPI?.openSettings()} className="w-5 h-5 rounded flex items-center justify-center opacity-20 hover:opacity-70 transition-all" title="设置">
            <Settings size={11} />
          </button>
          <button
            onClick={() => window.electronAPI?.hideNote()}
            className="w-5 h-5 rounded flex items-center justify-center opacity-20 hover:opacity-70 hover:text-red-400 transition-all"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Accent line */}
      <div className="relative h-0.5 mx-3 shrink-0 rounded-full" style={{ backgroundColor: noteColorHex, opacity: 0.30 }} />

      {/* Todo items */}
      <div className="relative flex-1 px-3 py-1.5 space-y-0 overflow-y-auto overflow-x-hidden">
        {note.items.map((item) => (
          <TodoItem key={item.id} item={item} note={note} />
        ))}
        {note.items.length === 0 && (
          <p className="text-[0.8em] opacity-10 py-3 text-center">输入待办事项...</p>
        )}
      </div>

      {/* Add todo input - high contrast styling */}
      <div className="relative px-3 pb-2.5 pt-1 shrink-0">
        <div
          className="flex items-center gap-2 border rounded-md px-2.5 py-1.5 transition-colors"
          style={{
            backgroundColor: lightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
            borderColor: lightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)',
          }}
        >
          <button
            type="button"
            onClick={handleAddTodo}
            className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-opacity"
            style={{ opacity: lightBg ? 0.4 : 0.35, backgroundColor: lightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' }}
          >
            <Plus size={12} />
          </button>
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo() }}
            placeholder="添加待办..."
            className="flex-1 bg-transparent text-[0.85em] outline-none placeholder:opacity-25"
            onFocus={() => setShowMenu(false)}
            style={{ color: settings.textColor }}
          />
        </div>
      </div>
    </div>
  )
}
