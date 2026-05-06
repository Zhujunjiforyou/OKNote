import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useNotesStore } from '@/stores/notes.store'
import { DockedNoteCard } from './DockedNoteCard'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export function DockedNotesCarousel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const notes = useNotesStore((s) => s.notes)
  const dockedNotes = useMemo(
    () => notes.filter((n) => n.isDocked && !n.isHidden && n.noteType !== 'view'),
    [notes]
  )

  const [activeIndex, setActiveIndex] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [slideDirection, setSlideDirection] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const cardWidth = 240
  const cardGap = 16
  const visibleCapacity = Math.max(1, Math.floor((containerWidth - 144) / (cardWidth + cardGap)))
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
  const leftPeekNote = loopEnabled ? dockedNotes[mod(activeIndex - 1)] : null
  const rightPeekNote = loopEnabled ? dockedNotes[mod(activeIndex + visibleCapacity)] : null
  const boardWidth = visibleNotes.length * cardWidth + Math.max(0, visibleNotes.length - 1) * cardGap

  useEffect(() => {
    setActiveIndex((index) => dockedNotes.length > 0 ? mod(index) : 0)
  }, [dockedNotes.length, mod])

  const step = useCallback((delta: number) => {
    setSlideDirection(delta >= 0 ? 1 : -1)
    setActiveIndex((index) => loopEnabled ? mod(index + delta) : Math.min(Math.max(0, index + delta), maxStartIndex))
  }, [loopEnabled, maxStartIndex, mod])

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
        <div className={`dock-board relative flex h-full w-full items-center overflow-hidden px-12 py-3 ${useBoardLayout ? 'justify-center' : 'justify-center'}`}>
          <div
            className="dock-carousel-stage relative h-full"
            style={{ width: boardWidth }}
          >
            {leftPeekNote && (
              <div className="dock-peek dock-peek-left absolute top-1/2 h-[calc(100%_-_28px)] w-[240px]">
                <DockedNoteCard note={leftPeekNote} isActive={false} />
              </div>
            )}
            {rightPeekNote && (
              <div className="dock-peek dock-peek-right absolute top-1/2 h-[calc(100%_-_28px)] w-[240px]">
                <DockedNoteCard note={rightPeekNote} isActive={false} />
              </div>
            )}
            <div
              className="dock-main-strip relative z-[3] flex h-full items-stretch"
              style={{ width: boardWidth, gap: cardGap }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {visibleNotes.map((note) => (
                  <motion.div
                    key={note.id}
                    layout="position"
                    initial={{ opacity: 0, x: slideDirection > 0 ? cardWidth * 0.42 : -cardWidth * 0.42, scale: 0.96 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: slideDirection > 0 ? -cardWidth * 0.42 : cardWidth * 0.42, scale: 0.96 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="dock-board-item h-full w-[240px] shrink-0"
                  >
                    <DockedNoteCard note={note} isActive />
                  </motion.div>
                ))}
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
            className="carousel-nav absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center z-10 transition-all"
            title="上一张"
          >
            <ChevronLeft size={15} className="opacity-65" />
          </button>
          <button
            onClick={() => step(1)}
            className="carousel-nav absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center z-10 transition-all"
            title="下一张"
          >
            <ChevronRight size={15} className="opacity-65" />
          </button>
        </>
      )}
    </div>
  )
}
