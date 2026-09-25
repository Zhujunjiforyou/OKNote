import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { buildDailyTodoItemsByDate, filterEventsByDate, isEventCompleted, isTodoOverdue, normalizeCalendarEvent } from '../src/lib/utils'
import type { CalendarEvent } from '../src/types/calendar.types'
import type { Note } from '../src/types/notes.types'

const require = createRequire(import.meta.url)
const { migrateEventCompletions, setEventCompletion } = require('../electron/event-completion.cjs')
const { sanitizeEventPayload } = require('../electron/event-payload.cjs')
const { normalizeReminderEvents } = require('../electron/reminder-data.cjs')
const { collectDueReminders } = require('../electron/reminder-reliability.cjs')
const day = '2026-09-11'
const event: CalendarEvent = { id: 'task', title: '测试事件', description: '', startDate: day, isAllDay: true, color: '#2563eb', createdAt: '', updatedAt: '' }
const daily: Note = { id: 'daily', title: '每日待办', color: '#fff', noteType: 'daily', items: [], createdAt: '', updatedAt: '', dailyTodo: { completedEventOccurrences: ['task', 'repeat__2026-09-11', 'repeat_extra__2026-09-12'] } }

describe('shared task completion', () => {
  it('migrates legacy completions per event/occurrence without changing the source note', () => {
    const before = JSON.stringify(daily)
    const result = migrateEventCompletions([event, { ...event, id: 'repeat', recurrence: { freq: 'daily', interval: 1 } }], [daily])
    expect(result[0].completion).toEqual({ completed: true, occurrenceDates: [] })
    expect(result[1].completion).toEqual({ completed: false, occurrenceDates: [day] })
    expect(JSON.stringify(daily)).toBe(before)
  })

  it('does not resurrect a legacy completion after undo and reload', () => {
    const [migrated] = migrateEventCompletions([event], [daily])
    const undone = setEventCompletion(migrated, day, false)
    const [reloaded] = migrateEventCompletions([JSON.parse(JSON.stringify(undone))], [daily])
    expect(isEventCompleted(reloaded, new Set(['task']))).toBe(false)
  })

  it('shares completion across a multi-day event while keeping repeats independent', () => {
    const completed = setEventCompletion({ ...event, endDate: '2026-09-13' }, day, true)
    for (const date of [day, '2026-09-12', '2026-09-13']) expect(isEventCompleted(filterEventsByDate([completed], date)[0])).toBe(true)
    const repeated = setEventCompletion({ ...event, recurrence: { freq: 'daily', interval: 1 }, endDate: '2026-09-12' }, day, true)
    expect(filterEventsByDate([repeated], '2026-09-12').map((item) => isEventCompleted(item))).toEqual([true, false])
  })

  it('merges separate occurrence commands and rejects invalid dates', () => {
    const repeated = { ...event, recurrence: { freq: 'daily', interval: 1 } }
    const first = setEventCompletion(repeated, day, true)
    const second = setEventCompletion(first, '2026-09-12', true)
    expect(second.completion.occurrenceDates).toEqual([day, '2026-09-12'])
    expect(setEventCompletion(second, '2026-02-30', true)).toBeNull()
    expect(setEventCompletion(second, day, false).completion.occurrenceDates).toEqual(['2026-09-12'])
  })

  it('keeps state through frontend, reminder normalization and unrelated edits', () => {
    const completed = setEventCompletion(event, day, true)
    expect(normalizeCalendarEvent(completed)?.completion).toEqual(completed.completion)
    expect(normalizeReminderEvents([completed]).events[0].completion).toEqual(completed.completion)
    expect(sanitizeEventPayload({ ...event, title: '改标题', completion: { completed: false } }, completed).completion).toEqual(completed.completion)
  })

  it('suppresses only completed reminders, including catch-up reminders', () => {
    const repeat = { ...event, reminder: { enabled: true, minutesBefore: 0 }, recurrence: { freq: 'daily', interval: 1 } }
    const completed = setEventCompletion(repeat, day, true)
    const occurrences = [filterEventsByDate([completed], day)[0], filterEventsByDate([completed], '2026-09-12')[0], setEventCompletion({ ...event, reminder: repeat.reminder }, day, true)]
    const due = collectDueReminders({ events: occurrences, fired: {}, nowMs: 1000, catchUpStartMs: 0, lateGraceMs: 0, getStartMillis: () => 500 })
    expect(due).toHaveLength(1)
    expect(due[0].event.startDate).toBe('2026-09-12')
  })

  it('shows dated todos from any note without copying undated items or completed counts', () => {
    const notes: Note[] = [daily, { ...daily, id: 'personal', title: '项目便签', noteType: 'independent', items: [
      { id: 'dated', noteId: 'personal', content: '已排期', isCompleted: false, sortOrder: 0, todoDate: day },
      { id: 'undated', noteId: 'personal', content: '随手记', isCompleted: false, sortOrder: 1 },
      { id: 'done', noteId: 'personal', content: '已完成', isCompleted: true, sortOrder: 2, todoDate: day },
    ] }]
    expect(buildDailyTodoItemsByDate(notes, day, day).get(day)?.map((item) => item.id)).toEqual(['dated'])
    expect(buildDailyTodoItemsByDate(notes, day, day, true).get(day)?.map((item) => item.id)).toEqual(['dated', 'done'])
    expect(buildDailyTodoItemsByDate(notes, day, day).get(day)?.[0]).toMatchObject({ noteId: 'personal', noteType: 'independent', noteTitle: '项目便签' })
  })

  it('mutes only past unfinished todos without changing completion', () => {
    expect(isTodoOverdue({ todoDate: day, isCompleted: false }, '2026-09-12')).toBe(true)
    expect(isTodoOverdue({ todoDate: day, isCompleted: false }, day)).toBe(false)
    expect(isTodoOverdue({ todoDate: day, isCompleted: true }, '2026-09-12')).toBe(false)
    expect(isTodoOverdue({ isCompleted: false }, '2026-09-12')).toBe(false)
  })
})
