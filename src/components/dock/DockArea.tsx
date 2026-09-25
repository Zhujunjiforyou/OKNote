import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ViewNotePanel } from './ViewNotePanel'
import { DockedNotesCarousel } from './DockedNotesCarousel'
import type { DockedNoteDraftKind } from './DockedNoteCard'

interface DockAreaProps {
  height: number
  onDraftChange?: (key: string, kind: DockedNoteDraftKind, dirty: boolean) => void
}

const WIDTH_KEY = 'oknote.calendarSummaryWidth'
const DIVIDER_WIDTH = 8
function widthLimits(total: number) {
  const available = Math.max(0, total - DIVIDER_WIDTH)
  const min = Math.min(150, available * 0.4)
  return { min, max: Math.max(min, available - 248) }
}
function savedWidth() {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

export function DockArea({ height, onDraftChange }: DockAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: number; x: number; start: number; next: number | null } | null>(null)
  const frameRef = useRef<number | null>(null)
  const [preferredWidth, setPreferredWidth] = useState(savedWidth)
  const [size, setSize] = useState({ total: 0, summary: 0 })
  const limits = widthLimits(size.total)
  const currentWidth = () => (areaRef.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
  const clamp = (value: number, total = areaRef.current?.clientWidth || 0) => {
    const { min, max } = widthLimits(total)
    return Math.round(Math.min(max, Math.max(min, value)))
  }
  const save = (value: number) => {
    setPreferredWidth(value)
    try { window.localStorage.setItem(WIDTH_KEY, String(value)) } catch { /* Width still works for this session. */ }
  }

  useLayoutEffect(() => {
    const area = areaRef.current!
    const summary = area.firstElementChild as HTMLElement
    const measure = () => setSize(current => current.total === area.clientWidth && current.summary === summary.offsetWidth
      ? current : { total: area.clientWidth, summary: summary.offsetWidth })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    observer.observe(summary)
    return () => {
      observer.disconnect()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      document.body.classList.remove('resizing-dock-width')
    }
  }, [])

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return
    event.preventDefault()
    dragRef.current = { id: event.pointerId, x: event.clientX, start: currentWidth(), next: null }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('resizing-dock-width')
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId || event.clientX === drag.x && drag.next === null) return
    drag.next = clamp(drag.start + event.clientX - drag.x)
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const next = dragRef.current?.next
      if (next != null) setPreferredWidth(next)
    })
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    // Resizing the window or clicking the divider alone must not overwrite the saved preference.
    if (drag.next !== null) save(drag.next)
    document.body.classList.remove('resizing-dock-width')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resizeByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    // ResizeObserver state may still describe the previous viewport for one frame.
    const bounds = widthLimits(areaRef.current?.clientWidth || 0)
    save(clamp(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : currentWidth() + (event.key === 'ArrowRight' ? 16 : -16)))
  }

  return (
    <div
      ref={areaRef}
      data-dock-area
      className={`relative z-[40] shrink-0 border-t flex flex-row overflow-hidden ${preferredWidth === null ? '' : 'dock-width-custom'}`}
      style={{
        borderColor: 'var(--border, rgba(255,255,255,0.08))',
        height,
        backgroundColor: 'transparent',
        ['--dock-summary-width' as string]: preferredWidth === null ? undefined : `${clamp(preferredWidth, size.total)}px`,
      }}
    >
      <ViewNotePanel />
      <div
        className="dock-width-divider shrink-0"
        role="separator" aria-orientation="vertical" aria-label="调整事项回显与挂载区宽度"
        aria-controls="dock-summary-panel" aria-valuemin={Math.round(limits.min)} aria-valuemax={Math.round(limits.max)}
        aria-valuenow={size.summary} aria-valuetext={`事项回显宽度 ${size.summary} 像素`}
        tabIndex={0} title="左右拖动调整宽度"
        onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onKeyDown={resizeByKeyboard}
      />
      <DockedNotesCarousel onDraftChange={onDraftChange} />
    </div>
  )
}
