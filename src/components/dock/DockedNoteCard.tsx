import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNotesStore } from '@/stores/notes.store'
import { useTagStore } from '@/stores/tag.store'
import type { Note } from '@/types/notes.types'
import { TodoItem } from '@/components/notes/TodoItem'
import { EchoEventList } from '@/components/notes/EchoEventList'
import { QuickEventForm } from '@/components/notes/QuickEventForm'
import { CalendarCheck, Check, Plus, MoreHorizontal, Eye, ListTodo } from 'lucide-react'
import { DailyTodoPanel } from '@/components/notes/DailyTodoPanel'
import { NOTE_COLOR_PALETTE, hexToLuminance, normalizeHexColor } from '@/lib/utils'
import { useAppSettings } from '@/hooks/useAppSettings'
import type { EventTag } from '@/types/tag.types'

interface DockedNoteCardProps {
  note: Note
  isActive: boolean
  attention?: boolean
}

export function DockedNoteCard({ note, isActive, attention = false }: DockedNoteCardProps) {
  const updateNote = useNotesStore((s) => s.updateNote)
  const addItem = useNotesStore((s) => s.addItem)
  const deleteNote = useNotesStore((s) => s.deleteNote)
  const getTagById = useTagStore((s) => s.getTagById)
  const tags = useTagStore((s) => s.tags)
  const { settings: noteSettings } = useAppSettings('notes')

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [newTodo, setNewTodo] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showQuickEventForm, setShowQuickEventForm] = useState(false)
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; outside: boolean } | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const titleInputRef = useRef<HTMLInputElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; dockRect: DOMRect; outside: boolean; moved: boolean; previewStarted: boolean } | null>(null)

  const isEcho = note.noteType === 'echo'
  const isDaily = note.noteType === 'daily'
  const selectedEchoTagIds = isEcho
    ? (Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
        ? note.viewTagIds
        : (note.echoTagId ? [note.echoTagId] : []))
    : []
  const selectedEchoTags = selectedEchoTagIds
    .map((tagId) => getTagById(tagId))
    .filter((tag): tag is EventTag => !!tag)
  const noteColor = normalizeHexColor(note.color)
  const noteOpacity = noteSettings.backgroundOpacity
  const bgWithAlpha = noteColor + Math.round(noteOpacity * 255).toString(16).padStart(2, '0').slice(0, 2)
  const lightBg = hexToLuminance(noteColor) > 0.58
  const textColor = lightBg ? '#111827' : '#f8fafc'
  const mutedTextColor = lightBg ? 'rgba(17, 24, 39, 0.64)' : 'rgba(248, 250, 252, 0.70)'
  const panelBg = lightBg ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.13)'
  const panelBorder = lightBg ? 'rgba(17,24,39,0.13)' : 'rgba(255,255,255,0.17)'

  const persistNote = useCallback((nextNote: Note) => {
    updateNote(nextNote)
    if (window.electronAPI?.isElectron) {
      window.electronAPI.saveAppData(`note_${note.id}`, nextNote)
    }
  }, [note.id, updateNote])

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

  const handleAddTodo = () => {
    if (!newTodo.trim()) return
    addItem(note.id, newTodo.trim())
    setNewTodo('')
  }

  const handleUndock = () => {
    if (!window.electronAPI?.isElectron) return
    const nextNote = { ...note, isDocked: false, updatedAt: new Date().toISOString() }
    persistNote(nextNote)
    window.electronAPI.undockNote(note.id, nextNote)
    setShowMenu(false)
  }

  const undockAt = useCallback((clientX: number, clientY: number) => {
    if (!window.electronAPI?.isElectron) return
    const nextNote = { ...note, isDocked: false, updatedAt: new Date().toISOString() }
    persistNote(nextNote)
    window.electronAPI.undockNoteAt(
      note.id,
      Math.round(window.screenX + clientX - 110),
      Math.round(window.screenY + clientY - 28),
      nextNote,
    )
  }, [note, persistNote])

  const updateColor = useCallback((color: string) => {
    persistNote({ ...note, color, updatedAt: new Date().toISOString() })
    setShowMenu(false)
  }, [note, persistNote])

  const toggleEchoTag = useCallback((tagId: string) => {
    if (!isEcho) return
    const next = selectedEchoTagIds.includes(tagId)
      ? selectedEchoTagIds.filter((id) => id !== tagId)
      : [...selectedEchoTagIds, tagId]
    persistNote({ ...note, viewTagIds: next, echoTagId: next[0], updatedAt: new Date().toISOString() })
  }, [isEcho, note, persistNote, selectedEchoTagIds])

  const openMenu = useCallback(() => {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      const menuWidth = 192
      const menuHeight = isEcho ? 252 : 162
      const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8)
      const left = Math.max(8, Math.min(maxLeft, rect.right - menuWidth))
      const top = rect.top > menuHeight + 8
        ? rect.top - menuHeight - 6
        : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 4)
      setMenuPos({ top, left })
    }
    setShowMenu(true)
  }, [isEcho])

  const closeQuickEventForm = useCallback(() => {
    setShowQuickEventForm(false)
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return
    const handler = () => setShowMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showMenu])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editingTitle) return
    const target = e.target as HTMLElement
    if (target.closest('button,input,textarea,[data-no-card-drag]')) return
    const dockArea = target.closest('[data-dock-area]') as HTMLElement | null
    if (!dockArea) return
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dockRect: dockArea.getBoundingClientRect(),
      outside: false,
      moved: false,
      previewStarted: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [editingTitle])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== e.pointerId) return
    const dx = e.clientX - dragState.startX
    const dy = e.clientY - dragState.startY
    const distance = Math.hypot(dx, dy)
    if (distance <= 6 && !dragState.moved) return
    dragState.moved = true

    const { dockRect } = dragState
    const outsideDock =
      e.clientX < dockRect.left - 28 ||
      e.clientX > dockRect.right + 28 ||
      e.clientY < dockRect.top - 28 ||
      e.clientY > dockRect.bottom + 28

    dragState.outside = outsideDock && distance > 24
    setDragPreview({ x: e.clientX, y: e.clientY, outside: dragState.outside })
    if (window.electronAPI?.isElectron) {
      if (!dragState.previewStarted) {
        dragState.previewStarted = true
        window.electronAPI.beginDockDragPreview(note, e.screenX, e.screenY)
      }
      window.electronAPI.moveDockDragPreview(e.screenX, e.screenY, dragState.outside)
    }
  }, [note])

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState?.pointerId === e.pointerId) {
      if (dragState.outside && dragState.moved) {
        undockAt(e.clientX, e.clientY)
      }
      if (window.electronAPI?.isElectron && dragState.previewStarted) {
        window.electronAPI.endDockDragPreview()
      }
      dragStateRef.current = null
      setDragPreview(null)
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
  }, [undockAt])

  return (
    <div
      className={`docked-note-card relative flex flex-col h-full rounded-lg overflow-hidden select-none ${isEcho ? 'docked-note-card-echo' : isDaily ? 'docked-note-card-daily' : 'docked-note-card-independent'} ${isActive ? 'docked-note-card-active' : 'docked-note-card-inactive'} ${dragPreview ? 'docked-note-card-dragging' : ''} ${attention ? 'docked-note-card-attention' : ''}`}
      style={{
        backgroundColor: bgWithAlpha,
        color: textColor,
        ['--note-text' as string]: textColor,
        ['--note-muted' as string]: mutedTextColor,
        ['--note-panel' as string]: panelBg,
        ['--note-panel-border' as string]: panelBorder,
        ['--note-accent' as string]: noteColor,
        ['--note-shell' as string]: bgWithAlpha,
        fontFamily: `"${noteSettings.fontFamily}", system-ui, sans-serif`,
        fontSize: noteSettings.fontSize,
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-2 py-1.5 shrink-0 cursor-grab active:cursor-grabbing"
        style={{ WebkitAppRegion: 'no-drag', touchAction: 'none' } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: noteColor }} />
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
              className="flex-1 bg-white/10 rounded px-1 py-0 text-[0.78em] outline-none min-w-0"
              data-no-card-drag
            />
          ) : (
            <span
              className="text-[0.78em] font-medium truncate cursor-pointer"
              onDoubleClick={startEditTitle}
              data-no-card-drag
              title="双击编辑标题"
            >
              {note.title}
            </span>
          )}
          <span className={`text-[0.58em] px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1 docked-note-kind-badge ${isEcho ? 'docked-note-kind-badge-echo' : isDaily ? 'docked-note-kind-badge-daily' : 'docked-note-kind-badge-independent'}`}>
            {isEcho ? <Eye size={9} /> : isDaily ? <CalendarCheck size={9} /> : <ListTodo size={9} />}
            {isEcho ? '视图' : isDaily ? '每日' : '独立'}
          </span>
          {isEcho && selectedEchoTags.length > 0 && (
            <span className="text-[0.6em] px-1.5 py-0.5 rounded-full shrink-0 docked-note-chip">
              {selectedEchoTags[0].name}
              {selectedEchoTags.length > 1 ? ` +${selectedEchoTags.length - 1}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* Undock / Delete via menu */}
          <button
            ref={menuBtnRef}
            onClick={(e) => { e.stopPropagation(); openMenu() }}
            className="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <MoreHorizontal size={12} />
          </button>
        </div>
      </div>

      {isDaily ? (
        <DailyTodoPanel
          note={note}
          compact
          panelBg={panelBg}
          panelBorder={panelBorder}
          textColor={textColor}
          mutedColor={mutedTextColor}
          lightBg={lightBg}
        />
      ) : (
        <>
          {/* Body */}
          <div
            className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-1.5"
            data-note-wheel-scroll
            onWheel={(event) => event.stopPropagation()}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {isEcho ? (
              <>
                {showQuickEventForm && (
                  <QuickEventForm
                    note={note}
                    onClose={closeQuickEventForm}
                    onSaved={closeQuickEventForm}
                  />
                )}
                <EchoEventList
                  note={note}
                  compact
                  onSelectEvent={(event) => {
                    window.electronAPI?.openEventEditor(event)
                  }}
                />
              </>
            ) : (
              <div className="flex flex-col gap-0.5">
                {(note.items || []).map((item) => (
                  <TodoItem key={item.id} item={item} note={note} />
                ))}
                {(note.items || []).length === 0 && (
                  <div className="py-6 text-center text-[0.7em] opacity-20">暂无待办</div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-2.5 py-1.5 shrink-0 border-t" style={{ borderColor: panelBorder, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {isEcho ? (
              <button
                onClick={() => {
                  setShowQuickEventForm(true)
                }}
                className="w-full text-[0.7em] py-1.5 rounded-md docked-note-input transition-colors"
              >
                + 新建事件
              </button>
            ) : (
              <div className="flex gap-1">
                <input
                  value={newTodo}
                  onChange={(e) => setNewTodo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo() }}
                  placeholder="添加待办..."
                  className="flex-1 docked-note-input rounded-md px-2 py-1.5 text-[0.7em] outline-none placeholder:opacity-70"
                />
                <button
                  onClick={handleAddTodo}
                  disabled={!newTodo.trim()}
                  className="px-2 py-1 rounded-md docked-note-input transition-colors disabled:opacity-35"
                >
                  <Plus size={12} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Portal menu */}
      {showMenu && createPortal(
        <div className="fixed inset-0 z-[9999]" onClick={() => setShowMenu(false)}>
          <div
            className="absolute w-48 bg-background/95 backdrop-blur-xl border border-white/8 rounded-lg shadow-2xl py-1 z-[10000]"
            style={{ top: menuPos.top, left: menuPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2">
              <div className="flex gap-1.5 flex-wrap">
                {NOTE_COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => updateColor(color)}
                    className={`h-4 w-4 rounded-full transition-transform hover:scale-125 ${color === noteColor ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-background' : ''}`}
                    style={{
                      backgroundColor: color,
                      boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.20)',
                    }}
                    title="更换颜色"
                  />
                ))}
              </div>
            </div>
            {isEcho && (
              <>
                <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
                <div className="px-3 py-1">
                  <div className="text-[0.62em] opacity-30 mb-1">视图标签</div>
                  <div className="space-y-0.5 max-h-28 overflow-y-auto">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleEchoTag(tag.id)}
                        className={`w-full text-left px-2 py-1 text-[0.72em] rounded flex items-center gap-1.5 hover:bg-white/5 transition-colors ${selectedEchoTagIds.includes(tag.id) ? 'bg-white/10 opacity-90' : ''}`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        <span className="truncate flex-1">{tag.name}</span>
                        {selectedEchoTagIds.includes(tag.id) && <Check size={10} className="opacity-55" />}
                      </button>
                    ))}
                    {tags.length === 0 && (
                      <div className="px-2 py-1 text-[0.68em] opacity-25">暂无标签，请先在设置中创建</div>
                    )}
                  </div>
                </div>
              </>
            )}
            <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
            <button
              onClick={handleUndock}
              className="w-full text-left px-3 py-1.5 text-[0.75em] hover:bg-white/5 transition-colors"
            >
              取消挂载
            </button>
            <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
            <button
              onClick={() => { deleteNote(note.id); window.electronAPI?.deleteNote(note.id); setShowMenu(false) }}
              className="w-full text-left px-3 py-1.5 text-[0.75em] text-red-400 hover:bg-white/5 transition-colors"
            >
              删除便签
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
