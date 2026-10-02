import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarStore } from '../src/stores/calendar.store'
import type { CalendarEvent } from '../src/types/calendar.types'
import type { EventMutationResult } from '../src/types/electron'

const event: CalendarEvent = {
  id: 'selected-series', title: '同步事件', description: '', startDate: '2026-10-01',
  isAllDay: true, color: '#2563eb', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  recurrence: { freq: 'daily', interval: 1 },
}
const occurrence = '2026-10-02'

function deferMutation() {
  let resolve!: (result: EventMutationResult) => void
  const promise = new Promise<EventMutationResult>((complete) => { resolve = complete })
  vi.stubGlobal('window', { electronAPI: { isElectron: true, mutateEvent: vi.fn(() => promise) } })
  return resolve
}

beforeEach(() => {
  vi.stubGlobal('window', {})
  useCalendarStore.setState({ eventsRevision: 0, selectedEventId: null, selectedEventOccurrenceDate: null })
  useCalendarStore.getState().loadEvents([event], 1)
  useCalendarStore.getState().selectEvent(event.id, occurrence)
})

afterEach(() => vi.unstubAllGlobals())

describe('event snapshot selection', () => {
  it('clears a removed event and its selected occurrence when an external snapshot arrives', () => {
    useCalendarStore.getState().loadEvents([], 2)
    expect(useCalendarStore.getState()).toMatchObject({
      events: [], eventsRevision: 2, selectedEventId: null, selectedEventOccurrenceDate: null,
    })
  })

  it('keeps the selected occurrence through an unrelated event update', () => {
    useCalendarStore.getState().loadEvents([{ ...event, title: '已同步修改' }], 2)
    expect(useCalendarStore.getState()).toMatchObject({
      selectedEventId: event.id, selectedEventOccurrenceDate: occurrence,
    })
    expect(useCalendarStore.getState().events[0].title).toBe('已同步修改')
  })

  it('does not clear a valid selection or roll events back for an outdated snapshot', () => {
    useCalendarStore.getState().loadEvents([{ ...event, title: '最新快照' }], 3)
    useCalendarStore.getState().loadEvents([], 2)
    expect(useCalendarStore.getState()).toMatchObject({
      eventsRevision: 3, selectedEventId: event.id, selectedEventOccurrenceDate: occurrence,
    })
    expect(useCalendarStore.getState().events[0].title).toBe('最新快照')
  })

  it.each(['addEvent', 'updateEvent'] as const)('checks selection against the pending overlay during %s', async (operation) => {
    const resolve = deferMutation()
    const edited = { ...event, title: '正在保存' }
    const saving = useCalendarStore.getState()[operation](edited)
    useCalendarStore.getState().loadEvents([], 2)
    expect(useCalendarStore.getState()).toMatchObject({
      selectedEventId: event.id, selectedEventOccurrenceDate: occurrence,
    })
    expect(useCalendarStore.getState().events).toEqual([edited])

    // An older response cannot resurrect the event once this pending mutation is removed.
    resolve({ ok: false, code: 'conflict', events: [event], revision: 1 })
    await saving
    expect(useCalendarStore.getState()).toMatchObject({
      events: [], eventsRevision: 2, selectedEventId: null, selectedEventOccurrenceDate: null,
    })
  })

  it('keeps an optimistic selection when a newer save succeeds after an empty snapshot', async () => {
    const resolve = deferMutation()
    const edited = { ...event, title: '保存成功' }
    const saving = useCalendarStore.getState().updateEvent(edited)
    useCalendarStore.getState().loadEvents([], 2)
    resolve({ ok: true, events: [edited], revision: 3 })
    await saving
    expect(useCalendarStore.getState()).toMatchObject({
      eventsRevision: 3, selectedEventId: event.id, selectedEventOccurrenceDate: occurrence,
    })
    expect(useCalendarStore.getState().events[0].title).toBe(edited.title)
  })

  it('clears a removed selection from a completion mutation response', async () => {
    const resolve = deferMutation()
    const saving = useCalendarStore.getState().setEventCompleted(event.id, occurrence, true)
    resolve({ ok: false, code: 'not_found', events: [], revision: 2 })
    await saving
    expect(useCalendarStore.getState()).toMatchObject({
      events: [], selectedEventId: null, selectedEventOccurrenceDate: null,
    })
  })

  it('clears local deletion while preserving an unrelated selected event', () => {
    const other = { ...event, id: 'other' }
    useCalendarStore.getState().loadEvents([event, other], 2)
    useCalendarStore.getState().deleteEvent(other.id)
    expect(useCalendarStore.getState().selectedEventId).toBe(event.id)
    useCalendarStore.getState().deleteEvent(event.id)
    expect(useCalendarStore.getState()).toMatchObject({ selectedEventId: null, selectedEventOccurrenceDate: null })
  })
})

describe('viewport synchronization and today following', () => {
  it('preserves today following, selection and navigation when only viewport geometry changes', () => {
    useCalendarStore.getState().goToday()
    const before = useCalendarStore.getState()
    const month = new Date(before.browseDate.getFullYear(), before.browseDate.getMonth(), 1)
    useCalendarStore.getState().setBrowseDate(month, false)
    expect(useCalendarStore.getState().followToday).toBe(true)
    expect(useCalendarStore.getState().currentDate).toBe(before.currentDate)
    expect(useCalendarStore.getState().navigation).toBe(before.navigation)
    expect(useCalendarStore.getState().browseDate).toEqual(month)
  })

  it('does not restore following that was already canceled by the user', () => {
    useCalendarStore.getState().navigateToDate(new Date(2026, 9, 2))
    useCalendarStore.getState().setBrowseDate(new Date(2026, 9, 1), false)
    expect(useCalendarStore.getState().followToday).toBe(false)
  })

  it.each([undefined, true])('cancels following for a user browse even within the same month (%s)', (userInitiated) => {
    useCalendarStore.getState().goToday()
    const date = useCalendarStore.getState().browseDate
    useCalendarStore.getState().setBrowseDate(date, userInitiated)
    expect(useCalendarStore.getState().followToday).toBe(false)
  })
})
