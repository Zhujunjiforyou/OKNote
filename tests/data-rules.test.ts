import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { isDateKey, isSafeIdentifier, normalizeCalendarEvent } from '../src/lib/utils'
import type { CalendarEvent } from '../src/types/calendar.types'

const require = createRequire(import.meta.url)
const rules = require('../electron/data-rules.cjs') as {
  isDateKey: (value: unknown) => boolean
  isSafeIdentifier: (value: unknown) => boolean
}
const { sanitizeEventPayload, sanitizeTagPayload } = require('../electron/event-payload.cjs') as {
  sanitizeEventPayload: (value: unknown, existing?: unknown) => CalendarEvent | null
  sanitizeTagPayload: (value: unknown) => { name: string; color: string } | null
}
const { normalizeReminderEvents } = require('../electron/reminder-data.cjs') as {
  normalizeReminderEvents: (value: unknown) => { events: CalendarEvent[] }
}
const base = { id: 'event_qa', title: '事件', startDate: '2026-09-05', isAllDay: true }

describe('shared data rules and mutation boundaries', () => {
  it('agrees with the renderer across every valid and invalid day in the supported years', () => {
    for (let year = 1899; year <= 2101; year++) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= 32; day++) {
          const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          if (rules.isDateKey(key) !== isDateKey(key)) throw new Error(`Date rule drift: ${key}`)
        }
      }
    }
    for (const value of [null, 20260905, '', '2026-9-05', '2026-09-05T00:00:00Z']) {
      expect(rules.isDateKey(value)).toBe(false)
    }
  })

  it('uses the same identifier rules for all processes', () => {
    for (const value of ['', 'good_ID-123', 'with space', 'a|b', '../x', '中文', 'x'.repeat(160), 'x'.repeat(161)]) {
      expect(rules.isSafeIdentifier(value)).toBe(isSafeIdentifier(value))
    }
  })

  it('keeps recurrence and reminder semantics identical on save, display and scan', () => {
    for (const freq of ['daily', 'weekly', 'monthly', 'yearly']) {
      for (const interval of [-1, 0, 1, 99, 365]) {
        const raw = { ...base, recurrence: { freq, interval, byWeekday: [0, 0, 6, 8], byMonthDay: [1, 31, 32], until: '2100-12-31' }, reminder: { enabled: true, minutesBefore: 600000, playSound: true } }
        const saved = sanitizeEventPayload(raw)!
        const shown = normalizeCalendarEvent(saved)!
        const scanned = normalizeReminderEvents([saved]).events[0]
        expect(saved.recurrence).toEqual(shown.recurrence)
        expect(saved.recurrence).toEqual(scanned.recurrence)
        expect(saved.reminder).toEqual(scanned.reminder)
        expect(saved.reminder).toEqual(shown.reminder)
      }
    }
  })

  it('rejects invalid core fields without mutating the caller', () => {
    expect(sanitizeEventPayload({ ...base, id: 'bad id' })).toBeNull()
    expect(sanitizeEventPayload({ ...base, title: ' ' })).toBeNull()
    expect(sanitizeEventPayload({ ...base, startDate: '2101-01-01' })).toBeNull()
    const raw = Object.freeze({ ...base, title: '  标题  ', endDate: 'invalid' })
    expect(sanitizeEventPayload(raw)?.title).toBe('标题')
    expect(sanitizeEventPayload(raw)?.endDate).toBeUndefined()
    expect(raw.title).toBe('  标题  ')
  })

  it('clears removed options and occurrence metadata while retaining the creation timestamp', () => {
    const existing = { ...base, createdAt: '2020-01-01T00:00:00Z', tagId: 'old', recurrence: { freq: 'daily', interval: 1 }, reminder: { enabled: true, minutesBefore: 5 }, occurrenceKey: 'old', startTime: '10:00', endTime: '11:00' }
    const saved = sanitizeEventPayload(base, existing)!
    for (const field of ['tagId', 'recurrence', 'reminder', 'occurrenceKey', 'startTime', 'endTime']) expect(saved).not.toHaveProperty(field)
    expect(saved.createdAt).toBe(existing.createdAt)
  })

  it('only permits timed reminders with a valid start time, or all-day reminders', () => {
    const reminder = { enabled: true, minutesBefore: 10, playSound: false }
    expect(sanitizeEventPayload({ ...base, isAllDay: false, reminder })?.reminder).toBeUndefined()
    expect(sanitizeEventPayload({ ...base, isAllDay: false, startTime: '25:00', reminder })?.reminder).toBeUndefined()
    expect(sanitizeEventPayload({ ...base, isAllDay: false, startTime: '09:00', reminder })?.reminder).toEqual(reminder)
    expect(sanitizeEventPayload({ ...base, reminder })?.reminder).toEqual(reminder)
  })

  it('keeps tag payload limits and default colors explicit', () => {
    expect(sanitizeTagPayload({ id: 'tag_qa', name: '  工作  ', color: 'bad' })).toMatchObject({ name: '工作', color: '#2563EB' })
    expect(sanitizeTagPayload({ id: 'tag_qa', name: 'x'.repeat(60) })?.name.length).toBe(50)
    expect(sanitizeTagPayload({ id: 'tag_qa', name: ' ' })).toBeNull()
  })
})
