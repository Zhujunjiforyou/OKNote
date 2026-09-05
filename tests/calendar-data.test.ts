import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { CalendarEvent } from '../src/types/calendar.types'
import type { Note } from '../src/types/notes.types'
import {
  addDaysToDateKey,
  buildDailyTodoItemsByDate,
  buildEventsByDate,
  compareCalendarEventStart,
  expandEventsInRange,
  getEventInstanceRange,
  getNearestRecurringOccurrence,
  getTagViewEventInstances,
  hexToLuminance,
  isImeComposing,
  isDateKey,
  normalizeCalendarEvents,
  normalizeNote,
} from '../src/lib/utils'
import { getAdjustedWorkday, getHoliday } from '../src/lib/holidays'

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: overrides.id || randomUUID(),
    title: overrides.title || '测试事件',
    description: '',
    startDate: '2026-08-17',
    isAllDay: false,
    color: '#2563EB',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('calendar recurrence and ordering', () => {
  it('expands weekly recurrences on the configured weekdays', () => {
    const source = event({ recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3] } })
    const occurrences = expandEventsInRange([source], '2026-08-17', '2026-08-23')
    expect(occurrences.map((item) => item.startDate)).toEqual(['2026-08-17', '2026-08-19'])
  })

  it('finds yearly events well beyond the old 180-day display window', () => {
    const source = event({ startDate: '2020-12-31', recurrence: { freq: 'yearly', interval: 1 } })
    const occurrences = expandEventsInRange([source], '2027-01-01', '2027-12-31')
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].startDate).toBe('2027-12-31')
  })

  it('finds one nearest recurrence directly without expanding years of daily candidates', () => {
    const source = event({
      startDate: '2020-01-31',
      recurrence: { freq: 'monthly', interval: 24, byMonthDay: [31] },
    })
    expect(getNearestRecurringOccurrence(source, '2026-08-24')?.startDate).toBe('2028-01-31')
  })

  it('returns the last occurrence when a recurring series has ended', () => {
    const source = event({
      startDate: '2020-12-31',
      recurrence: { freq: 'yearly', interval: 2, until: '2024-12-31' },
    })
    expect(getNearestRecurringOccurrence(source, '2026-08-24')?.startDate).toBe('2024-12-31')
  })

  it('returns the last daily occurrence after its until date', () => {
    const source = event({
      startDate: '2026-08-01',
      recurrence: { freq: 'daily', interval: 1, until: '2026-08-10' },
    })
    expect(getNearestRecurringOccurrence(source, '2026-08-25')?.startDate).toBe('2026-08-10')

    const sparseSource = event({
      startDate: '2026-08-01',
      recurrence: { freq: 'daily', interval: 3, until: '2026-08-09' },
    })
    expect(getNearestRecurringOccurrence(sparseSource, '2026-08-25')?.startDate).toBe('2026-08-07')
  })

  it('keeps the clicked recurrence date while preserving the series duration', () => {
    const source = event({
      startDate: '2026-08-25',
      endDate: '2026-08-26',
      recurrence: { freq: 'daily', interval: 1 },
    })
    expect(getEventInstanceRange(source, '2026-08-28')).toEqual({
      startDate: '2026-08-28',
      endDate: '2026-08-29',
    })
  })

  it('keeps historical one-time events in tag views without an arbitrary age cutoff', () => {
    const historical = event({ id: 'historical', startDate: '2020-01-01' })
    const recurring = event({ id: 'recurring', recurrence: { freq: 'daily', interval: 1 } })
    const visible = getTagViewEventInstances([historical, recurring], '2026-08-25')
    expect(visible.map((item) => item.id)).toEqual(['historical', 'recurring'])
    expect(visible[1].startDate).toBe('2026-08-25')
  })

  it('orders all-day items before timed items and timed items chronologically', () => {
    const allDay = event({ id: 'all-day', title: '全天', isAllDay: true })
    const morning = event({ id: 'morning', title: '早上', startTime: '09:00' })
    const evening = event({ id: 'evening', title: '晚上', startTime: '18:00' })
    expect([evening, morning, allDay].sort(compareCalendarEventStart).map((item) => item.id))
      .toEqual(['all-day', 'morning', 'evening'])
  })

  it('shows only the latest copy of a duplicate event id without rewriting disk data', () => {
    const older = event({ id: 'same', title: '旧标题', updatedAt: '2026-08-01T00:00:00.000Z' })
    const newer = event({ id: 'same', title: '新标题', updatedAt: '2026-08-02T00:00:00.000Z' })
    expect(normalizeCalendarEvents([older, newer])).toMatchObject([{ id: 'same', title: '新标题' }])
  })
})

