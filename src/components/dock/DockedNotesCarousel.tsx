import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useNotesStore } from '@/stores/notes.store'
import { DockedNoteCard, type DockedNoteDraftKind } from './DockedNoteCard'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useAppSettings } from '@/hooks/useAppSettings'
import { clampFontSize, getTypographyLayoutTier } from '@/lib/typography'

interface DockedNotesCarouselProps {
  onDraftChange?: (key: string, kind: DockedNoteDraftKind, dirty: boolean) => void
}

export function DockedNotesCarousel({ onDraftChange }: DockedNotesCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const notes = useNotesStore((s) => s.notes)
  const { settings: noteSettings } = useAppSettings('notes')
  const reduceMotion = useReducedMotion()
  const dockedNotes = useMemo(
    () => notes
      .filter((n) => n.isDocked && !n.isHidden && n.noteType !== 'view')
      .sort((a, b) => (a.dockedOrder ?? Number.MAX_SAFE_INTEGER) - (b.dockedOrder ?? Number.MAX_SAFE_INTEGER)
        || a.createdAt.localeCompare(b.createdAt)
        || a.id.localeCompare(b.id)),
    [notes]
  )

  const [activeIndex, setActiveIndex] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [slideDirection, setSlideDirection] = useState(1)
  const [attentionNoteId, setAttentionNoteId] = useState<string | null>(null)
  const [cardDrafts, setCardDrafts] = useState<Record<string, DockedNoteDraftKind>>({})
  const attentionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const requestedFontSize = clampFontSize(noteSettings.fontSize)
  const typographyLayoutTier = getTypographyLayoutTier(requestedFontSize)
  // Large text needs wider reading measure rather than taller empty rows. The
  // tier is derived only from the current setting, so reducing the font resets
  // every card to its ordinary geometry immediately.
  const targetCardWidth = typographyLayoutTier === 'ultra'
    ? 360
    : typographyLayoutTier === 'maximum'
      ? 320
      : typographyLayoutTier === 'large'
        ? 280
        : 232
  const cardWidth = Math.round(Math.min(targetCardWidth, Math.max(176, containerWidth - 72)))
  const cardGap = 14
  const edgeReserve = Math.min(96, Math.max(54, Math.round(cardWidth * 0.32)))
  const measuredCapacity = Math.max(1, Math.floor((containerWidth - edgeReserve) / (cardWidth + cardGap)))
  const tierCapacity = typographyLayoutTier === 'ultra' ? 1 : typographyLayoutTier === 'maximum' ? 2 : measuredCapacity
  const visibleCapacity = Math.max(1, Math.min(measuredCapacity, tierCapacity))
  const maxStartIndex = Math.max(0, dockedNotes.length - visibleCapacity)
  const useBoardLayout = dockedNotes.length > 0 && dockedNotes.length <= visibleCapacity
  const loopEnabled = dockedNotes.length > visibleCapacity
  const mod = useCallback((index: number) => {
    if (dockedNotes.length === 0) return 0
    return ((index % dockedNotes.length) + dockedNotes.length) % dockedNotes.length
  }, [dockedNotes.length])
  const visibleNotes = useMemo(() => {
    if (useBoardLayout) return dockedNotes
    return Array.from({ length: visibleCapacity }, (_, i) => dockedNotes[mod(activeIndex + i)]).filter(Boolean)
  }, [activeIndex, dockedNotes, mod, useBoardLayout, visibleCapacity])
  const dirtyNoteIds = useMemo(
    () => new Set(Object.keys(cardDrafts).map((key) => key.split(':', 1)[0]).filter(Boolean)),
    [cardDrafts],
  )
  // Cards with drafts remain mounted invisibly when they leave the visible
  // carousel page or a typography breakpoint reduces capacity. Their local
  // inputs therefore survive navigation without forcing a disruptive prompt.
  const mountedNotes = useMemo(() => {
    const visibleIds = new Set(visibleNotes.map((note) => note.id))
    return [...visibleNotes, ...dockedNotes.filter((note) => dirtyNoteIds.has(note.id) && !visibleIds.has(note.id))]
  }, [dirtyNoteIds, dockedNotes, visibleNotes])
  const leftPeekNote = loopEnabled ? dockedNotes[mod(activeIndex - 1)] : null
  const rightPeekNote = loopEnabled ? dockedNotes[mod(activeIndex + visibleCapacity)] : null
  const repeatedPeek = !!leftPeekNote && leftPeekNote.id === rightPeekNote?.id
  const visibleLeftPeek = repeatedPeek && slideDirection >= 0 ? null : leftPeekNote
  const visibleRightPeek = repeatedPeek && slideDirection < 0 ? null : rightPeekNote
  const boardWidth = visibleNotes.length * cardWidth + Math.max(0, visibleNotes.length - 1) * cardGap

  useEffect(() => {
    setActiveIndex((index) => {
      if (dockedNotes.length === 0) return 0
      return loopEnabled ? mod(index) : Math.min(index, maxStartIndex)
    })
  }, [dockedNotes.length, loopEnabled, maxStartIndex, mod, typographyLayoutTier])

  useEffect(() => {
    return () => {
      if (attentionTimerRef.current != null) window.clearTimeout(attentionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onFocusNote((payload) => {
      const noteId = payload?.noteId
      if (!noteId) return
      const index = dockedNotes.findIndex((note) => note.id === noteId)
      if (index >= 0) {
        setSlideDirection(index >= activeIndex ? 1 : -1)
        setActiveIndex(loopEnabled ? mod(index) : Math.min(index, maxStartIndex))
      }
      setAttentionNoteId(noteId)
      if (attentionTimerRef.current != null) window.clearTimeout(attentionTimerRef.current)
      attentionTimerRef.current = window.setTimeout(() => {
        setAttentionNoteId((current) => current === noteId ? null : current)
        attentionTimerRef.current = null
      }, 1700)
    })
  }, [activeIndex, dockedNotes, loopEnabled, maxStartIndex, mod])

  const step = useCallback((delta: number) => {
    setSlideDirection(delta >= 0 ? 1 : -1)
    setActiveIndex((index) => loopEnabled ? mod(index + delta) : Math.min(Math.max(0, index + delta), maxStartIndex))
  }, [loopEnabled, maxStartIndex, mod])

  const handleDraftChange = useCallback((key: string, kind: DockedNoteDraftKind, dirty: boolean) => {
    setCardDrafts((current) => {
      if (dirty && current[key] === kind) return current
      if (!dirty && !(key in current)) return current
      const next = { ...current }
      if (dirty) next[key] = kind
      else delete next[key]
      return next
    })
    onDraftChange?.(key, kind, dirty)
  }, [onDraftChange])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (useBoardLayout || dockedNotes.length <= visibleCapacity) return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (Math.abs(delta) < 8) return
    e.preventDefault()
    step(delta > 0 ? 1 : -1)
  }, [dockedNotes.length, step, useBoardLayout, visibleCapacity])

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 flex items-center justify-center carousel-container relative"
      data-font-layout={typographyLayoutTier}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onWheel={handleWheel}
    >
      {dockedNotes.length === 0 ? (
        <div className="dock-empty-state text-[0.75em] text-center select-none px-4">
          <div className="border border-dashed rounded-lg px-5 py-4" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
            <div className="font-medium opacity-50">暂无挂载便签</div>
            <div className="mt-1 text-[0.85em] opacity-35">在便签菜单中选择“挂载到日历”</div>
          </div>
        </div>
      ) : (
        <div className="dock-board relative flex h-full w-full items-center justify-center overflow-hidden">
          <div
            className="dock-carousel-stage relative h-full"
            style={{ width: boardWidth }}
          >
            {visibleLeftPeek && (
              <div
                className="dock-peek dock-peek-left absolute top-1/2 h-[calc(100%_-_28px)]"
                style={{ width: cardWidth }}
                role="button"
                tabIndex={0}
                aria-label={`上一张便签：${visibleLeftPeek.title}`}
                onClick={() => step(-1)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    step(-1)
                  }
                }}
              >
                <DockedNoteCard note={visibleLeftPeek} isActive={false} attention={attentionNoteId === visibleLeftPeek.id} noteSettings={noteSettings} previewOnly />
              </div>
            )}
            {visibleRightPeek && (
              <div
                className="dock-peek dock-peek-right absolute top-1/2 h-[calc(100%_-_28px)]"
                style={{ width: cardWidth }}
                role="button"
                tabIndex={0}
                aria-label={`下一张便签：${visibleRightPeek.title}`}
                onClick={() => step(1)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    step(1)
                  }
                }}
              >
                <DockedNoteCard note={visibleRightPeek} isActive={false} attention={attentionNoteId === visibleRightPeek.id} noteSettings={noteSettings} previewOnly />
              </div>
            )}
            <div
              className="dock-main-strip relative z-[3] flex h-full items-stretch"
              style={{ width: boardWidth, gap: cardGap }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {mountedNotes.map((note) => {
                  const retained = !visibleNotes.some((visibleNote) => visibleNote.id === note.id)
                  return (
                  <motion.div
                    key={note.id}
                    layout="position"
                    initial={retained || reduceMotion ? false : { opacity: 0, x: slideDirection > 0 ? cardWidth * 0.42 : -cardWidth * 0.42, rotateY: slideDirection > 0 ? 14 : -14, z: -70, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, rotateY: 0, z: 0, scale: 1 }}
                    exit={{ opacity: 0, x: slideDirection > 0 ? -cardWidth * 0.42 : cardWidth * 0.42, rotateY: slideDirection > 0 ? -14 : 14, z: -70, scale: 0.95 }}
                    transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className={`dock-board-item h-full shrink-0 ${retained ? 'pointer-events-none invisible absolute' : ''}`}
                    style={{ width: cardWidth, ...(retained ? { left: 0, top: 0 } : {}) }}
                    aria-hidden={retained || undefined}
                  >
                    <DockedNoteCard
                      note={note}
                      isActive
                      attention={attentionNoteId === note.id}
                      noteSettings={noteSettings}
                      onDraftChange={handleDraftChange}
                    />
                  </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* Navigation arrows (only when multiple notes) */}
      {!useBoardLayout && dockedNotes.length > 1 && (
        <>
          <button
            onClick={() => step(-1)}
            className="touch-target carousel-nav absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center z-10 transition-all"
            title="上一张"
            aria-label="上一张挂载便签"
          >
            <ChevronLeft size={15} className="opacity-65" />
          </button>
          <button
            onClick={() => step(1)}
            className="touch-target carousel-nav absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center z-10 transition-all"
            title="下一张"
            aria-label="下一张挂载便签"
          >
            <ChevronRight size={15} className="opacity-65" />
          </button>
        </>
      )}
    </div>
  )
}
