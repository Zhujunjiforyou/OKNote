import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import { useNotesStore } from '@/stores/notes.store'
import { useTagStore } from '@/stores/tag.store'
import { Check, Plus, MoreHorizontal, X, GripHorizontal, Settings, Tag, Eye, ListTodo } from 'lucide-react'
import { TodoItem } from '@/components/notes/TodoItem'
import { EchoEventList } from '@/components/notes/EchoEventList'
import { QuickEventForm } from '@/components/notes/QuickEventForm'
import { useAppSettings } from '@/hooks/useAppSettings'
import { hexToLuminance, normalizeHexColor, normalizeNote } from '@/lib/utils'
import type { Note } from '@/types/notes.types'
import type { EventTag } from '@/types/tag.types'

interface NoteWindowProps { noteId: string; isNew?: boolean }

const NOTE_COLORS = ['#FF8C42', '#22D3EE', '#FB7185', '#A78BFA', '#FBBF24', '#34D399', '#F472B6', '#60A5FA', '#F59E0B', '#818CF8', '#FB923C', '#38BDF8', '#A3E635', '#E879F9', '#FDA4AF', '#67E8F9']

function getReadableTextColor(hex: string): string {
  const luminance = hexToLuminance(hex)
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#111827' : '#f8fafc'
}