describe('date and holiday integrity', () => {
  it('keeps date-key arithmetic stable across month boundaries', () => {
    expect(addDaysToDateKey('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysToDateKey('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('uses the published 2026 holiday boundaries and make-up workdays', () => {
    expect(getHoliday('2026-02-15')).toBe('春节')
    expect(getHoliday('2026-02-23')).toBe('春节')
    expect(getHoliday('2026-02-24')).toBeNull()
    expect(getHoliday('2026-04-04')).toBe('清明节')
    expect(getHoliday('2026-04-06')).toBe('清明节')
    expect(getHoliday('2026-04-07')).toBeNull()
    expect(getAdjustedWorkday('2026-02-14')).toBe('调休上班')
  })

  it('does not invent an unpublished multi-day Labor Day break', () => {
    expect(getHoliday('2027-05-01')).toBe('劳动节')
    expect(getHoliday('2027-05-02')).toBeNull()
  })

  it('shows the Qingming festival day outside published schedule years', () => {
    expect(getHoliday('2023-04-05')).toBe('清明节')
    expect(getHoliday('2027-04-05')).toBe('清明节')
    expect(getHoliday('2027-04-06')).toBeNull()
  })

  it('uses one supported date range across normalization and arithmetic', () => {
    expect(isDateKey('1900-01-01')).toBe(true)
    expect(isDateKey('2100-12-31')).toBe(true)
    expect(isDateKey('1899-12-31')).toBe(false)
    expect(isDateKey('2101-01-01')).toBe(false)
    expect(addDaysToDateKey('1900-01-01', 1)).toBe('1900-01-02')
  })

  it('keeps 2100 year-end events when the visible grid spills into 2101', () => {
    const yearEnd = event({ id: 'year_end', startDate: '2100-12-31', isAllDay: true })
    const recurring = event({ id: 'year_end_recurring', startDate: '2099-12-31', isAllDay: true, recurrence: { freq: 'yearly', interval: 1 } })
    const byDate = buildEventsByDate([yearEnd, recurring], '2100-12-27', '2101-01-02')

    expect(byDate.get('2100-12-31')?.map((item) => item.id).sort())
      .toEqual(['year_end', 'year_end_recurring'])
  })
})

describe('normalization and contrast helpers', () => {
  it('recognizes browser and React IME composition signals', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true)
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true)
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
    expect(isImeComposing({ nativeEvent: { keyCode: 229 } })).toBe(true)
    expect(isImeComposing({ keyCode: 13 })).toBe(false)
  })

  it('uses the same safe identifier rule as the Electron mutation boundary', () => {
    expect(normalizeCalendarEvents([
      event({ id: 'safe_event-1' }),
      event({ id: 'bad event' }),
      event({ id: 'bad|event' }),
    ]).map((item) => item.id)).toEqual(['safe_event-1'])
  })

  it('uses WCAG relative luminance endpoints', () => {
    expect(hexToLuminance('#000000')).toBe(0)
    expect(hexToLuminance('#ffffff')).toBe(1)
  })

  it('drops obsolete per-note appearance and unused state fields in memory', () => {
    const note = normalizeNote({
      id: 'note_1',
      title: '便签',
      items: [],
      noteType: 'independent',
      color: '#2563EB',
      transparency: 0.4,
      fontFamily: 'Old Font',
      fontSize: 9,
      isPinned: true,
      isArchived: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }) as unknown as Record<string, unknown>
    expect(note).not.toHaveProperty('transparency')
    expect(note).not.toHaveProperty('fontFamily')
    expect(note).not.toHaveProperty('fontSize')
    expect(note).not.toHaveProperty('isPinned')
    expect(note).not.toHaveProperty('isArchived')
  })

  it('gives duplicate todo item ids unique stable operation keys', () => {
    const note = normalizeNote({
      id: 'note_duplicates',
      title: '重复 ID',
      items: [
        { id: 'same', content: '第一项' },
        { id: 'same', content: '第二项' },
      ],
    })
    expect(note.items).toHaveLength(2)
    expect(new Set(note.items.map((item) => item.id)).size).toBe(2)
    expect(note.items.every((item) => item.noteId === note.id)).toBe(true)
  })
})

describe('daily todo calendar projection', () => {
  it('projects only incomplete daily-note items into their calendar dates', () => {
    const note: Note = {
      id: 'daily_note',
      title: '每日待办',
      color: '#14B8A6',
      noteType: 'daily',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      items: [
        { id: 'second', noteId: 'daily_note', content: '检查循环事件是否显示在今日事件区', isCompleted: false, sortOrder: 2, todoDate: '2026-08-22' },
        { id: 'first', noteId: 'daily_note', content: '先显示这一项', isCompleted: false, sortOrder: 1, todoDate: '2026-08-22' },
        { id: 'done', noteId: 'daily_note', content: '已完成事项', isCompleted: true, sortOrder: 0, todoDate: '2026-08-22' },
        { id: 'outside', noteId: 'daily_note', content: '范围外事项', isCompleted: false, sortOrder: 0, todoDate: '2026-09-01' },
      ],
    }

    const byDate = buildDailyTodoItemsByDate([note], '2026-08-01', '2026-08-31')

    expect(byDate.get('2026-08-22')?.map((item) => item.content)).toEqual([
      '先显示这一项',
      '检查循环事件是否显示在今日事件区',
    ])
    expect(byDate.has('2026-09-01')).toBe(false)
  })
})
