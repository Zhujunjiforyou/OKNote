import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { APP_ID, notificationIdentity, registerNotificationIdentity } = require('../electron/notification-identity.cjs')
const source = readFileSync(path.join(process.cwd(), 'electron/main.cjs'), 'utf8')

describe('notification source identity', () => {
  it('uses the installer identity and isolates development notifications', () => {
    expect(APP_ID).toBe(require('../package.json').build.appId)
    expect(notificationIdentity(true)).toEqual({ id: APP_ID, name: 'OKNote' })
    expect(notificationIdentity(false).id).not.toBe(APP_ID)
  })

  it('registers source assets asynchronously with literal paths and propagates errors', async () => {
    const run = vi.fn((_file, _args, _options, callback) => callback(null))
    const icons = 'C:\\Apps\\中文 & OKNote\\icons'
    await registerNotificationIdentity(notificationIdentity(true), icons, { platform: 'win32', run })
    expect(run.mock.calls.map(call => call[1])).toEqual([
      ['add', `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'OKNote', '/f'],
      ['add', `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'IconUri', '/t', 'REG_SZ', '/d', path.join(icons, 'app-64.png'), '/f'],
    ])
    expect(run.mock.calls[0][2]).toMatchObject({ windowsHide: true, timeout: 5000 })
    const denied = vi.fn((_file, _args, _options, callback) => callback(new Error('denied')))
    await expect(registerNotificationIdentity(notificationIdentity(true), icons, { platform: 'win32', run: denied })).rejects.toThrow('denied')
    expect(denied).toHaveBeenCalledOnce()
    run.mockClear()
    await registerNotificationIdentity(notificationIdentity(true), icons, { platform: 'darwin', run })
    expect(run).not.toHaveBeenCalled()
  })
})

// Execute production handlers, replacing only the OS notification boundary.
function reminderHarness(overrides = {}, autoShow = true) {
  const notifications: Array<EventEmitter & { options: any; show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
  class Notification extends EventEmitter {
    static isSupported = vi.fn(() => true)
    show = vi.fn(() => { if(autoShow) this.emit('show') })
    close = vi.fn()
    constructor(public options: any) { super(); notifications.push(this) }
  }
  const context = vm.createContext({
    Notification, path, ICONS_DIR: '/icons', isIsolatedTestInstance: false, nativeNotificationTest: false, nativeNotificationIdentityReady: true,
    process: {platform:'win32'}, activeReminderNotifications: new Set(),
    waitForNativeNotification: require('../electron/notification-delivery.cjs').waitForNativeNotification,
    appSettings: { hideNotificationContent: false }, reminderToastWins: new Map(),
    markReminderHistoryEntryRead: vi.fn(), showCalendar: vi.fn(), openEventEditorInCalendar: vi.fn(),
    showReminderToast: vi.fn(async () => true), console, ...overrides,
  })
  vm.runInContext(source.slice(source.indexOf('async function getSystemNotificationSettings()'), source.indexOf('function broadcastReminderHistory()')), context)
  return { context, notifications, Notification }
}

describe('complete reminder delivery handlers', () => {
  const event = { id: 'event', title: '会议', startDate: '2026-09-10', startTime: '15:00', reminder: { playSound: true } }
  it('waits for delivery and keeps content, sound, click navigation and read state', async () => {
    const { context, notifications } = reminderHarness({}, false)
    const result = context.fireEventReminder(event, 'event-key')
    const notification = notifications[0]
    expect(notification.options).toMatchObject({ icon: path.join('/icons', 'app-64.png'), title: '会议', body: '2026-09-10 15:00', silent: false })
    expect(notification.show).toHaveBeenCalledOnce()
    expect(context.showReminderToast).not.toHaveBeenCalled()
    notification.emit('show')
    expect(await result).toBe(true)
    notification.emit('click')
    expect(context.markReminderHistoryEntryRead).toHaveBeenCalledWith(null, 'event-key')
    expect(context.openEventEditorInCalendar).toHaveBeenCalledWith(event)
  })

  it('falls back on native failure and returns false if both delivery methods fail', async () => {
    const { context, notifications } = reminderHarness({}, false)
    const result = context.fireEventReminder(event, 'key')
    notifications[0].emit('failed')
    expect(await result).toBe(true)
    expect(context.showReminderToast).toHaveBeenCalledWith(event, 'key')
    context.showReminderToast.mockResolvedValue(false)
    const retry = context.fireEventReminder(event, 'key2')
    notifications[1].emit('failed')
    expect(await retry).toBe(false)
  })

  it('honors privacy and uses the same confirmed delivery for summaries', async () => {
    const { context, notifications } = reminderHarness({ appSettings: { hideNotificationContent: true } })
    await context.fireEventReminder({ ...event, reminder: { playSound: false } }, 'key')
    expect(notifications[0].options).toMatchObject({ title: 'OKNote 事件提醒', body: '打开 OKNote 查看详情', silent: true })
    await context.fireReminderSummary(4)
    await context.fireMissedReminderSummary(2)
    expect(notifications.slice(1).map(n => n.options.title)).toEqual(['OKNote 提醒汇总', 'OKNote 错过的提醒'])
    for (const n of notifications.slice(1)) {
      expect(n.options.icon).toBe(path.join('/icons', 'app-64.png'))
      expect(n.options.silent).toBe(true)
      n.emit('click')
    }
    expect(context.showCalendar).toHaveBeenCalledTimes(2)
  })

  it.each([{ isIsolatedTestInstance: true }, { nativeNotificationIdentityReady: false }])('isolates OS notifications and falls back for events and summaries: %o', async overrides => {
    const { context, notifications, Notification } = reminderHarness(overrides)
    expect(await context.fireEventReminder(event, 'key')).toBe(true)
    expect(context.showReminderToast).toHaveBeenCalledWith(event, 'key')
    expect(await context.fireReminderSummary(4)).toBe(true)
    expect(await context.fireMissedReminderSummary(2)).toBe(true)
    expect(context.showReminderToast).toHaveBeenCalledTimes(3)
    expect(notifications).toHaveLength(0)
    expect(Notification.isSupported).not.toHaveBeenCalled()
  })

  it('lets an explicit installed-build QA session exercise native delivery', async () => {
    const { context, notifications } = reminderHarness({ isIsolatedTestInstance: true, nativeNotificationTest: true })
    expect(await context.fireEventReminder(event, 'native-qa')).toBe(true)
    expect(notifications).toHaveLength(1)
    expect(context.showReminderToast).not.toHaveBeenCalled()
  })
})
