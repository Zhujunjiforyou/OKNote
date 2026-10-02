import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, format } from 'date-fns'
import {
  CALENDAR_START, CALENDAR_END, CALENDAR_WEEK_COUNT, calendarKeyboardDate,
  calendarWeekDate, calendarWeekIndex, calendarWindow, visibleCalendarMonth, wheelPixels,
  calendarRowHeight, snapCalendarTop, calendarVisibleColumns,
} from '../src/lib/calendar-viewport'
import { useCalendarStore } from '../src/stores/calendar.store'

describe('continuous calendar geometry', () => {
  it('fits complete week rows and settles at a week boundary in either direction', () => {
    for (const [height, font] of [[566, 14], [350, 14], [460, 28], [200, 40.4]]) {
      const row = calendarRowHeight(height, font, 'month')
      expect(height / row).toBeCloseTo(Math.round(height / row))
      expect(snapCalendarTop(100.3 * row, row, height)).toBeCloseTo(100 * row)
      expect(snapCalendarTop(100.7 * row, row, height)).toBeCloseTo(101 * row)
    }
    expect(calendarRowHeight(200, 14, 'week')).toBe(200)
    expect(snapCalendarTop(-50, 100, 600)).toBe(0)
    expect(snapCalendarTop(Infinity, 100, 600)).toBe(CALENDAR_WEEK_COUNT * 100 - 600)
  })
  it('has consecutive, unique dates through short months, leap days, years and DST weeks', () => {
    for (const start of [new Date(2024, 1, 25), new Date(2026, 1, 23), new Date(2026, 2, 7), new Date(2026, 11, 27)]) {
      const first = calendarWeekDate(calendarWeekIndex(start))
      const dates = Array.from({ length: 42 }, (_, i) => addDays(first, i))
      expect(new Set(dates.map(date => format(date, 'yyyy-MM-dd'))).size).toBe(42)
      dates.forEach((date, i) => {
        expect(date.getHours()).toBe(0)
        expect(calendarWeekIndex(date)).toBe(calendarWeekIndex(first) + Math.floor(i / 7))
      })
    }
  })

  it('clamps the supported range and keeps the final partial week', () => {
    expect(calendarWeekDate(0)).toEqual(CALENDAR_START)
    expect(calendarWeekIndex(new Date(1899, 11, 31))).toBe(0)
    expect(calendarWeekIndex(CALENDAR_END)).toBe(CALENDAR_WEEK_COUNT - 1)
    expect(calendarWeekIndex(new Date(2101, 0, 1))).toBe(CALENDAR_WEEK_COUNT - 1)
    const last = calendarWeekDate(CALENDAR_WEEK_COUNT - 1)
    expect(last <= CALENDAR_END && addDays(last, 6) >= CALENDAR_END).toBe(true)
  })

  it('renders a bounded buffer after months or decades of scrolling', () => {
    for (const week of [0, 10, 6000, CALENDAR_WEEK_COUNT - 6]) {
      const window = calendarWindow(week * 100 + 25, 600, 100)
      expect(window.first).toBeGreaterThanOrEqual(0)
      expect(window.end).toBeLessThanOrEqual(CALENDAR_WEEK_COUNT)
      expect(window.end - window.first).toBeLessThanOrEqual(11)
      expect(window.first).toBeLessThanOrEqual(week)
    }
  })

  it('counts partial rows and retains the previous month inside the hysteresis band', () => {
    const september = new Date(2026, 8, 1)
    const october = new Date(2026, 9, 1)
    const top = calendarWeekIndex(new Date(2026, 8, 7)) * 100
    expect(visibleCalendarMonth(top, 600, 100, october)).toEqual(september)
    expect(visibleCalendarMonth(top + 50, 600, 100, september)).toEqual(september)
    expect(visibleCalendarMonth(top + 50, 600, 100, october)).toEqual(october)
    expect(visibleCalendarMonth(top + 100, 600, 100, september)).toEqual(october)
  })

  it('measures horizontal intersections for complete, clipped and hidden date columns', () => {
    expect(calendarVisibleColumns(20, 700, 20, 700)).toEqual([100, 100, 100, 100, 100, 100, 100])
    expect(calendarVisibleColumns(20, 700, 20, 300)).toEqual([100, 100, 100, 0, 0, 0, 0])
    expect(calendarVisibleColumns(20, 700, 320, 400)).toEqual([0, 0, 0, 100, 100, 100, 100])
    expect(calendarVisibleColumns(20, 700, 80, 400)).toEqual([40, 100, 100, 100, 60, 0, 0])
    expect(calendarVisibleColumns(20, 700, 720, 400)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(calendarVisibleColumns(20, 700, -380, 400)).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('uses the visible date columns when a week crosses from September into October', () => {
    const september = new Date(2026, 8, 1)
    const october = new Date(2026, 9, 1)
    const top = calendarWeekIndex(new Date(2026, 8, 28)) * 100
    const full = calendarVisibleColumns(20, 700, 20, 700)
    const left = calendarVisibleColumns(20, 700, 20, 300)
    const right = calendarVisibleColumns(20, 700, 320, 400)
    const partial = calendarVisibleColumns(20, 700, 80, 400)
    const hidden = calendarVisibleColumns(20, 700, 720, 400)

    expect(visibleCalendarMonth(top, 100, 100, september)).toEqual(october)
    expect(visibleCalendarMonth(top, 100, 100, september, full)).toEqual(october)
    expect(visibleCalendarMonth(top, 100, 100, october, left)).toEqual(september)
    expect(visibleCalendarMonth(top, 100, 100, september, right)).toEqual(october)
    // The two clipped columns leave 240px of September and 160px of October.
    expect(visibleCalendarMonth(top, 100, 100, october, partial)).toEqual(september)
    expect(visibleCalendarMonth(top, 100, 100, september, hidden)).toEqual(september)
    expect(visibleCalendarMonth(top, 100, 100, october, hidden)).toEqual(october)
    expect(visibleCalendarMonth(top, 100, 100, september, calendarVisibleColumns(0, 700, 30, 600))).toEqual(september)
    expect(visibleCalendarMonth(top, 100, 100, september, calendarVisibleColumns(0, 700, 31, 600))).toEqual(october)
  })

  it('combines horizontal clipping with partial row heights and the month hysteresis', () => {
    const september = new Date(2026, 8, 1)
    const october = new Date(2026, 9, 1)
    const top = calendarWeekIndex(new Date(2026, 8, 28)) * 100
    const left = calendarVisibleColumns(0, 700, 0, 300)

    // The last 25px of the September row and first 25px of October are equal.
    expect(visibleCalendarMonth(top + 75, 50, 100, september, left)).toEqual(september)
    expect(visibleCalendarMonth(top + 75, 50, 100, october, left)).toEqual(october)
    expect(visibleCalendarMonth(top + 75, 75, 100, september, left)).toEqual(october)
    expect(visibleCalendarMonth(top + 25, 100, 100, october, left)).toEqual(september)
  })

  it('moves keyboard focus by date even across a virtual window or a year boundary', () => {
    expect(calendarKeyboardDate(new Date(2026, 11, 31), 'ArrowRight')).toEqual(new Date(2027, 0, 1))
    expect(calendarKeyboardDate(new Date(2026, 8, 30), 'ArrowDown')).toEqual(new Date(2026, 9, 7))
    expect(calendarKeyboardDate(CALENDAR_END, 'End')).toEqual(CALENDAR_END)
    expect(calendarKeyboardDate(CALENDAR_START, 'ArrowLeft')).toEqual(CALENDAR_START)
  })

  it('honors pixel, line and page wheel units', () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 0 }, 20, 600)).toBe(3)
    expect(wheelPixels({ deltaY: -3, deltaMode: 1 }, 20, 600)).toBe(-60)
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 }, 20, 600)).toBe(600)
  })
})

