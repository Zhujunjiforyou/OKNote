import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthGrid } from '../src/components/calendar/MonthGrid'
import { DayEventsModal } from '../src/components/calendar/DayEventsModal'
import { DailyTodoPanel } from '../src/components/notes/DailyTodoPanel'
import { useCalendarStore } from '../src/stores/calendar.store'
import { useNotesStore } from '../src/stores/notes.store'
import { filterEventsByDate, getEventInstanceKey } from '../src/lib/utils'
import type { CalendarEvent } from '../src/types/calendar.types'
import type { Note } from '../src/types/notes.types'

// Read the current store snapshot during server rendering, instead of Zustand's
// initial hydration snapshot, so each render reflects event and completion edits.
vi.mock('../src/stores/calendar.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/calendar.store')>()
  const store = actual.useCalendarStore
  return { ...actual, useCalendarStore: Object.assign((selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store) }
})
vi.mock('../src/stores/notes.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/notes.store')>()
  const store = actual.useNotesStore
  return { ...actual, useNotesStore: Object.assign((selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()), store) }
})

const date = '2026-09-11'
function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'single', title: '普通事件', description: '', startDate: date, isAllDay: true, color: '#2563EB', createdAt: '', updatedAt: '', ...overrides }
}
function note(completedEventOccurrences: string[] = []): Note {
  return {
    id: 'daily', title: '每日待办', color: '#2563EB', noteType: 'daily', items: [], createdAt: '', updatedAt: '',
    dailyTodo: { activeDate: date, completedEventOccurrences },
  }
}
function grid() {
  return renderToStaticMarkup(<MonthGrid todayKey={date} />)
}
function panel(daily: Note) {
  return renderToStaticMarkup(<DailyTodoPanel note={daily} panelBg="#fff" panelBorder="#ddd" textColor="#111" mutedColor="#666" lightBg />)
}
function dayDetails() {
  return renderToStaticMarkup(<DayEventsModal isOpen onClose={() => {}} />)
}
function expectCount(markup: string, dateKey: string, count: number) {
  const label = `打开 ${dateKey} 的每日待办，共 ${count} 个未完成项`
  if (count) expect(markup).toContain(`aria-label="${label}"`)
  else expect(markup).not.toContain(`aria-label="打开 ${dateKey} 的每日待办，共`)
}

