import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  expandReminderEventsForDueWindow,
  expandReminderEventsInRange,
  normalizeReminderEvents,
  normalizeReminderHistory,
} = require('../electron/reminder-data.cjs') as {
  expandReminderEventsForDueWindow: (
    events: Array<Record<string, unknown>>,
    catchUpStartMs: number,
    nowMs: number,
    maxDays?: number,
  ) => Array<Record<string, unknown>>
  expandReminderEventsInRange: (events: Array<Record<string, unknown>>, start: string, end: string, maxDays?: number) => Array<Record<string, unknown>>
  normalizeReminderEvents: (raw: unknown) => { events: Array<Record<string, unknown>>; rejectedCount: number; repairedCount: number }
  normalizeReminderHistory: (raw: unknown, limit?: number) => { entries: Array<Record<string, unknown>>; rejectedCount: number }
}

describe('reminder data isolation', () => {
  it('isolates null history entries without breaking usable reminders', () => {
    const result = normalizeReminderHistory([
      null,
      {
        id: 'reminder_bad_time',
        eventId: 'event_bad_time',
        startDate: '2026-08-30',
        firedAt: 123,
      },
      {
        id: 'reminder_ok',
        eventId: 'event_ok',
        title: '有效提醒',
        startDate: '2026-08-30',
        firedAt: '2026-08-30T01:00:00.000Z',
        read: false,
        isAllDay: true,
      },
    ])

    expect(result.rejectedCount).toBe(2)
    expect(result.entries).toMatchObject([{ id: 'reminder_ok', title: '有效提醒', read: false }])
  })

  it('drops an illegal end date before recurrence expansion while preserving the reminder', () => {
    const normalized = normalizeReminderEvents([{
      id: 'event_ok',
      title: '仍应提醒',
      startDate: '2026-08-30',
      endDate: 'not-a-date',
      isAllDay: true,
      recurrence: { freq: 'daily', interval: 1 },
      reminder: { enabled: true, minutesBefore: 0 },
    }])

    expect(normalized).toMatchObject({ rejectedCount: 0, repairedCount: 1 })
    expect(normalized.events[0]).not.toHaveProperty('endDate')
    expect(expandReminderEventsInRange(normalized.events, '2026-08-30', '2026-09-01'))
      .toHaveLength(3)
  })

  it('clamps recurrence intervals to the renderer maximum', () => {
    const normalized = normalizeReminderEvents([{
      id: 'event_interval',
      title: '周期边界',
      startDate: '2026-08-31',
      isAllDay: true,
      recurrence: { freq: 'daily', interval: 365 },
    }])

    expect(normalized.events[0]?.recurrence?.interval).toBe(99)
  })

  it('keeps ten thousand long-lead daily recurrences within the main-process budget', () => {
    const events = Array.from({ length: 10_000 }, (_, index) => ({
      id: `event_${index}`,
      title: `循环事件 ${index}`,
      startDate: '2016-01-01',
      isAllDay: true,
      recurrence: { freq: 'daily', interval: 1 },
      reminder: { enabled: true, minutesBefore: 525_600 },
    }))
    const nowMs = new Date(2026, 7, 30, 10, 0, 0, 0).getTime()
    const catchUpStartMs = nowMs - 3 * 60 * 60 * 1000
    const startedAt = performance.now()
    const normalized = normalizeReminderEvents(events)
    const expanded = expandReminderEventsForDueWindow(normalized.events, catchUpStartMs, nowMs)
    const elapsedMs = performance.now() - startedAt

    expect(normalized.rejectedCount).toBe(0)
    expect(expanded).toHaveLength(10_000)
    expect(elapsedMs).toBeLessThan(500)
  })
})