describe('browsing does not change the selected date', () => {
  beforeEach(() => {
    useCalendarStore.getState().navigateToDate(new Date(2026, 8, 25))
  })

  it('leaves the selected date and navigation request untouched when scrolling', () => {
    const request = useCalendarStore.getState().navigation
    useCalendarStore.getState().setBrowseDate(new Date(2026, 9, 1))
    expect(useCalendarStore.getState().currentDate).toEqual(new Date(2026, 8, 25))
    expect(useCalendarStore.getState().navigation).toBe(request)
    expect(useCalendarStore.getState().followToday).toBe(false)
  })

  it('month buttons navigate relative to the browsed month, selecting its first day', () => {
    useCalendarStore.getState().setBrowseDate(new Date(2026, 11, 1))
    useCalendarStore.getState().goNextMonth()
    expect(useCalendarStore.getState().currentDate).toEqual(new Date(2027, 0, 1))
    useCalendarStore.getState().goPrevMonth()
    expect(useCalendarStore.getState().currentDate).toEqual(new Date(2026, 11, 1))
  })

  it('clicking a visible spillover date selects it without relocating the viewport', () => {
    const request = useCalendarStore.getState().navigation
    useCalendarStore.getState().setCurrentDate(new Date(2026, 9, 3))
    expect(useCalendarStore.getState().browseDate).toEqual(new Date(2026, 8, 25))
    expect(useCalendarStore.getState().navigation).toBe(request)
  })

  it('only return-to-today restores automatic midnight following', () => {
    useCalendarStore.getState().goToday()
    expect(useCalendarStore.getState().followToday).toBe(true)
    useCalendarStore.getState().setBrowseDate(new Date(2026, 8, 1))
    expect(useCalendarStore.getState().followToday).toBe(false)
  })
})
