import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import { useNotesStore } from '@/stores/notes.store'
import { useTagStore } from '@/stores/tag.store'
import { Plus, MoreHorizontal, X, GripHorizontal, Settings, Tag } from 'lucide-react'
import { TodoItem } from '@/components/notes/TodoItem'
import { EchoEventList } from '@/components/notes/EchoEventList'
import { QuickEventForm } from '@/components/notes/QuickEventForm'
import { useAppSettings } from '@/hooks/useAppSettings'
import { NOTE_COLOR_PALETTE, focusAdjacentInteractiveElement, isImeComposing, isLightColor, normalizeHexColor, normalizeNote } from '@/lib/utils'
import type { Note } from '@/types/notes.types'
import type { EventTag } from '@/types/tag.types'
import { reportPersistenceIssue } from '@/stores/persistence.store'
import { clampFontSize, getAdaptiveDisplayFontSize } from '@/lib/typography'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { WindowDraftEntry, WindowDraftKind } from '@/types/electron'

const DailyTodoPanel = lazy(() => import('@/components/notes/DailyTodoPanel').then((module) => ({ default: module.DailyTodoPanel })))

interface NoteWindowProps { noteId: string; isNew?: boolean }

function createDefaultNote(noteId: string): Note {
  const ts = new Date().toISOString()
  return {
    id: noteId, title: '新便签',
    color: NOTE_COLOR_PALETTE[Math.floor(Math.random() * NOTE_COLOR_PALETTE.length)],
    items: [],
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

  const { settings, loaded } = useAppSettings('notes')
  const note = notes.find((n) => n.id === noteId)
  const noteColorForChrome = normalizeHexColor(note?.color)

  useEffect(() => {
    document.documentElement.classList.toggle('light', isLightColor(noteColorForChrome))
    document.documentElement.classList.add('electron-transparent')
  }, [noteColorForChrome])

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [confirmAction, setConfirmAction] = useState<'delete' | null>(null)

  useEffect(() => {
    if (!loaded) return
    if (notes.find((n) => n.id === noteId)) {
      setLoadState('ready')
      return
    }
    if (!window.electronAPI?.isElectron) {
      if (isNew) {
        addNote(createDefaultNote(noteId))
        setLoadState('ready')
      } else {
        setLoadError('浏览器预览无法读取本地便签文件。')
        setLoadState('error')
      }
      return
    }
    let cancelled = false
    setLoadState('loading')
    setLoadError('')
    const load = async () => {
      try {
        const data = await window.electronAPI!.loadNote(noteId)
        if (cancelled) return
        if (data && typeof data === 'object') {
          const rawNote = data as Record<string, unknown>
          loadNotes([normalizeNote({ ...rawNote, id: noteId })])
          setLoadState('ready')
          return
        }
        if (isNew) {
          const state = useNotesStore.getState()
          if (!state.notes.find((n) => n.id === noteId)) {
            addNote(createDefaultNote(noteId))
          }
          setLoadState('ready')
          return
        }
        setLoadError('主文件与备份都无法读取，原文件已保留，未写入任何替代内容。')
        setLoadState('error')
      } catch (err) {
        if (cancelled) return
        console.error('NoteWindow init failed:', noteId, err)
        setLoadError(err instanceof Error ? err.message : '便签读取失败。')
        setLoadState('error')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [loaded, noteId, isNew, notes, loadNotes, addNote, loadAttempt])

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [newTodo, setNewTodo] = useState('')
  const [isHiding, setIsHiding] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showQuickEventForm, setShowQuickEventForm] = useState(false)
  const [quickEventDirty, setQuickEventDirty] = useState(false)
  const [childDrafts, setChildDrafts] = useState<Record<string, 'new-todo' | 'todo-edit' | 'date-edit'>>({})
  const [isDockTargetPreview, setIsDockTargetPreview] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const tags = useTagStore((s) => s.tags)
  const loadTagsState = useTagStore((s) => s.loadTagsState)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const windowDragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const windowDragMoveFrameRef = useRef<number | null>(null)
  const pendingWindowDragMoveRef = useRef<{ x: number; y: number } | null>(null)
  const suppressTitleClickRef = useRef(false)

  const openMenu = useCallback(() => {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      const menuWidth = Math.min(176, Math.max(144, window.innerWidth - 16))
      const menuHeight = Math.min(360, Math.max(120, window.innerHeight - 16))
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
      const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 4))
      setMenuPos({ top, left })
    }
    setShowMenu(true)
  }, [])

  useEffect(() => {
    if (!showMenu) return
    const handler = () => setShowMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showMenu])

  useEffect(() => () => {
    if (windowDragMoveFrameRef.current != null) window.cancelAnimationFrame(windowDragMoveFrameRef.current)
  }, [])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setShowMenu(false)
      window.requestAnimationFrame(() => menuBtnRef.current?.focus())
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const backwards = event.shiftKey
      setShowMenu(false)
      window.setTimeout(() => focusAdjacentInteractiveElement(menuBtnRef.current, backwards), 0)
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

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    const reloadTags = () => window.electronAPI!.getTags().then((data) => {
      loadTagsState(data)
    }).catch((error) => {
      reportPersistenceIssue('标签读取失败', error instanceof Error ? error.message : '无法刷新标签。', reloadTags)
    })
    void reloadTags()
    return window.electronAPI.onTagsChanged(() => {
      void reloadTags()
    })
  }, [loadTagsState])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onNoteDockHover((inside) => {
      setIsDockTargetPreview(inside)
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    const kinds: WindowDraftKind[] = []
    if (quickEventDirty) kinds.push('quick-event')
    if (editingTitle && note && titleDraft !== note.title) kinds.push('note-title')
    if (newTodo.trim()) kinds.push('new-todo')
    for (const kind of new Set(Object.values(childDrafts))) kinds.push(kind)
    const entries: WindowDraftEntry[] = kinds.map((kind) => ({ kind, noteId }))
    window.electronAPI.setWindowDraftState(entries)
  }, [childDrafts, editingTitle, newTodo, note?.title, noteId, quickEventDirty, titleDraft])

  const handleChildDraftChange = useCallback((key: string, kind: 'new-todo' | 'todo-edit' | 'date-edit', dirty: boolean) => {
    setChildDrafts((current) => {
      if (dirty && current[key] === kind) return current
      if (!dirty && !(key in current)) return current
      const next = { ...current }
      if (dirty) next[key] = kind
      else delete next[key]
      return next
    })
  }, [])

  const handleTodoDraftChange = useCallback((itemId: string, dirty: boolean) => {
    handleChildDraftChange(`todo:${itemId}`, 'todo-edit', dirty)
  }, [handleChildDraftChange])

  useEffect(() => () => {
    window.electronAPI?.setWindowDraftState([])
  }, [])

  if (!note) {
    if (loadState === 'error') {
      return (
        <div className="note-load-state h-screen w-screen overflow-auto bg-[#08111f] p-4 text-slate-100">
          <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center">
            <h1 className="text-base font-semibold">便签无法载入</h1>
            <p className="mt-2 select-text text-sm leading-relaxed text-slate-300">{loadError}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="min-h-9 rounded-lg bg-blue-500 px-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
                重新读取
              </button>
              <button type="button" onClick={() => window.electronAPI?.closeWindow()} className="min-h-9 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300">
                关闭窗口
              </button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="h-screen w-screen flex items-center justify-center select-none overflow-hidden bg-[#08111f] animate-note-in">
        <div className="relative flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-300 shadow-xl">
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
      useNotesStore.getState().updateNote({ ...note, title: titleDraft.trim().slice(0, 200), updatedAt: new Date().toISOString() })
    }
    setEditingTitle(false)
  }

  const isEcho = note.noteType === 'echo'
  const isDaily = note.noteType === 'daily'

  const handleAddTodo = () => {
    if (newTodo.trim()) { addItem(note.id, newTodo.trim()); setNewTodo('') }
  }

  const performHide = async () => {
    if (isHiding || !window.electronAPI?.isElectron) return
    const snapshot = useNotesStore.getState().notes.find((item) => item.id === note.id) || note
    setIsHiding(true)
    try {
      const result = await window.electronAPI.hideNote(snapshot)
      if (!result.ok) {
        if (result.canceled) return
        reportPersistenceIssue(
          '便签保持打开',
          result.message || '当前内容未能完整写入磁盘，已取消隐藏。',
          () => performHide(),
        )
      }
    } catch (error) {
      reportPersistenceIssue(
        '便签保持打开',
        error instanceof Error ? error.message : '主进程没有响应，已取消隐藏以避免丢失内容。',
        () => performHide(),
      )
    } finally {
      setIsHiding(false)
    }
  }

  const handleHide = async () => {
    await performHide()
  }

  const handleDeleteNote = () => {
    setConfirmAction('delete')
  }

  const handleDock = async () => {
    if (!window.electronAPI?.isElectron) return
    const nextNote = { ...note, isDocked: true, dockedOrder: note.dockedOrder ?? Date.now(), updatedAt: new Date().toISOString() }
    setShowMenu(false)
    const result = await window.electronAPI.dockNote(note.id, nextNote)
    if (!result.ok) {
      if (result.canceled) return
      reportPersistenceIssue('便签未挂载', result.message || '当前便签仍保留在原窗口。', () => { void handleDock() })
      return
    }
    if (result.note) updateNote(normalizeNote(result.note))
  }

  const handleUndock = async () => {
    if (!window.electronAPI?.isElectron) return
    const nextNote = { ...note, isDocked: false, updatedAt: new Date().toISOString() }
    setShowMenu(false)
    try {
      const result = await window.electronAPI.undockNote(note.id, nextNote)
      if (!result.ok) {
        if (result.canceled) return
        reportPersistenceIssue('便签仍保持挂载', result.message || '取消挂载失败，请重试。', () => { void handleUndock() })
        return
      }
      if (result.note) updateNote(normalizeNote(result.note))
    } catch (error) {
      reportPersistenceIssue('便签仍保持挂载', error instanceof Error ? error.message : '主进程没有响应。', () => { void handleUndock() })
    }
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
    if (window.electronAPI?.isElectron && drag.moved) {
      pendingWindowDragMoveRef.current = { x: e.screenX, y: e.screenY }
      if (windowDragMoveFrameRef.current == null) {
        windowDragMoveFrameRef.current = window.requestAnimationFrame(() => {
          windowDragMoveFrameRef.current = null
          const pending = pendingWindowDragMoveRef.current
          pendingWindowDragMoveRef.current = null
          if (pending) window.electronAPI?.moveNoteWindowDrag(pending.x, pending.y)
        })
      }
    }
  }

  const handleWindowDragPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = windowDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    windowDragRef.current = null
    if (window.electronAPI?.isElectron) {
      if (windowDragMoveFrameRef.current != null) {
        window.cancelAnimationFrame(windowDragMoveFrameRef.current)
        windowDragMoveFrameRef.current = null
      }
      const pending = pendingWindowDragMoveRef.current
      pendingWindowDragMoveRef.current = null
      if (pending) window.electronAPI.moveNoteWindowDrag(pending.x, pending.y)
      window.electronAPI.endNoteWindowDrag(e.screenX, e.screenY, drag.moved)
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const closeQuickEventForm = () => {
    setShowQuickEventForm(false)
  }

  const isDocked = note.isDocked === true
  const noteColorHex = normalizeHexColor(note.color)
  const noteSurfaceColor = noteColorHex
  const bgHex = noteSurfaceColor.replace('#', '')
  const noteOpacity = settings.backgroundOpacity
  const bgWithAlpha = `#${bgHex}${Math.round(noteOpacity * 255).toString(16).padStart(2, '0')}`
  const noteFont = settings.fontFamily || 'Microsoft YaHei'
  const requestedNoteFontSize = clampFontSize(settings.fontSize || 14)
  const noteFontSize = getAdaptiveDisplayFontSize(requestedNoteFontSize)
  const safeItems = Array.isArray(note.items) ? note.items : ([] as Note['items'])
  const selectedEchoTagIds = isEcho
    ? (Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
        ? note.viewTagIds
        : (note.echoTagId ? [note.echoTagId] : []))
    : []
  const selectedEchoTags = selectedEchoTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is EventTag => !!tag)

  const lightBg = isLightColor(noteSurfaceColor)
  const noteTextColor = lightBg ? '#111827' : '#f8fafc'
  const noteMutedColor = lightBg ? 'rgba(17, 24, 39, 0.66)' : 'rgba(248, 250, 252, 0.74)'
  const notePanelBg = lightBg ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.13)'
  const notePanelBorder = lightBg ? 'rgba(17,24,39,0.13)' : 'rgba(255,255,255,0.17)'

  return (
    <div
      className={`note-window-root h-screen w-screen flex flex-col overflow-hidden animate-note-in ${isEcho ? 'note-window-echo-note' : isDaily ? 'note-window-daily-note' : 'note-window-independent-note'} ${isDockTargetPreview ? 'note-window-dock-target' : ''} ${requestedNoteFontSize <= 11 ? 'note-type-small' : requestedNoteFontSize >= 25 ? 'note-type-xlarge' : requestedNoteFontSize >= 19 ? 'note-type-large' : ''} ${requestedNoteFontSize >= 37 ? 'note-type-max' : ''}`}
      style={{
        fontFamily: `"${noteFont}", system-ui, sans-serif`,
        color: noteTextColor,
        fontSize: noteFontSize,
        ['--note-font-size' as string]: `${noteFontSize}px`,
        ['--note-requested-font-size' as string]: requestedNoteFontSize,
        ['--note-text' as string]: noteTextColor,
        ['--note-muted' as string]: noteMutedColor,
        ['--note-panel' as string]: notePanelBg,
        ['--note-panel-border' as string]: notePanelBorder,
        ['--note-shell' as string]: bgWithAlpha,
        ['--note-accent' as string]: noteColorHex,
      }}
    >
      <div className="absolute inset-0 note-window-base" />

      {/* Title bar */}
      <div
        className="relative note-window-titlebar flex items-center justify-between px-3 py-2 shrink-0 cursor-grab active:cursor-grabbing select-none"
        style={{ WebkitAppRegion: 'no-drag', touchAction: 'none' } as React.CSSProperties}
        onPointerDown={handleWindowDragPointerDown}
        onPointerMove={handleWindowDragPointerMove}
        onPointerUp={handleWindowDragPointerEnd}
        onPointerCancel={handleWindowDragPointerEnd}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <GripHorizontal size={10} className="opacity-45 shrink-0" />

          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              maxLength={200}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
              className="note-window-title flex-1 bg-white/5 rounded px-1.5 py-0.5 text-[1em] font-semibold outline-none min-w-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              aria-label={`编辑${isEcho ? '标签视图便签' : isDaily ? '每日待办' : '独立便签'}标题`}
              data-no-window-drag
              autoFocus
            />
          ) : (
            <span
              onClick={startEditTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'F2') {
                  event.preventDefault()
                  startEditTitle()
                }
              }}
              className="note-window-title text-[1em] font-semibold tracking-wide truncate cursor-text hover:opacity-70 transition-opacity"
              style={{ WebkitAppRegion: 'no-drag', color: noteTextColor } as React.CSSProperties}
              title="点击、空格、Enter 或 F2 编辑标题"
              data-no-window-drag
              role="button"
              tabIndex={0}
            >
              {note.title}
            </span>
          )}
          {!isDaily && (
            <span
              className={`note-type-badge shrink-0 inline-flex items-center px-1.5 py-0.5 text-[0.62em] leading-none ${isEcho ? 'note-type-badge-echo' : 'note-type-badge-independent'}`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {isEcho ? '视图' : '独立'}
            </span>
          )}
          {isEcho && (
            selectedEchoTags.length > 0 ? (
              <span
                className="note-title-tag shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65em] leading-none"
                style={{ backgroundColor: notePanelBg, border: `1px solid ${notePanelBorder}`, color: noteTextColor, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: selectedEchoTags[0].color }} />
                {selectedEchoTags[0].name}
                {selectedEchoTags.length > 1 && <span className="opacity-60">+{selectedEchoTags.length - 1}</span>}
              </span>
            ) : (
              <span
                className="note-title-tag shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65em] leading-none opacity-30"
                style={{ backgroundColor: notePanelBg, border: `1px solid ${notePanelBorder}`, color: noteTextColor, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Tag size={9} />
                未选标签
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button ref={menuBtnRef} onClick={(e) => { e.stopPropagation(); openMenu() }} className="w-7 h-7 rounded-md flex items-center justify-center opacity-55 hover:opacity-100 hover:bg-white/10 transition-all" aria-label="打开便签菜单" aria-haspopup="menu" aria-expanded={showMenu}>
            <MoreHorizontal size={11} />
          </button>
          {showMenu && createPortal(
            <div className="fixed inset-0 z-[9999]" onClick={() => setShowMenu(false)}>
              <div
                className="absolute max-h-[calc(100vh-16px)] w-[min(11rem,calc(100vw-16px))] overflow-y-auto bg-background/95 backdrop-blur-xl border border-white/8 rounded-lg shadow-2xl py-1 z-[10000]"
                style={{ top: menuPos.top, left: menuPos.left }}
                onClick={(e) => e.stopPropagation()}
                role="menu"
                aria-label="便签操作"
                onKeyDown={handleMenuKeyDown}
              >
                <div className="px-2.5 py-1">
                  <div className="flex gap-1 flex-wrap max-w-[152px]">
                    {NOTE_COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => { updateNote({ ...note, color: c, updatedAt: new Date().toISOString() }); setShowMenu(false) }}
                        className={`touch-target w-6 h-6 rounded-full transition-transform hover:scale-110 ${c === noteColorHex ? 'ring-1.5 ring-white/70 ring-offset-1 ring-offset-background' : ''}`}
                        style={{
                          backgroundColor: c,
                          boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.20)',
                        }}
                        aria-label={`将便签颜色设为 ${c}`}
                        role="menuitemradio"
                        aria-checked={c === noteColorHex}
                        autoFocus={c === NOTE_COLOR_PALETTE[0]}
                      />
                    ))}
                  </div>
                </div>
                <hr className="border-white/5" />
                {isEcho ? (
                  <div>
                    <div className="px-2.5 py-1.5">
                      <p className="text-[0.6em] opacity-35">绑定标签</p>
                      <p className="mt-0.5 truncate text-[0.72em] opacity-70">{selectedEchoTags.map((tag) => tag.name).join('、') || '标签已删除'}</p>
                    </div>
                    <hr className="border-white/5" />
                  </div>
                ) : isDaily ? (
                  <div className="px-2.5 py-1 text-[0.72em] opacity-35">类型：每日待办</div>
                ) : (
                  <div className="px-2.5 py-1 text-[0.72em] opacity-35">类型：独立便签</div>
                )}
                <hr className="border-white/5" />
                {isDocked ? (
                  <button onClick={handleUndock} className="min-h-8 w-full text-left px-2.5 py-1 text-[0.8em] opacity-50 hover:opacity-80 hover:bg-white/5 transition-colors" role="menuitem">
                    取消挂载
                  </button>
                ) : (
                  <button onClick={() => { void handleDock() }} className="min-h-8 w-full text-left px-2.5 py-1 text-[0.8em] opacity-50 hover:opacity-80 hover:bg-white/5 transition-colors" role="menuitem">
                    挂载到日历
                  </button>
                )}
                <button onClick={handleDeleteNote} className="min-h-8 w-full text-left px-2.5 py-1 text-[0.8em] text-red-400/70 hover:text-red-400 hover:bg-red-500/5 transition-colors" role="menuitem">
                  移入回收站
                </button>
              </div>
            </div>,
            document.body
          )}
          <button onClick={() => window.electronAPI?.openSettings()} className="w-7 h-7 rounded-md flex items-center justify-center opacity-50 hover:opacity-100 hover:bg-white/10 transition-all" title="设置" aria-label="打开设置">
            <Settings size={11} />
          </button>
          <button
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => { void handleHide() }}
            disabled={isHiding}
            className="w-7 h-7 rounded-md flex items-center justify-center opacity-50 hover:opacity-100 hover:bg-white/10 hover:text-red-500 transition-all"
            aria-label="隐藏便签"
            title={isHiding ? '正在保存便签' : '隐藏便签'}
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Accent line */}
      <div className="relative note-accent-line mx-3 shrink-0 rounded-full" />

      {isDockTargetPreview && (
        <div className="note-dock-preview-hint relative mx-3 mt-2 shrink-0 rounded-md border px-2 py-1 text-center text-[0.68em] font-medium">
          松开鼠标挂载到日历
        </div>
      )}

      {/* Content area */}
      {isEcho ? (
        <EchoEventList
          note={note}
          surfaceColor={noteSurfaceColor}
          textColor={noteTextColor}
          onSelectEvent={(event) => {
            window.electronAPI?.openEventEditor(event)
          }}
        />
      ) : isDaily ? (
        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-xs opacity-40">加载每日待办…</div>}>
          <DailyTodoPanel
            note={note}
            panelBg={notePanelBg}
            panelBorder={notePanelBorder}
            textColor={noteTextColor}
            mutedColor={noteMutedColor}
            lightBg={lightBg}
            onDraftChange={handleChildDraftChange}
          />
        </Suspense>
      ) : (
        <div className="relative flex-1 px-3 py-1.5 space-y-1 overflow-y-auto overflow-x-hidden">
          <AnimatePresence initial={false}>
            {safeItems.map((item) => (
              <TodoItem
                key={item.id}
                item={item}
                note={note}
                onDraftChange={handleTodoDraftChange}
              />
            ))}
          </AnimatePresence>
          {safeItems.length === 0 && (
            <p className="text-[0.8em] opacity-35 py-3 text-center">输入待办事项...</p>
          )}
        </div>
      )}

      {/* Footer */}
      {isEcho ? (
        showQuickEventForm ? (
          <QuickEventForm
            note={note}
            surfaceColor={noteSurfaceColor}
            textColor={noteTextColor}
            onClose={closeQuickEventForm}
            onSaved={closeQuickEventForm}
            onDirtyChange={setQuickEventDirty}
          />
        ) : (
          <div className="relative px-3 pb-2.5 pt-1 shrink-0">
            <button
              onClick={() => {
                setShowQuickEventForm(true)
              }}
              className="note-composer-control w-full flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.82em] font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: notePanelBg, border: `1px solid ${notePanelBorder}`, color: noteTextColor }}
            >
              <Plus size={12} />
              新建事件
            </button>
          </div>
        )
      ) : !isDaily ? (
        <div className="relative px-3 pb-2.5 pt-1 shrink-0">
          <div
            className="note-composer-control flex items-center gap-2 border rounded-md px-2.5 py-1.5 transition-colors"
            style={{
              backgroundColor: notePanelBg,
              borderColor: notePanelBorder,
            }}
          >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleAddTodo}
              className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-opacity"
                style={{ opacity: 0.7, backgroundColor: lightBg ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.14)' }}
                aria-label="添加待办"
            >
              <Plus size={12} />
            </button>
            <input
              type="text"
              value={newTodo}
              maxLength={2000}
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => { if (!isImeComposing(e) && e.key === 'Enter') handleAddTodo() }}
              onBlur={handleAddTodo}
              placeholder="添加待办..."
              className="min-w-0 flex-1 bg-transparent text-[0.85em] outline-none placeholder:opacity-70"
              onFocus={() => setShowMenu(false)}
              style={{ color: noteTextColor }}
              aria-label="待办内容"
            />
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmAction === 'delete'}
        title="将便签移入回收站？"
        description={`“${note.title}”会从桌面移除，可稍后在设置的“便签管理”中恢复。`}
        confirmLabel="移入回收站"
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          setConfirmAction(null)
          deleteNote(note.id)
        }}
      />
    </div>
  )
}
