import { addDays, differenceInCalendarDays, format, startOfMonth, startOfWeek } from 'date-fns'

export const CALENDAR_START = new Date(1900, 0, 1)
export const CALENDAR_END = new Date(2100, 11, 31)
export const CALENDAR_WEEK_COUNT = Math.floor(differenceInCalendarDays(CALENDAR_END, CALENDAR_START) / 7) + 1
export const WEEK_BUFFER = 2

export function calendarRowHeight(height: number, fontSize: number, viewMode: 'month' | 'week'): number {
  const minimum = Math.max(72, Math.ceil(fontSize * 3.8))
  const rows = viewMode === 'week' ? 1 : Math.max(1, Math.min(6, Math.floor(height / minimum)))
  return Math.max(minimum, height / rows)
}

export function snapCalendarTop(top: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, Math.min(CALENDAR_WEEK_COUNT * rowHeight - viewportHeight, Math.round(top / rowHeight) * rowHeight))
}

export function calendarWeekIndex(date: Date): number {
  return Math.max(0, Math.min(CALENDAR_WEEK_COUNT - 1,
    Math.floor(differenceInCalendarDays(date, CALENDAR_START) / 7)))
}

export function calendarWeekDate(index: number): Date {
  return addDays(CALENDAR_START, index * 7)
}

export function calendarWindow(scrollTop: number, height: number, rowHeight: number) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - WEEK_BUFFER)
  const end = Math.min(CALENDAR_WEEK_COUNT, Math.ceil((scrollTop + height) / rowHeight) + WEEK_BUFFER)
  return { first, end }
}

// Fractional rows count only by their visible area. A 55% threshold leaves a
// dead band in either direction so trackpad jitter cannot toggle the heading.
export function calendarVisibleColumns(gridLeft: number, gridWidth: number, clipLeft: number, clipWidth: number): number[] {
  const columnWidth = gridWidth / 7
  return Array.from({ length: 7 }, (_, column) => Math.max(0,
    Math.min(gridLeft + (column + 1) * columnWidth, clipLeft + clipWidth) - Math.max(gridLeft + column * columnWidth, clipLeft)))
}

export function visibleCalendarMonth(scrollTop: number, height: number, rowHeight: number, previous: Date, columnWidths?: readonly number[]): Date {
  const areas = new Map<string, { date: Date; area: number }>()
  let total = 0
  for (let week = Math.max(0, Math.floor(scrollTop / rowHeight)); week < Math.min(CALENDAR_WEEK_COUNT, Math.ceil((scrollTop + height) / rowHeight)); week++) {
    const visible = Math.max(0, Math.min((week + 1) * rowHeight, scrollTop + height) - Math.max(week * rowHeight, scrollTop))
    for (let day = 0; day < 7; day++) {
      const date = addDays(calendarWeekDate(week), day)
      if (date > CALENDAR_END) continue
      const key = format(date, 'yyyy-MM')
      const entry = areas.get(key) || { date: startOfMonth(date), area: 0 }
      const area = visible * (columnWidths?.[day] ?? 1)
      entry.area += area
      total += area
      areas.set(key, entry)
    }
  }
  const largest = [...areas.values()].sort((a, b) => b.area - a.area)[0]
  return largest && largest.area > total * 0.55 ? largest.date : startOfMonth(previous)
}

export function calendarKeyboardDate(date: Date, key: string): Date | null {
  const offset = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1
    : key === 'ArrowUp' ? -7 : key === 'ArrowDown' ? 7 : null
  const target = offset !== null ? addDays(date, offset)
    : key === 'Home' ? startOfWeek(date, { weekStartsOn: 1 })
      : key === 'End' ? addDays(startOfWeek(date, { weekStartsOn: 1 }), 6) : null
  if (!target) return null
  return target < CALENDAR_START ? CALENDAR_START : target > CALENDAR_END ? CALENDAR_END : target
}

export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, lineHeight: number, pageHeight: number): number {
  return event.deltaY * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? pageHeight : 1)
}