function createDefaultNote(noteId: string): Note {
  const ts = new Date().toISOString()
  return {
    id: noteId, title: '新便签',
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
    transparency: 0.88, items: [], fontFamily: 'Microsoft YaHei',
    fontSize: 14, isPinned: false, isArchived: false,
    noteType: 'independent',
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

  useEffect(() => {
    if (!loaded || !window.electronAPI?.isElectron || notes.find((n) => n.id === noteId)) return

    window.electronAPI.loadAppData(`note_${noteId}`).then((data) => {
      if (data && typeof data === 'object') {
        const rawNote = data as Record<string, unknown>
        const normalized = normalizeNote({ ...rawNote, id: typeof rawNote.id === 'string' ? rawNote.id : noteId })
        loadNotes([normalized])
        window.electronAPI!.saveAppData(`note_${normalized.id}`, normalized)
        return
      }
      return window.electronAPI!.loadAppData('notes').then((legacy) => {
        if (Array.isArray(legacy)) {
          const found = (legacy as Note[]).find((n: Note) => n.id === noteId)
          if (found) {
            const normalized = normalizeNote(found)
            loadNotes([normalized])
            window.electronAPI!.saveAppData(`note_${found.id}`, normalized)
            return
          }
        }
        if (isNew) {
          const state = useNotesStore.getState()
          if (!state.notes.find((n) => n.id === noteId)) {
            addNote(createDefaultNote(noteId))
          }
        }
      })
    }).catch((err) => {
      console.error('NoteWindow init failed:', noteId, err)
      if (isNew) {
        const state = useNotesStore.getState()
        if (!state.notes.find((n) => n.id === noteId)) {
          addNote(createDefaultNote(noteId))
        }
      }
    })
  }, [loaded, noteId, isNew, notes, loadNotes, addNote])

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [newTodo, setNewTodo] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showQuickEventForm, setShowQuickEventForm] = useState(false)
  const [isDockTargetPreview, setIsDockTargetPreview] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const getTagById = useTagStore((s) => s.getTagById)
  const tags = useTagStore((s) => s.tags)
  const loadTags = useTagStore((s) => s.loadTags)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const windowDragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressTitleClickRef = useRef(false)

  const openMenu = useCallback(() => {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 176 })
    }
    setShowMenu(true)
  }, [])

  useEffect(() => {
    if (!showMenu) return
    const handler = () => setShowMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showMenu])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    window.electronAPI.getTags().then((data) => {
      if (Array.isArray(data)) loadTags(data as import('@/types/tag.types').EventTag[])
    }).catch(() => {})
    return window.electronAPI.onTagsChanged(() => {
      window.electronAPI!.getTags().then((data) => {
        if (Array.isArray(data)) loadTags(data as import('@/types/tag.types').EventTag[])
      }).catch(() => {})
    })
  }, [loadTags])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onNoteDockHover((inside) => {
      setIsDockTargetPreview(inside)
    })
  }, [])

  if (!note) {
    return (
      <div className="h-screen w-screen flex items-center justify-center select-none overflow-hidden animate-note-in">
        <div className="absolute inset-0 bg-[#0d0d10]/55 backdrop-blur-xl" />
        <div className="relative flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/45 shadow-2xl">
          <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse" />
          加载便签...
        </div>
      </div>
    )
  }

  const startEditTitle = () => {
    setTitleDraft(note.title)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 50)
  }

  const saveTitle = () => {
    if (titleDraft.trim()) {
      useNotesStore.getState().updateNote({ ...note, title: titleDraft.trim(), updatedAt: new Date().toISOString() })
    }
    setEditingTitle(false)
  }

  const isEcho = note.noteType === 'echo'

  const handleAddTodo = () => {
    if (newTodo.trim()) { addItem(note.id, newTodo.trim()); setNewTodo('') }
  }

  const handleDeleteNote = () => {
    deleteNote(note.id)
    window.electronAPI?.deleteNote(note.id)
  }

  const handleDock = () => {
    if (!window.electronAPI?.isElectron) return
    const nextNote = { ...note, isDocked: true, updatedAt: new Date().toISOString() }
    updateNote(nextNote)
    window.electronAPI.saveAppData(`note_${note.id}`, nextNote)
    window.electronAPI.dockNote(note.id, nextNote)
    setShowMenu(false)
  }

  const handleUndock = () => {
    if (!window.electronAPI?.isElectron) return
    const nextNote = { ...note, isDocked: false, updatedAt: new Date().toISOString() }
    updateNote(nextNote)
    window.electronAPI.saveAppData(`note_${note.id}`, nextNote)
    window.electronAPI.undockNote(note.id, nextNote)
    setShowMenu(false)
  }

  const handleWindowDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editingTitle) return
    const target = e.target as HTMLElement
    if (target.closest('button,input,textarea,[data-no-window-drag]')) return
    windowDragRef.current = { pointerId: e.pointerId, startX: e.screenX, startY: e.screenY, moved: false }
    suppressTitleClickRef.current = false
    if (window.electronAPI?.isElectron) {
      window.electronAPI.beginNoteWindowDrag(note.id, note, e.screenX, e.screenY)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleWindowDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = windowDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const distance = Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY)
    if (distance > 3) {
      drag.moved = true
      suppressTitleClickRef.current = true
    }
    if (window.electronAPI?.isElectron) {
      window.electronAPI.moveNoteWindowDrag(e.screenX, e.screenY)
    }
  }

  const handleWindowDragPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = windowDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    windowDragRef.current = null
    if (window.electronAPI?.isElectron) {
      window.electronAPI.endNoteWindowDrag(e.screenX, e.screenY, drag.moved)
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const closeQuickEventForm = () => {
    setShowQuickEventForm(false)
  }

  const isDocked = note.isDocked === true
  const noteColorHex = normalizeHexColor(note.color)
  const bgHex = noteColorHex.replace('#', '')
  const noteOpacity = settings.backgroundOpacity
  const bgWithAlpha = `#${bgHex}${Math.round(noteOpacity * 255).toString(16).padStart(2, '0')}`
  const noteFont = settings.fontFamily || 'Microsoft YaHei'
  const noteFontSize = settings.fontSize || 14
  const safeItems = Array.isArray(note.items) ? note.items : ([] as Note['items'])
  const selectedEchoTagIds = isEcho
    ? (Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
        ? note.viewTagIds
        : (note.echoTagId ? [note.echoTagId] : []))
    : []
  const selectedEchoTags = selectedEchoTagIds
    .map((tagId) => getTagById(tagId))
    .filter((tag): tag is EventTag => !!tag)

  const noteTextColor = getReadableTextColor(noteColorHex)
  const lightBg = noteTextColor === '#111827'
  const noteMutedColor = lightBg ? 'rgba(17, 24, 39, 0.66)' : 'rgba(248, 250, 252, 0.74)'
  const notePanelBg = lightBg ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.18)'
  const notePanelBorder = lightBg ? 'rgba(17,24,39,0.14)' : 'rgba(255,255,255,0.16)'

  const toggleEchoTag = (tagId: string) => {
    if (!isEcho) return
    const current = selectedEchoTagIds
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId]
    updateNote({
      ...note,
      viewTagIds: next,
      echoTagId: next[0],
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <div
      className={`note-window-root h-screen w-screen flex flex-col overflow-hidden select-none animate-note-in ${isEcho ? 'note-window-echo-note' : 'note-window-independent-note'} ${isDockTargetPreview ? 'note-window-dock-target' : ''}`}
      style={{
        fontFamily: `"${noteFont}", system-ui, sans-serif`,
        color: noteTextColor,
        fontSize: noteFontSize,
        ['--note-text' as string]: noteTextColor,
        ['--note-muted' as string]: noteMutedColor,
        ['--note-panel' as string]: notePanelBg,
        ['--note-panel-border' as string]: notePanelBorder,
        ['--note-accent' as string]: noteColorHex,
      }}
    >
      <div className="absolute inset-0" style={{ backgroundColor: bgWithAlpha }} />

      {/* Title bar */}
      <div
        className="relative flex items-center justify-between px-3 py-2 shrink-0 cursor-grab active:cursor-grabbing"
        style={{ WebkitAppRegion: 'no-drag', backgroundColor: `${noteColorHex}14`, touchAction: 'none' } as React.CSSProperties}
        onPointerDown={handleWindowDragPointerDown}
        onPointerMove={handleWindowDragPointerMove}
        onPointerUp={handleWindowDragPointerEnd}
        onPointerCancel={handleWindowDragPointerEnd}
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
              data-no-window-drag
              autoFocus
            />
          ) : (
            <span
              onDoubleClick={startEditTitle}
              className="text-sm font-semibold tracking-wide truncate cursor-text hover:opacity-70 transition-opacity"
              style={{ WebkitAppRegion: 'no-drag', color: noteTextColor } as React.CSSProperties}
              title="双击编辑标题"
              data-no-window-drag
            >
              {note.title}
            </span>
          )}
          <span
            className={`note-type-badge shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[0.62em] leading-none ${isEcho ? 'note-type-badge-echo' : 'note-type-badge-independent'}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {isEcho ? <Eye size={9} /> : <ListTodo size={9} />}
            {isEcho ? '视图' : '独立'}
          </span>
          {isEcho && (
            selectedEchoTags.length > 0 ? (
              <span
                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65em] leading-none"
                style={{ backgroundColor: notePanelBg, border: `1px solid ${notePanelBorder}`, color: noteTextColor, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: selectedEchoTags[0].color }} />
                {selectedEchoTags[0].name}
                {selectedEchoTags.length > 1 && <span className="opacity-60">+{selectedEchoTags.length - 1}</span>}
              </span>
            ) : (
              <span
                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65em] leading-none opacity-30"
                style={{ backgroundColor: notePanelBg, border: `1px solid ${notePanelBorder}`, color: noteTextColor, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Tag size={9} />
                未选标签
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button ref={menuBtnRef} onClick={(e) => { e.stopPropagation(); openMenu() }} className="w-5 h-5 rounded flex items-center justify-center opacity-30 hover:opacity-70 transition-opacity">
            <MoreHorizontal size={11} />
          </button>
          {showMenu && createPortal(
            <div className="fixed inset-0 z-[9999]" onClick={() => setShowMenu(false)}>
              <div
                className="absolute w-44 bg-background/95 backdrop-blur-xl border border-white/8 rounded-lg shadow-2xl py-1 z-[10000]"
                style={{ top: menuPos.top, left: menuPos.left }}
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
                {isEcho ? (
                  <div>
                    <div className="px-2.5 py-1">
                      <p className="text-[0.6em] opacity-25 mb-1">视图标签</p>
                      <div className="space-y-0.5 max-h-28 overflow-y-auto">
                        {tags.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => toggleEchoTag(t.id)}
                            className={`w-full text-left px-2 py-1 text-[0.72em] rounded flex items-center gap-1.5 hover:bg-white/5 transition-colors ${selectedEchoTagIds.includes(t.id) ? 'bg-white/10 opacity-90' : ''}`}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                            <span className="truncate flex-1">{t.name}</span>
                            {selectedEchoTagIds.includes(t.id) && <Check size={10} className="opacity-55" />}
                          </button>
                        ))}
                        {tags.length === 0 && (
                          <p className="text-[0.6em] opacity-20 px-2">暂无标签，请先在设置中创建</p>
                        )}
                      </div>
                    </div>
                    <hr className="border-white/5" />
                  </div>
                ) : (
                  <div className="px-2.5 py-1 text-[0.72em] opacity-35">类型：独立便签</div>
                )}
                <hr className="border-white/5" />
                {isDocked ? (
                  <button onClick={handleUndock} className="w-full text-left px-2.5 py-1 text-[0.8em] opacity-50 hover:opacity-80 hover:bg-white/5 transition-colors">
                    取消挂载
                  </button>
                ) : (
                  <button onClick={handleDock} className="w-full text-left px-2.5 py-1 text-[0.8em] opacity-50 hover:opacity-80 hover:bg-white/5 transition-colors">
                    挂载到日历
                  </button>
                )}
                <button onClick={handleDeleteNote} className="w-full text-left px-2.5 py-1 text-[0.8em] text-red-400/70 hover:text-red-400 hover:bg-red-500/5 transition-colors">
                  删除
                </button>
              </div>
            </div>,
            document.body
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

      {isDockTargetPreview && (
        <div className="note-dock-preview-hint relative mx-3 mt-2 shrink-0 rounded-md border px-2 py-1 text-center text-[0.68em] font-medium">
          松开鼠标挂载到日历
        </div>
      )}

      {/* Content area */}
      {isEcho ? (
        <EchoEventList
          note={note}
          onSelectEvent={(event) => {
            window.electronAPI?.openEventEditor(event)
          }}
        />
      ) : (
        <div className="relative flex-1 px-3 py-1.5 space-y-0 overflow-y-auto overflow-x-hidden">
          <AnimatePresence initial={false}>
            {safeItems.map((item) => (
              <TodoItem key={item.id} item={item} note={note} />
            ))}
          </AnimatePresence>
          {safeItems.length === 0 && (
            <p className="text-[0.8em] opacity-10 py-3 text-center">输入待办事项...</p>
          )}
        </div>
      )}

      {/* Footer */}
      {isEcho ? (
        showQuickEventForm ? (
          <QuickEventForm
            note={note}
            onClose={closeQuickEventForm}
            onSaved={closeQuickEventForm}
          />
        ) : (
          <div className="relative px-3 pb-2.5 pt-1 shrink-0">
            <button
              onClick={() => {
                setShowQuickEventForm(true)
              }}
              className="w-full flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.82em] font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: notePanelBg, border: `1px solid ${notePanelBorder}`, color: noteTextColor }}
            >
              <Plus size={12} />
              新建事件
            </button>
          </div>
        )
      ) : (
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
              style={{ color: noteTextColor }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
