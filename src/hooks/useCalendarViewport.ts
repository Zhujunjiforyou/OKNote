import { useLayoutEffect, useRef, useState } from 'react'
import { format, startOfMonth } from 'date-fns'
import { useCalendarStore } from '@/stores/calendar.store'
import {
  CALENDAR_WEEK_COUNT, calendarWeekDate, calendarWeekIndex, calendarWindow,
  calendarRowHeight, calendarVisibleColumns, snapCalendarTop, visibleCalendarMonth, wheelPixels,
} from '@/lib/calendar-viewport'

export function useCalendarViewport(viewMode: 'month' | 'week', blocked: boolean) {
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const spaceRef = useRef<HTMLDivElement>(null)
  const navigation = useCalendarStore((s) => s.navigation)
  const handledNavigation = useRef<typeof navigation>(null)
  const initialDate = useRef(useCalendarStore.getState().currentDate)
  const initialWeek = calendarWeekIndex(viewMode === 'month' ? startOfMonth(initialDate.current) : initialDate.current)
  const [range, setRange] = useState(() => calendarWindow(initialWeek * 100, viewMode === 'month' ? 600 : 100, 100))
  const layout = useRef({ top: initialWeek * 100, height: viewMode === 'month' ? 600 : 100, rowHeight: 100, mode: viewMode })
  const programmatic = useRef(true)
  const controlledTop = useRef<number | null>(null)
  const controlledLeft = useRef<number | null>(null)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const pendingFocus = useRef<string | null>(null)
  const refreshRef = useRef<(force?: boolean, syncBrowse?: boolean, userInitiated?: boolean) => void>(() => {})
  const updateFocusabilityRef = useRef<() => void>(() => {})
  const stopWheelRef = useRef<() => void>(() => {})
  const resumeSnapRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const viewport = viewportRef.current!
    const root = rootRef.current!
    const space = spaceRef.current!
    const horizontal = root.closest<HTMLElement>('.calendar-grid-scroll')
    let frame = 0
    let wheelFrame = 0
    let wheelTarget = viewport.scrollTop
    let wheelPosition = wheelTarget
    let wheelTime = 0
    let lastWheelInput = -Infinity
    let smoothGesture = false
    let snappedForInput = true
    let snapTimer = 0
    let dragging = false
    let measured = false
    let measuredWidth = 0
    let measuredGridWidth = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const stopWheel = () => {
      window.clearTimeout(snapTimer)
      snapTimer = 0
      cancelAnimationFrame(wheelFrame)
      wheelFrame = 0
      wheelTarget = viewport.scrollTop
      wheelPosition = wheelTarget
    }
    stopWheelRef.current = stopWheel
    const animateWheel = (time: number) => {
      if (blockedRef.current || document.hidden || reducedMotion.matches) { stopWheel(); return }
      const elapsed = Math.max(0, Math.min(64, time - wheelTime))
      wheelTime = time
      if (!snappedForInput && time - lastWheelInput > 110) {
        wheelTarget = snapCalendarTop(wheelTarget, layout.current.rowHeight, viewport.clientHeight)
        snappedForInput = true
      }
      const remaining = wheelTarget - wheelPosition
      if (Math.abs(remaining) < 0.5) {
        viewport.scrollTop = wheelTarget
        wheelFrame = 0
        return
      }
      // Follow the accumulated destination, rather than restarting a CSS smooth
      // scroll for every notch. This also responds immediately to reversal.
      // Keep subpixel progress internally; reading rounded scrollTop each frame
      // can strand an animation a few pixels short on high-refresh displays.
      wheelPosition += remaining * (1 - Math.exp(-elapsed / 60))
      viewport.scrollTop = wheelPosition
      wheelFrame = requestAnimationFrame(animateWheel)
    }
    const scheduleSnap = () => {
      window.clearTimeout(snapTimer)
      snapTimer = 0
      if (programmatic.current || blockedRef.current || document.hidden || dragging || wheelFrame) return
      snapTimer = window.setTimeout(() => {
        snapTimer = 0
        if (programmatic.current || blockedRef.current || document.hidden || dragging || wheelFrame) return
        wheelTarget = snapCalendarTop(viewport.scrollTop, layout.current.rowHeight, viewport.clientHeight)
        wheelPosition = viewport.scrollTop
        if (Math.abs(wheelTarget - wheelPosition) < 0.7) return
        snappedForInput = true
        if (reducedMotion.matches) viewport.scrollTop = wheelTarget
        else {
          wheelTime = performance.now()
          wheelFrame = requestAnimationFrame(animateWheel)
        }
      }, 130)
    }
    resumeSnapRef.current = scheduleSnap
    const columnWidths = () => {
      const grid = viewport.getBoundingClientRect()
      const clip = horizontal?.getBoundingClientRect() || grid
      return calendarVisibleColumns(grid.left + viewport.clientLeft, viewport.clientWidth,
        clip.left + (horizontal?.clientLeft || viewport.clientLeft), horizontal?.clientWidth || viewport.clientWidth)
    }
    const updateFocusability = () => {
      const widths = columnWidths()
      const { rowHeight } = layout.current
      for (const row of root.querySelectorAll<HTMLElement>('[data-week-index]')) {
        const top = Number(row.dataset.weekIndex) * rowHeight
        const visible = top + rowHeight > viewport.scrollTop + 0.5 && top < viewport.scrollTop + viewport.clientHeight - 0.5
        Array.from(row.children).forEach((element, column) => {
          const cell = element as HTMLElement
          const inert = !visible || widths[column] < 0.5
          if (inert && cell.contains(document.activeElement)) root.focus({ preventScroll: true })
          if (cell.inert !== inert) cell.inert = inert
        })
      }
    }
    updateFocusabilityRef.current = updateFocusability
    const refresh = (force = false, syncBrowse = true, userInitiated = false) => {
      const { rowHeight } = layout.current
      if (blockedRef.current && !force) {
        viewport.scrollTop = layout.current.top
        return
      }
      layout.current.top = viewport.scrollTop
      const next = calendarWindow(viewport.scrollTop, viewport.clientHeight, rowHeight)
      const focused = document.activeElement?.closest<HTMLElement>('[data-date]')
      if (focused && root.contains(focused)) {
        const week = calendarWeekIndex(new Date(`${focused.dataset.date}T00:00:00`))
        if (week < next.first || week >= next.end) root.focus({ preventScroll: true })
      }
      setRange(old => old.first === next.first && old.end === next.end ? old : next)
      updateFocusability()
      if (syncBrowse && !programmatic.current && !blockedRef.current) {
        const state = useCalendarStore.getState()
        const date = viewMode === 'week'
          ? calendarWeekDate(Math.min(CALENDAR_WEEK_COUNT - 1, Math.floor((viewport.scrollTop + viewport.clientHeight / 2) / rowHeight)))
          : visibleCalendarMonth(viewport.scrollTop, viewport.clientHeight, rowHeight, state.browseDate, columnWidths())
        state.setBrowseDate(date, userInitiated)
      }
    }
    refreshRef.current = refresh
    const measure = () => {
      const height = viewport.clientHeight
      if (!height) return
      const old = layout.current
      const fontSize = Number.parseFloat(getComputedStyle(root).fontSize) || 14
      const rowHeight = calendarRowHeight(height, fontSize, viewMode)
      const width = horizontal?.clientWidth || viewport.clientWidth
      const geometryChanged = !measured || rowHeight !== old.rowHeight || height !== old.height || old.mode !== viewMode
      const widthChanged = width !== measuredWidth || viewport.clientWidth !== measuredGridWidth
      measured = true
      measuredWidth = width
      measuredGridWidth = viewport.clientWidth
      if (!geometryChanged) {
        if (widthChanged) refresh(true, true, false)
        else updateFocusability()
        return
      }
      const wasSettling = !!(wheelFrame || snapTimer)
      stopWheel()
      const selectedWeek = calendarWeekIndex(useCalendarStore.getState().currentDate)
      const selectedWasVisible = selectedWeek * old.rowHeight >= old.top - 1
        && selectedWeek * old.rowHeight < old.top + old.height
      let anchor = old.top / old.rowHeight
      if (old.mode !== viewMode) anchor = selectedWasVisible ? selectedWeek : Math.floor((old.top + old.height / 2) / old.rowHeight)
      let top = anchor * rowHeight
      if (selectedWasVisible && selectedWeek * rowHeight >= top + height) top = selectedWeek * rowHeight
      layout.current = { top, height, rowHeight, mode: viewMode }
      root.style.setProperty('--calendar-week-height', `${rowHeight}px`)
      space.style.height = `${CALENDAR_WEEK_COUNT * rowHeight}px`
      viewport.scrollTo({ top: viewport.scrollTop, behavior: 'instant' })
      viewport.scrollTop = top
      controlledTop.current = viewport.scrollTop
      programmatic.current = false
      if (selectedWasVisible) {
        const cell = root.querySelector<HTMLElement>(`[data-date="${format(useCalendarStore.getState().currentDate, 'yyyy-MM-dd')}"]`)
        if (cell && horizontal) {
          const box = cell.getBoundingClientRect()
          const bounds = horizontal.getBoundingClientRect()
          if (box.left < bounds.left) horizontal.scrollLeft -= bounds.left - box.left
          else if (box.right > bounds.right) horizontal.scrollLeft += box.right - bounds.right
          controlledLeft.current = horizontal.scrollLeft
        }
      }
      refresh(true, true, false)
      if (wasSettling) scheduleSnap()
    }
    const scroll = () => {
      const controlled = programmatic.current || (controlledTop.current !== null && Math.abs(viewport.scrollTop - controlledTop.current) < 1)
      if (!controlled) controlledTop.current = null
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // A navigation or resize may have superseded this scroll in the same frame.
        const nowControlled = programmatic.current || (controlledTop.current !== null && Math.abs(viewport.scrollTop - controlledTop.current) < 1)
        refresh(false, !nowControlled, !nowControlled)
      })
      if (!controlled) scheduleSnap()
    }
    const horizontalScroll = () => {
      const controlled = controlledLeft.current !== null && Math.abs((horizontal?.scrollLeft || 0) - controlledLeft.current) < 1
      if (!controlled) controlledLeft.current = null
      refresh(false, !controlled, !controlled)
    }
    const scrollEnd = () => {
      if (!programmatic.current) return
      programmatic.current = false
      controlledTop.current = viewport.scrollTop
      refresh(true, false)
    }
    const cancelNavigation = () => {
      stopWheel()
      if (programmatic.current) viewport.scrollTo({ top: viewport.scrollTop, behavior: 'instant' })
      programmatic.current = false
      controlledTop.current = viewport.scrollTop
      controlledLeft.current = horizontal?.scrollLeft ?? null
    }
    const keyDown = (event: KeyboardEvent) => {
      // Cancel an unfinished navigation before native Tab can reveal its target.
      if (event.key === 'Tab' && programmatic.current) cancelNavigation()
    }
    const startDrag = () => { dragging = true; cancelNavigation() }
    const endDrag = () => { dragging = false; scheduleSnap() }
    const visibilityChange = () => {
      if (document.hidden) stopWheel()
      else scheduleSnap()
    }
    const nestedWheel = (event: WheelEvent) => {
      const list = event.target instanceof Element ? event.target.closest<HTMLElement>('.day-event-list') : null
      if (list && list.scrollHeight > list.clientHeight + 1) { stopWheel(); scheduleSnap() }
    }
    const wheel = (event: WheelEvent) => {
      if (blockedRef.current) { event.preventDefault(); return }
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return
      const target = event.target instanceof Element ? event.target : null
      const list = target?.closest<HTMLElement>('.day-event-list')
      if (list && list.scrollHeight > list.clientHeight + 1) return
      if (programmatic.current) viewport.scrollTo({ top: viewport.scrollTop, behavior: 'instant' })
      programmatic.current = false
      controlledTop.current = null
      const now = performance.now()
      const delta = wheelPixels(event, Number.parseFloat(getComputedStyle(root).fontSize) * 1.4, viewport.clientHeight)
      // Keep a fine-grained gesture native, including its larger momentum tail.
      // Coarse mouse notches move continuously, then settle on a week boundary.
      if (now - lastWheelInput > 160) smoothGesture = event.deltaMode !== 0 || Math.abs(event.deltaY) >= 40
      lastWheelInput = now
      if (smoothGesture && !reducedMotion.matches) {
        event.preventDefault()
        snappedForInput = false
        if (!wheelFrame || Math.sign(delta) !== Math.sign(wheelTarget - viewport.scrollTop)) {
          wheelTarget = viewport.scrollTop
          wheelPosition = wheelTarget
        }
        wheelTarget = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, wheelTarget + delta))
        if (!wheelFrame) {
          wheelTime = now
          wheelFrame = requestAnimationFrame(animateWheel)
        }
      } else {
        stopWheel()
        if (!target?.closest('.month-grid-body') || list) {
          event.preventDefault()
          viewport.scrollTop += delta
        }
        scheduleSnap()
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(root)
    viewport.addEventListener('scroll', scroll, { passive: true })
    viewport.addEventListener('scrollend', scrollEnd)
    horizontal?.addEventListener('scroll', horizontalScroll, { passive: true })
    root.addEventListener('keydown', keyDown, true)
    document.addEventListener('visibilitychange', visibilityChange)
    viewport.addEventListener('pointerdown', startDrag)
    viewport.addEventListener('touchstart', startDrag, { passive: true })
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('touchend', endDrag)
    window.addEventListener('touchcancel', endDrag)
    root.addEventListener('wheel', wheel, { passive: false })
    root.addEventListener('wheel', nestedWheel, { capture: true, passive: true })
    return () => {
      cancelAnimationFrame(frame)
      stopWheel()
      observer.disconnect()
      viewport.removeEventListener('scroll', scroll)
      viewport.removeEventListener('scrollend', scrollEnd)
      horizontal?.removeEventListener('scroll', horizontalScroll)
      root.removeEventListener('keydown', keyDown, true)
      document.removeEventListener('visibilitychange', visibilityChange)
      viewport.removeEventListener('pointerdown', startDrag)
      viewport.removeEventListener('touchstart', startDrag)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('touchend', endDrag)
      window.removeEventListener('touchcancel', endDrag)
      root.removeEventListener('wheel', wheel)
      root.removeEventListener('wheel', nestedWheel, true)
    }
  }, [viewMode])

  useLayoutEffect(() => {
    const viewport = viewportRef.current!
    if (blocked) {
      stopWheelRef.current()
      layout.current.top = viewport.scrollTop
      viewport.scrollTo({ top: viewport.scrollTop, behavior: 'instant' })
      programmatic.current = false
      controlledTop.current = viewport.scrollTop
    } else resumeSnapRef.current()
  }, [blocked])

  useLayoutEffect(() => {
    // A responsive month/week change preserves the viewport; only a new
    // explicit command may replay a date-location request.
    if (!navigation || navigation === handledNavigation.current) return
    handledNavigation.current = navigation
    stopWheelRef.current()
    const viewport = viewportRef.current!
    const { rowHeight } = layout.current
    const date = navigation.align === 'period' && viewMode === 'month' ? startOfMonth(navigation.date) : navigation.date
    const rowTop = calendarWeekIndex(date) * rowHeight
    let top = rowTop
    if (navigation.align === 'nearest') {
      // Reveal the date header, even when a large-font row is taller than the viewport.
      const headerHeight = Math.min(rowHeight, Number.parseFloat(getComputedStyle(viewport).fontSize) * 2.5)
      top = rowTop < viewport.scrollTop ? rowTop
        : rowTop + headerHeight > viewport.scrollTop + viewport.clientHeight ? rowTop + headerHeight - viewport.clientHeight : viewport.scrollTop
    }
    programmatic.current = true
    pendingFocus.current = navigation.focus ? format(navigation.date, 'yyyy-MM-dd') : null
    const smooth = !blockedRef.current && !navigation.focus && Math.abs(top - viewport.scrollTop) < viewport.clientHeight * 2
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewport.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' })
    controlledTop.current = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, top))
    refreshRef.current(true, false)
    if (!smooth || Math.abs(top - viewport.scrollTop) < 1) programmatic.current = false
  }, [navigation, viewMode])

  useLayoutEffect(() => {
    updateFocusabilityRef.current()
    const key = pendingFocus.current
    if (!key) return
    const cell = rootRef.current?.querySelector<HTMLElement>(`[data-date="${key}"]`)
    if (!cell) return
    pendingFocus.current = null
    const horizontal = rootRef.current?.closest<HTMLElement>('.calendar-grid-scroll')
    if (horizontal) {
      const box = cell.getBoundingClientRect()
      const bounds = horizontal.getBoundingClientRect()
      if (box.left < bounds.left) horizontal.scrollLeft -= bounds.left - box.left
      else if (box.right > bounds.right) horizontal.scrollLeft += box.right - bounds.right
      controlledLeft.current = horizontal.scrollLeft
    }
    updateFocusabilityRef.current()
    cell.focus({ preventScroll: true })
  }, [range, navigation])

  return { rootRef, viewportRef, spaceRef, range }
}
