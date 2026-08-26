import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { buildReminderKey, collectDueReminders, eventStartMillis } = require('../electron/reminder-reliability.cjs') as {
  buildReminderKey: (event: Record<string, unknown>, minutesBefore: number) => string
  collectDueReminders: (options: Record<string, unknown>) => Array<{ key: string; missed: boolean; reminderMs: number }>
  eventStartMillis: (event: Record<string, unknown>) => number | null
}

function remindedEvent(updatedAt = '2026-08-01T00:00:00.000Z') {
  return {
    id: 'event_test',
    title: '离线期间到期的提醒',
    startDate: '2026-08-23',
    startTime: '09:00',
    updatedAt,
    reminder: { enabled: true, minutesBefore: 0 },
  }
}

describe('offline reminder catch-up', () => {
  it('records reminders older than two hours as missed instead of silently dropping them', () => {
    const nowMs = Date.parse('2026-08-24T12:00:00.000Z')
    const reminderMs = nowMs - 26 * 60 * 60 * 1000
    const due = collectDueReminders({
      events: [remindedEvent()],
      fired: {},
      nowMs,
      catchUpStartMs: nowMs - 30 * 60 * 60 * 1000,
      lateGraceMs: 2 * 60 * 60 * 1000,
      getStartMillis: () => reminderMs,
    })

    expect(due).toMatchObject([{ missed: true, reminderMs }])
  })

  it('does not repeat a reminder merely because unrelated event text changed', () => {
    const before = remindedEvent('2026-08-01T00:00:00.000Z')
    const after = remindedEvent('2026-08-24T00:00:00.000Z')
    expect(buildReminderKey(before, 0)).toBe(buildReminderKey(after, 0))
  })

  it('does not resurrect reminders older than the persisted catch-up boundary', () => {
    const nowMs = Date.parse('2026-08-24T12:00:00.000Z')
    const due = collectDueReminders({
      events: [remindedEvent()],
      fired: {},
      nowMs,
      catchUpStartMs: nowMs - 24 * 60 * 60 * 1000,
      lateGraceMs: 2 * 60 * 60 * 1000,
      getStartMillis: () => nowMs - 26 * 60 * 60 * 1000,
    })

    expect(due).toHaveLength(0)
  })

  it('requires a start time for timed reminders and uses 09:00 only for all-day events', () => {
    expect(eventStartMillis({ startDate: '2026-08-25', isAllDay: false })).toBeNull()
    expect(eventStartMillis({ startDate: '2026-08-25', isAllDay: true }))
      .toBe(new Date('2026-08-25T09:00:00').getTime())
  })
})
