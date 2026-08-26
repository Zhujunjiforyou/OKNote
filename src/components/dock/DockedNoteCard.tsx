import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNotesStore } from '@/stores/notes.store'
import { useTagStore } from '@/stores/tag.store'
import type { Note } from '@/types/notes.types'
import { TodoItem } from '@/components/notes/TodoItem'
import { EchoEventList } from '@/components/notes/EchoEventList'
import { QuickEventForm } from '@/components/notes/QuickEventForm'
import { Plus, MoreHorizontal } from 'lucide-react'
import { NOTE_COLOR_PALETTE, isLightColor, normalizeHexColor } from '@/lib/utils'
import type { EventTag } from '@/types/tag.types'
import type { PerWindowSettings } from '@/types/electron'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { reportPersistenceIssue } from '@/stores/persistence.store'
import { clampFontSize, getAdaptiveDisplayFontSize } from '@/lib/typography'

const DailyTodoPanel = lazy(() => import('@/components/notes/DailyTodoPanel').then((module) => ({ default: module.DailyTodoPanel })))

export type DockedNoteDraftKind = 'quick-event' | 'note-title' | 'new-todo' | 'todo-edit' | 'date-edit'

interface DockedNoteCardProps {
  note: Note
  isActive: boolean
  attention?: boolean
  noteSettings: PerWindowSettings
  previewOnly?: boolean
  onDraftChange?: (key: string, kind: DockedNoteDraftKind, dirty: boolean) => void
}

