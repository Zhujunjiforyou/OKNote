import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('electron/main.cjs','utf8')
function harness(missed = false) {
  const now = Date.now()
  const item = {key:'event-key',event:{id:'event',title:'会议',reminder:{enabled:true}},reminderMs:now-60000,missed}
  let finish!: (delivered:boolean) => void
  const context = vm.createContext({
    reminderDeliveryReady:true,reminderScanRunning:false,reminderRetryPending:false,eventsLoadError:null,
    reminderDeliveryKeys:new Set(),reminderReadDuringDelivery:new Set(),
    reminderState:{fired:{},lastCheckedAt:new Date(now-120000).toISOString()},reminderHistory:[],
    REMINDER_MAX_CATCH_UP_MS:86400000,REMINDER_LATE_GRACE_MS:300000,
    REMINDER_STATE_FILE:'state',REMINDER_HISTORY_FILE:'history',crypto,console,
    loadEventsSnapshot:() => [item.event],normalizeReminderEvents:() => ({events:[item.event]}),
    expandReminderEventsForDueWindow:vi.fn(),eventStartMillis:vi.fn(),collectDueReminders:() => [item],
    reportReminderDataIssue:vi.fn(),checkpointReminderState:vi.fn(() => true),cleanupReminderState:vi.fn(),
    fireEventReminder:vi.fn(() => new Promise<boolean>(resolve => {finish=resolve})),
    fireMissedReminderSummary:vi.fn(async () => true),applyDataChanges:vi.fn(),
    broadcastReminderHistory:vi.fn(),broadcastPersistenceFailure:vi.fn(),
  })
  vm.runInContext(source.slice(source.indexOf('async function checkEventReminders()'),source.indexOf('function startReminderScheduler()')),context)
  return {context,finish:(value:boolean) => finish(value)}
}

describe('reminder scan delivery transaction', () => {
  it('never commits early, suppresses overlapping scans, and retries a failed delivery', async () => {
    const h = harness()
    const originalCheckpoint = h.context.reminderState.lastCheckedAt
    const pending = h.context.checkEventReminders()
    await h.context.checkEventReminders()
    expect(h.context.fireEventReminder).toHaveBeenCalledOnce()
    expect(h.context.applyDataChanges).not.toHaveBeenCalled()
    expect(h.context.reminderScanRunning).toBe(true)
    h.finish(false)
    await pending
    expect(h.context.reminderScanRunning).toBe(false)
    expect(h.context.reminderRetryPending).toBe(true)
    expect(h.context.reminderState.lastCheckedAt).toBe(originalCheckpoint)
    expect(h.context.reminderHistory).toHaveLength(0)
    h.context.fireEventReminder.mockResolvedValue(true)
    await h.context.checkEventReminders()
    expect(h.context.reminderRetryPending).toBe(false)
    expect(h.context.reminderHistory).toHaveLength(1)
    expect(h.context.reminderState.fired['event-key']).toBeTruthy()
    expect(h.context.applyDataChanges).toHaveBeenCalledOnce()
  })
  it('keeps missed reminders pending when the summary cannot be displayed', async () => {
    const h = harness(true)
    h.context.fireMissedReminderSummary.mockResolvedValue(false)
    await h.context.checkEventReminders()
    expect(h.context.applyDataChanges).not.toHaveBeenCalled()
    expect(h.context.reminderRetryPending).toBe(true)
  })
  it('preserves an early notification click while other deliveries are pending', async () => {
    const h = harness()
    const pending = h.context.checkEventReminders()
    expect(h.context.reminderDeliveryKeys.has('event-key')).toBe(true)
    h.context.reminderReadDuringDelivery.add('event-key')
    h.finish(true)
    await pending
    expect(h.context.reminderHistory[0].read).toBe(true)
    expect(h.context.reminderDeliveryKeys.size).toBe(0)
    expect(h.context.reminderReadDuringDelivery.size).toBe(0)
  })
  it('preserves the checkpoint when delivery succeeds but persistence fails', async () => {
    const h = harness()
    const checkpoint = h.context.reminderState.lastCheckedAt
    h.context.fireEventReminder.mockResolvedValue(true)
    h.context.applyDataChanges.mockImplementation(() => {throw new Error('disk full')})
    await h.context.checkEventReminders()
    expect(h.context.reminderRetryPending).toBe(true)
    expect(h.context.reminderState.lastCheckedAt).toBe(checkpoint)
    expect(h.context.reminderHistory).toHaveLength(0)
  })
})