describe('calendar badge and daily progress include every event type', () => {
  beforeEach(() => {
    useCalendarStore.setState({ currentDate: new Date(2026, 8, 11), events: [] })
    useNotesStore.setState({ notes: [] })
  })

  it('shows a badge and a daily entry after adding a single-day event without an existing daily note', () => {
    expectCount(grid(), date, 0)
    useCalendarStore.setState({ events: [event()] })
    expectCount(grid(), date, 1)
    const markup = panel(note())
    expect(markup).toContain('完成事件：普通事件')
    expect(markup).toContain('0/1')
    expect(markup).not.toContain('打开循环事件')
    useCalendarStore.setState({ events: [] })
    expectCount(grid(), date, 0)
  })

  it('combines manual todos, timed events, all-day events and recurring occurrences', () => {
    const daily = note()
    daily.items = [
      { id: 'todo', noteId: daily.id, content: '手工待办', todoDate: date, isCompleted: false, sortOrder: 0 },
      { id: 'done', noteId: daily.id, content: '已完成', todoDate: date, isCompleted: true, sortOrder: 1 },
    ]
    useNotesStore.setState({ notes: [daily] })
    useCalendarStore.setState({ events: [event(), event({ id: 'timed', isAllDay: false, startTime: '20:00' }), event({ id: 'repeat', recurrence: { freq: 'daily', interval: 1 } }), event({ id: 'outside', startDate: '2026-10-01' })] })
    expectCount(grid(), date, 4)
    expect(panel(daily)).toContain('1/5')
  })

  it('removes completed ordinary events from the badge and restores them when unchecked', () => {
    useCalendarStore.setState({ events: [event()] })
    const completed = note(['single'])
    useNotesStore.setState({ notes: [completed] })
    expectCount(grid(), date, 0)
    expect(panel(completed)).toContain('恢复事件：普通事件')
    expect(panel(completed)).toContain('1/1')
    useNotesStore.setState({ notes: [note()] })
    expectCount(grid(), date, 1)
    expect(panel(note())).toContain('0/1')
  })

  it('counts a multi-day event on every covered date using one shared completion state', () => {
    useCalendarStore.setState({ events: [event({ endDate: '2026-09-13' })] })
    for (const day of [date, '2026-09-12', '2026-09-13']) expectCount(grid(), day, 1)
    expectCount(grid(), '2026-09-14', 0)
    useNotesStore.setState({ notes: [note(['single'])] })
    for (const day of [date, '2026-09-12', '2026-09-13']) expectCount(grid(), day, 0)
  })

  it('completes only the selected occurrence of a recurring event', () => {
    const source = event({ recurrence: { freq: 'daily', interval: 1 } })
    useCalendarStore.setState({ events: [source] })
    const key = getEventInstanceKey(filterEventsByDate([source], date)[0])
    useNotesStore.setState({ notes: [note([key])] })
    expectCount(grid(), date, 0)
    expectCount(grid(), '2026-09-12', 1)
  })

  it('shows the same dated manual todos in day details as in the calendar, including their full content', () => {
    const daily = note()
    const longContent = '整理待办详情📝'.repeat(30) + '\n保留这条待办的最后一行'
    daily.items = [
      { id: 'later', noteId: daily.id, content: longContent, todoDate: date, isCompleted: false, sortOrder: 2 },
      { id: 'first', noteId: daily.id, content: '先处理这一项', todoDate: date, isCompleted: false, sortOrder: 1 },
      { id: 'done', noteId: daily.id, content: '已经完成的事项', todoDate: date, isCompleted: true, sortOrder: 0 },
      { id: 'tomorrow', noteId: daily.id, content: '另一天的事项', todoDate: '2026-09-12', isCompleted: false, sortOrder: 0 },
    ]
    useNotesStore.setState({ notes: [daily, { ...daily, id: 'independent', noteType: 'independent', items: [
      { id: 'private', noteId: 'independent', content: '独立便签事项', todoDate: date, isCompleted: false, sortOrder: 0 },
    ] }] })
    const markup = dayDetails()
    expectCount(grid(), date, 3)
    expect(markup).toContain(longContent)
    expect(markup.indexOf('先处理这一项')).toBeLessThan(markup.indexOf(longContent))
    expect(markup).not.toContain('暂无')
    expect(markup).not.toContain('另一天的事项')
    expect(markup).toContain('独立便签事项')
    expect(markup).toContain('已经完成的事项')
    expect(markup).toContain('task-completed')
  })

  it('keeps todos alongside ordinary, multi-day and recurring events and follows date and completion changes', () => {
    const daily = note()
    daily.items = [{ id: 'todo', noteId: daily.id, content: '当天手工待办', todoDate: date, isCompleted: false, sortOrder: 0 }]
    useNotesStore.setState({ notes: [daily] })
    useCalendarStore.setState({ events: [event(), event({ id: 'range', title: '跨日事件', endDate: '2026-09-13' }), event({ id: 'repeat', title: '循环事件', recurrence: { freq: 'daily', interval: 1 } })] })
    const mixed = dayDetails()
    for (const title of ['当天手工待办', '普通事件', '跨日事件', '循环事件']) expect(mixed).toContain(title)
    expectCount(grid(), date, 4)
    useCalendarStore.setState({ currentDate: new Date(2026, 8, 12) })
    expect(dayDetails()).not.toContain('当天手工待办')
    expect(dayDetails()).toContain('跨日事件')
    useCalendarStore.setState({ currentDate: new Date(2026, 8, 11), events: [] })
    useNotesStore.setState({ notes: [{ ...daily, items: daily.items.map(item => ({ ...item, isCompleted: true })) }] })
    expectCount(grid(), date, 0)
    expect(dayDetails()).not.toContain('暂无待办或事件')
    expect(dayDetails()).toContain('当天手工待办')
    expect(dayDetails()).toContain('task-completed')
  })
})
