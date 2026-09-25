import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(path.join(process.cwd(), 'electron/main.cjs'), 'utf8')

// Run the real startup, shutdown and reminder persistence functions with a
// delayed Windows registration. No real registry, files or notifications.
function bootHarness() {
  const history = [{ id: 'existing', key: 'already-fired', read: false }]
  const checkpoint = { fired: { 'already-fired': '2026-09-10T00:00:00.000Z' }, lastCheckedAt: '2026-09-10T00:00:00.000Z' }
  const files = new Map<string, any>([['reminder-history.json', history], ['reminder-state.json', checkpoint]])
  let resolveIdentity!: (value: boolean) => void
  const identity = new Promise<boolean>(resolve => { resolveIdentity = resolve })
  let boot!: Promise<void>
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, isQuitting: false, isReady: () => true, quit: vi.fn(), setAppUserModelId: vi.fn(),
    whenReady: () => ({ then: (fn: () => Promise<void>) => { boot = fn() } }),
  })
  const context = vm.createContext({
    app, process: { platform: 'win32', env: {} }, console, path,
    hasSingleInstanceLock: true, forceAppQuit: false, isIsolatedTestInstance: false,
    notificationAppIdentity: { id: 'com.oknote.app', name: 'OKNote' }, ICONS_DIR: '/icons',
    registerNotificationIdentity: () => identity, nativeNotificationIdentityReady: false, reminderDeliveryReady: false, reminderScanRunning: false, reminderRetryPending: false,
    Menu: { setApplicationMenu: vi.fn() },
    session: { defaultSession: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() } },
    appSettings: {}, windowBounds: {}, winRegistry: { calendar: null, settings: null, notes: {} },
    noteCacheHydrationPromise: null, noteCacheReady: false, eventsLoadError: null,
    reminderDeliveryKeys:new Set(),reminderReadDuringDelivery:new Set(),
    reminderState: { fired: {} }, reminderHistory: [], reminderTimer: null,
    REMINDER_STATE_FILE: 'reminder-state.json', REMINDER_HISTORY_FILE: 'reminder-history.json',
    REMINDER_CHECKPOINT_MS: 600000, REMINDER_POLL_MS: 15000,
    boundsSaveTimer: null, settingsSaveTimer: null, settingsBroadcastTimer: null,
    loadAppData: (name: string) => structuredClone(files.get(name)),
    saveAppData: vi.fn((name: string, value: unknown) => { files.set(name, structuredClone(value)); return true }),
    isPlainRecord: (value: any) => value && typeof value === 'object' && !Array.isArray(value),
    normalizeReminderHistory: (entries: any[]) => ({ entries, rejectedCount: 0 }),
    hydrateNoteCacheAsync: () => Promise.resolve(), shouldStartHidden: () => false,
    setInterval: vi.fn(() => 1), clearInterval: vi.fn(), clearTimeout: vi.fn(),
  })
  for (const name of ['ensureDataDir', 'prepareLegacyLocalData', 'loadSettings', 'loadWindowBounds', 'setupIPC', 'createTray',
    'createCalendarWindow', 'showCalendar', 'migrateLegacyNotesFile', 'ensureSingleDailyNote', 'ensureUniqueViewNotes',
    'broadcastSettings', 'notifyNotesChanged', 'queueStartupReliabilityIssue', 'applyLoginItemSettings', 'loadSystemFontsAsync',
    'checkEventReminders', 'saveSettings', 'saveWindowBounds', 'requestAppQuit', 'broadcastReminderHistory']) context[name] = vi.fn()
  const fragment = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end))
  vm.runInContext(fragment('function loadReminderState()', 'function cleanupReminderState()'), context)
  vm.runInContext(fragment('function startReminderScheduler()', 'function broadcastEventsChanged('), context)
  vm.runInContext(fragment('function markReminderHistoryEntryRead(', 'function requeueReminderKey('), context)
  vm.runInContext(source.slice(source.indexOf('// ── App ──')), context)
  return { context, app, files, checkpoint, resolveIdentity, boot: () => boot }
}

describe('reminder startup races', () => {
  it('loads durable history before the first window while native registration is pending', async () => {
    const h = bootHarness()
    expect(h.context.createCalendarWindow).toHaveBeenCalledOnce()
    expect(h.context.reminderHistory).toEqual([{ id: 'existing', key: 'already-fired', read: false }])
    expect(h.context.checkEventReminders).not.toHaveBeenCalled()
    expect(h.context.markReminderHistoryEntryRead('existing')).toBe(true)
    h.resolveIdentity(true)
    await h.boot()
    expect(h.context.reminderHistory[0].read).toBe(true)
    expect(h.context.checkEventReminders).toHaveBeenCalledOnce()
  })

  it.each(['hydration', 'registration'])('preserves deduplication and the unscanned interval when quitting during %s', async phase => {
    const h = bootHarness()
    if (phase === 'registration') await vi.waitFor(() => expect(h.context.loadSystemFontsAsync).toHaveBeenCalledOnce())
    h.context.forceAppQuit = true
    h.app.emit('before-quit', { preventDefault: vi.fn() })
    expect(h.files.get('reminder-state.json')).toEqual(h.checkpoint)
    expect(h.context.saveAppData).not.toHaveBeenCalled()
    h.resolveIdentity(true)
    await h.boot()
    expect(h.context.checkEventReminders).not.toHaveBeenCalled()
    expect(h.context.setInterval).not.toHaveBeenCalled()
  })

  it('starts fallback delivery with existing history when native identity is unavailable', async () => {
    const h = bootHarness()
    h.resolveIdentity(false)
    await h.boot()
    expect(h.context.nativeNotificationIdentityReady).toBe(false)
    expect(h.context.reminderDeliveryReady).toBe(true)
    expect(h.context.reminderHistory).toHaveLength(1)
    expect(h.context.checkEventReminders).toHaveBeenCalledOnce()
  })

  it('still persists a checkpoint on normal shutdown after reminder startup', async () => {
    const h = bootHarness()
    h.resolveIdentity(true)
    await h.boot()
    h.context.forceAppQuit = true
    h.app.emit('before-quit', { preventDefault: vi.fn() })
    expect(h.files.get('reminder-state.json').fired).toEqual(h.checkpoint.fired)
    expect(h.context.saveAppData).toHaveBeenCalledOnce()
    expect(h.context.clearInterval).toHaveBeenCalledWith(1)
  })
  it.each(['reminderScanRunning','reminderRetryPending'])('does not advance the shutdown checkpoint while %s', async flag => {
    const h = bootHarness()
    h.resolveIdentity(true)
    await h.boot()
    h.context[flag] = true
    h.context.forceAppQuit = true
    h.app.emit('before-quit', {preventDefault:vi.fn()})
    expect(h.context.saveAppData).not.toHaveBeenCalled()
    expect(h.files.get('reminder-state.json')).toEqual(h.checkpoint)
  })

})
