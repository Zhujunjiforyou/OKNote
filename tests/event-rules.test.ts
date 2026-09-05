import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { normalizeCalendarEvent } from '../src/lib/utils'

const require = createRequire(import.meta.url)
const { normalizeRecurrenceInterval, RECURRENCE_INTERVAL_MAX } = require('../electron/event-rules.cjs') as {
  normalizeRecurrenceInterval: (value: unknown) => number
  RECURRENCE_INTERVAL_MAX: number
}

describe('recurrence interval boundary', () => {
  it('uses the same 1–99 range in the main process and renderer', () => {
    const rendererEvent = normalizeCalendarEvent({
      id: 'event_1',
      title: '循环',
      startDate: '2026-08-31',
      isAllDay: true,
      recurrence: { freq: 'daily', interval: 365 },
    })

    expect(RECURRENCE_INTERVAL_MAX).toBe(99)
    expect(normalizeRecurrenceInterval(365)).toBe(99)
    expect(normalizeRecurrenceInterval(0)).toBe(1)
    expect(rendererEvent?.recurrence?.interval).toBe(99)
  })
})