export function DockedNoteCard({ note, isActive, attention = false, noteSettings, previewOnly = false, onDraftChange }: DockedNoteCardProps) {
  const updateNote = useNotesStore((s) => s.updateNote)
  const addItem = useNotesStore((s) => s.addItem)
  const deleteNote = useNotesStore((s) => s.deleteNote)
  const tags = useTagStore((s) => s.tags)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [newTodo, setNewTodo] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showQuickEventForm, setShowQuickEventForm] = useState(false)
  const [quickEventDirty, setQuickEventDirty] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; dockRect: DOMRect; outside: boolean; moved: boolean; previewStarted: boolean } | null>(null)
  const previewMoveFrameRef = useRef<number | null>(null)
  const pendingPreviewMoveRef = useRef<{ x: number; y: number; outside: boolean } | null>(null)
  const undockingRef = useRef(false)

  const isEcho = note.noteType === 'echo'
  const isDaily = note.noteType === 'daily'
  const selectedEchoTagIds = isEcho
    ? (Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
        ? note.viewTagIds
        : (note.echoTagId ? [note.echoTagId] : []))
    : []
  const selectedEchoTags = selectedEchoTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is EventTag => !!tag)
  const noteColor = normalizeHexColor(note.color)
  const noteSurfaceColor = noteColor
  const noteOpacity = noteSettings.backgroundOpacity
  const bgWithAlpha = noteSurfaceColor + Math.round(noteOpacity * 255).toString(16).padStart(2, '0').slice(0, 2)
  const lightBg = isLightColor(noteSurfaceColor)
  const textColor = lightBg ? '#111827' : '#f8fafc'
  const mutedTextColor = lightBg ? 'rgba(17, 24, 39, 0.64)' : 'rgba(248, 250, 252, 0.70)'
  const panelBg = lightBg ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.13)'
  const panelBorder = lightBg ? 'rgba(17,24,39,0.13)' : 'rgba(255,255,255,0.17)'
  const requestedNoteFontSize = clampFontSize(noteSettings.fontSize)
  const displayNoteFontSize = getAdaptiveDisplayFontSize(requestedNoteFontSize)

  const reportDraft = useCallback((key: string, kind: DockedNoteDraftKind, dirty: boolean) => {
    if (!previewOnly) onDraftChange?.(`${note.id}:${key}`, kind, dirty)
  }, [note.id, onDraftChange, previewOnly])

  useEffect(() => {
    reportDraft('title', 'note-title', editingTitle && titleDraft !== note.title)
  }, [editingTitle, note.title, reportDraft, titleDraft])
  useEffect(() => {
    reportDraft('composer', 'new-todo', newTodo.trim().length > 0)
  }, [newTodo, reportDraft])
  useEffect(() => {
    reportDraft('quick-event', 'quick-event', quickEventDirty)
  }, [quickEventDirty, reportDraft])
  useEffect(() => () => {
    reportDraft('title', 'note-title', false)
    reportDraft('composer', 'new-todo', false)
    reportDraft('quick-event', 'quick-event', false)
  }, [reportDraft])

  const handleTodoDraftChange = useCallback((itemId: string, dirty: boolean) => {
    reportDraft(`todo:${itemId}`, 'todo-edit', dirty)
  }, [reportDraft])

  const handleDailyDraftChange = useCallback((key: string, kind: 'new-todo' | 'todo-edit' | 'date-edit', dirty: boolean) => {
    reportDraft(key, kind, dirty)
  }, [reportDraft])

  const persistNote = useCallback((nextNote: Note) => {
    updateNote(nextNote)
  }, [updateNote])

  const startEditTitle = () => {
    setTitleDraft(note.title)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 50)
  }

  const saveTitle = () => {
    if (titleDraft.trim()) {
      useNotesStore.getState().updateNote({ ...note, title: titleDraft.trim().slice(0, 200), updatedAt: new Date().toISOString() })
    }
    setEditingTitle(false)
  }

  const handleAddTodo = () => {
    if (!newTodo.trim()) return
    addItem(note.id, newTodo.trim())
    setNewTodo('')
  }

  const handleUndock = async () => {
    if (!window.electronAPI?.isElectron || undockingRef.current) return
    undockingRef.current = true
    setShowMenu(false)
    const nextNote = { ...note, isDocked: false, updatedAt: new Date().toISOString() }
    try {
      const result = await window.electronAPI.undockNote(note.id, nextNote)
      if (!result.ok) {
        if (result.canceled) return
        reportPersistenceIssue('便签仍保留在挂载区', result.message || '取消挂载失败，请重试。', () => { void handleUndock() })
      }
    } catch (error) {
      reportPersistenceIssue('便签仍保留在挂载区', error instanceof Error ? error.message : '主进程没有响应。', () => { void handleUndock() })
    } finally {
      undockingRef.current = false
    }
  }

  const handleDeleteNote = () => {
    setShowMenu(false)
    setDeleteConfirmOpen(true)
  }

  const undockAt = useCallback(async (screenX: number, screenY: number) => {
    if (!window.electronAPI?.isElectron || undockingRef.current) return
    undockingRef.current = true
    const nextNote = { ...note, isDocked: false, updatedAt: new Date().toISOString() }
    try {
      const result = await window.electronAPI.undockNoteAt(
        note.id,
        Math.round(screenX - 110),
        Math.round(screenY - 28),
        nextNote,
      )
      if (!result.ok) {
        if (result.canceled) return
        reportPersistenceIssue('便签仍保留在挂载区', result.message || '拖出便签失败，请重试。', () => { void undockAt(screenX, screenY) })
      }
    } catch (error) {
      reportPersistenceIssue('便签仍保留在挂载区', error instanceof Error ? error.message : '主进程没有响应。', () => { void undockAt(screenX, screenY) })
    } finally {
      undockingRef.current = false
    }
  }, [note])

  const updateColor = useCallback((color: string) => {
    persistNote({ ...note, color, updatedAt: new Date().toISOString() })
    setShowMenu(false)
  }, [note, persistNote])

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

  useEffect(() => () => {
    if (previewMoveFrameRef.current != null) window.cancelAnimationFrame(previewMoveFrameRef.current)
  }, [])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setShowMenu(false)
      window.requestAnimationFrame(() => menuBtnRef.current?.focus())
      return
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    let targetIndex = currentIndex
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') targetIndex = (currentIndex + 1 + items.length) % items.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + items.length) % items.length
    else if (event.key === 'Home') targetIndex = 0
    else if (event.key === 'End') targetIndex = items.length - 1
    else return
    event.preventDefault()
    items[targetIndex]?.focus()
  }

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
    setIsDragging(true)
    if (window.electronAPI?.isElectron) {
      if (!dragState.previewStarted) {
        dragState.previewStarted = true
        window.electronAPI.beginDockDragPreview(note, e.screenX, e.screenY)
      }
      pendingPreviewMoveRef.current = { x: e.screenX, y: e.screenY, outside: dragState.outside }
      if (previewMoveFrameRef.current == null) {
        previewMoveFrameRef.current = window.requestAnimationFrame(() => {
          previewMoveFrameRef.current = null
          const pending = pendingPreviewMoveRef.current
          pendingPreviewMoveRef.current = null
          if (pending) window.electronAPI?.moveDockDragPreview(pending.x, pending.y, pending.outside)
        })
      }
    }
  }, [note])

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState?.pointerId === e.pointerId) {
      if (dragState.outside && dragState.moved) {
        void undockAt(e.screenX, e.screenY)
      }
      if (window.electronAPI?.isElectron && dragState.previewStarted) {
        if (previewMoveFrameRef.current != null) {
          window.cancelAnimationFrame(previewMoveFrameRef.current)
          previewMoveFrameRef.current = null
        }
        const pending = pendingPreviewMoveRef.current
        pendingPreviewMoveRef.current = null
        if (pending) window.electronAPI.moveDockDragPreview(pending.x, pending.y, pending.outside)
        window.electronAPI.endDockDragPreview()
      }
      dragStateRef.current = null
      setIsDragging(false)
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
  }, [undockAt])

  if (previewOnly) {
    return (
      <div
        className={`docked-note-card docked-note-card-inactive relative flex h-full flex-col overflow-hidden select-none ${requestedNoteFontSize <= 11 ? 'note-type-small' : requestedNoteFontSize >= 25 ? 'note-type-xlarge' : requestedNoteFontSize >= 19 ? 'note-type-large' : ''} ${requestedNoteFontSize >= 37 ? 'note-type-max' : ''}`}
        aria-hidden="true"
        style={{
          backgroundColor: bgWithAlpha,
          color: textColor,
          fontFamily: `"${noteSettings.fontFamily}", system-ui, sans-serif`,
          fontSize: displayNoteFontSize,
          ['--note-font-size' as string]: `${displayNoteFontSize}px`,
          ['--note-requested-font-size' as string]: requestedNoteFontSize,
        }}
      >
        <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[0.78em] font-medium">{note.title}</span>
          {!isDaily && (
            <span className={`docked-note-kind-badge shrink-0 px-1.5 py-0.5 text-[0.58em] ${isEcho ? 'docked-note-kind-badge-echo' : 'docked-note-kind-badge-independent'}`}>
              {isEcho ? '视图' : '独立'}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden px-2.5 py-1 text-[0.7em] opacity-55">
          {isEcho ? '事件视图' : (note.items || []).length > 0 ? (note.items || []).slice(0, 4).map((item) => (
            <div key={item.id} className={`truncate py-0.5 ${item.isCompleted ? 'line-through opacity-50' : ''}`}>{item.content}</div>
          )) : (isDaily ? '今日暂无事项' : '空白便签')}
        </div>
      </div>
    )
  }

  return (
    <div
      data-note-id={note.id}
      className={`docked-note-card relative flex flex-col h-full overflow-hidden ${isEcho ? 'docked-note-card-echo' : isDaily ? 'docked-note-card-daily' : 'docked-note-card-independent'} ${isActive ? 'docked-note-card-active' : 'docked-note-card-inactive'} ${isDragging ? 'docked-note-card-dragging' : ''} ${attention ? 'docked-note-card-attention' : ''} ${requestedNoteFontSize <= 11 ? 'note-type-small' : requestedNoteFontSize >= 25 ? 'note-type-xlarge' : requestedNoteFontSize >= 19 ? 'note-type-large' : ''} ${requestedNoteFontSize >= 37 ? 'note-type-max' : ''}`}
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
        fontSize: displayNoteFontSize,
        ['--note-font-size' as string]: `${displayNoteFontSize}px`,
        ['--note-requested-font-size' as string]: requestedNoteFontSize,
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-2 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none"
        style={{ WebkitAppRegion: 'no-drag', touchAction: 'none' } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              maxLength={200}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
              className="flex-1 bg-white/10 rounded px-1 py-0 text-[0.78em] outline-none min-w-0"
              aria-label="编辑挂载便签标题"
              data-no-card-drag
            />
          ) : (
            <span
              className="text-[0.78em] font-medium truncate cursor-pointer"
              onClick={startEditTitle}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startEditTitle() } }}
              data-no-card-drag
              title="点击、Enter 或 F2 编辑标题"
              role="button"
              tabIndex={0}
            >
              {note.title}
            </span>
          )}
          {!isDaily && (
            <span className={`text-[0.58em] px-1.5 py-0.5 shrink-0 inline-flex items-center docked-note-kind-badge ${isEcho ? 'docked-note-kind-badge-echo' : 'docked-note-kind-badge-independent'}`}>
              {isEcho ? '标签视图' : '独立'}
            </span>
          )}
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
            className="touch-target h-7 w-7 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="打开便签菜单"
            aria-expanded={showMenu}
          >
            <MoreHorizontal size={12} />
          </button>
        </div>
      </div>

      {isDaily ? (
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[0.7em] opacity-40">加载每日待办…</div>}>
          <DailyTodoPanel
            note={note}
            compact
            panelBg={panelBg}
            panelBorder={panelBorder}
            textColor={textColor}
            mutedColor={mutedTextColor}
            lightBg={lightBg}
            onDraftChange={handleDailyDraftChange}
          />
        </Suspense>
      ) : (
        <>
          {/* Body */}
          <div
            className="docked-note-body flex-1 min-h-0 overflow-y-auto px-2.5 pb-1.5"
            data-note-wheel-scroll
            onWheel={(event) => event.stopPropagation()}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {isEcho ? (
              <>
                {showQuickEventForm && (
                  <QuickEventForm
                    note={note}
                    surfaceColor={noteSurfaceColor}
                    textColor={textColor}
                    onClose={closeQuickEventForm}
                    onSaved={closeQuickEventForm}
                    onDirtyChange={setQuickEventDirty}
                  />
                )}
                <EchoEventList
                  note={note}
                  compact
                  surfaceColor={noteSurfaceColor}
                  textColor={textColor}
                  onSelectEvent={(event) => {
                    window.electronAPI?.openEventEditor(event)
                  }}
                />
              </>
            ) : (
              <div className="flex flex-col gap-0.5">
                {(note.items || []).map((item) => (
                  <TodoItem key={item.id} item={item} note={note} onDraftChange={handleTodoDraftChange} />
                ))}
                {(note.items || []).length === 0 && (
                  <div className="py-6 text-center text-[0.7em] opacity-20">暂无待办</div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="docked-note-footer px-2.5 py-1.5 shrink-0 border-t" style={{ borderColor: panelBorder, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
                  maxLength={2000}
                  onChange={(e) => setNewTodo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo() }}
                  onBlur={handleAddTodo}
                  placeholder="添加待办..."
                  className="flex-1 docked-note-input rounded-md px-2 py-1.5 text-[0.7em] outline-none placeholder:opacity-70"
                  aria-label="待办内容"
                />
                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleAddTodo}
                  disabled={!newTodo.trim()}
                  className="px-2 py-1 rounded-md docked-note-input transition-colors disabled:opacity-35"
                  aria-label="添加待办"
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
            className="absolute max-h-[calc(100vh-16px)] w-48 overflow-y-auto bg-background/95 backdrop-blur-xl border border-white/8 rounded-lg shadow-2xl py-1 z-[10000]"
            style={{ top: menuPos.top, left: menuPos.left }}
            onClick={(e) => e.stopPropagation()}
            role="menu"
            aria-label="便签操作"
            onKeyDown={handleMenuKeyDown}
          >
            <div className="px-3 py-2">
              <div className="flex gap-1.5 flex-wrap">
                {NOTE_COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => updateColor(color)}
                    className={`touch-target h-6 w-6 rounded-full transition-transform hover:scale-110 ${color === noteColor ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-background' : ''}`}
                    style={{
                      backgroundColor: color,
                      boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.20)',
                    }}
                    title="更换颜色"
                    aria-label={`将便签颜色设为 ${color}`}
                    role="menuitemradio"
                    aria-checked={color === noteColor}
                    autoFocus={color === NOTE_COLOR_PALETTE[0]}
                  />
                ))}
              </div>
            </div>
            {isEcho && (
              <>
                <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
                <div className="px-3 py-1.5">
                  <div className="text-[0.62em] opacity-35">绑定标签</div>
                  <div className="mt-0.5 truncate text-[0.72em] opacity-70">{selectedEchoTags.map((tag) => tag.name).join('、') || '标签已删除'}</div>
                </div>
              </>
            )}
            <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
            <button
              onClick={handleUndock}
              className="touch-target min-h-8 w-full text-left px-3 py-1.5 text-[0.75em] hover:bg-white/5 transition-colors"
              role="menuitem"
            >
              取消挂载
            </button>
            <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
            <button
              onClick={handleDeleteNote}
              className="touch-target min-h-8 w-full text-left px-3 py-1.5 text-[0.75em] text-red-400 hover:bg-white/5 transition-colors"
              role="menuitem"
            >
              移入回收站
            </button>
          </div>
        </div>,
        document.body
      )}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="将便签移入回收站？"
        description={`“${note.title}”会从日历挂载区移除，可稍后在设置的“便签管理”中恢复。`}
        confirmLabel="移入回收站"
        destructive
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false)
          deleteNote(note.id)
        }}
      />
    </div>
  )
}
