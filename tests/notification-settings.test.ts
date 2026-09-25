import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { notificationSettingsMessage } from '../src/components/SystemNotificationStatus'

const require = createRequire(import.meta.url)
const { notificationSettingsState, suppressNotificationFallback } = require('../electron/notification-settings.cjs')
const source = readFileSync('electron/main.cjs', 'utf8')
const authorized = { authorizationStatus: 2, alertSetting: 2, alertStyle: 1, notificationCenterSetting: 2, soundSetting: 2 }

describe('macOS notification settings', () => {
  it('distinguishes unknown, not requested, denied and authorized permissions', () => {
    expect(notificationSettingsState().authorization).toBe('unknown')
    expect(notificationSettingsState({ authorizationStatus: 0 }).authorization).toBe('not-determined')
    expect(notificationSettingsState({ authorizationStatus: 1 }).authorization).toBe('denied')
    expect(notificationSettingsState(authorized)).toEqual({ authorization: 'authorized', alerts: 'enabled', alertStyle: 'banner', notificationCenter: 'enabled', sound: 'enabled' })
  })

  it.each([
    [1, 2, 1, true], [2, 1, 1, true], [2, 2, 0, true], [3, 2, 1, true],
    [0, 0, 0, false], [2, 2, 1, false], [2, 2, 2, false], [-1, -1, -1, false],
  ])('respects authorization=%s alerts=%s style=%s without treating unknown as denial', (authorizationStatus, alertSetting, alertStyle, expected) => {
    expect(suppressNotificationFallback(notificationSettingsState({ authorizationStatus, alertSetting, alertStyle }))).toBe(expected)
  })

  it('does not load a macOS module for Windows settings queries', async () => {
    const getMacDesktopBinding = vi.fn()
    const context = vm.createContext({ process: { platform: 'win32' }, getMacDesktopBinding })
    vm.runInContext(source.slice(source.indexOf('async function getSystemNotificationSettings()'), source.indexOf('async function isSystemNotificationSuppressed()')), context)
    expect(await context.getSystemNotificationSettings()).toBeNull()
    expect(getMacDesktopBinding).not.toHaveBeenCalled()
  })

  it('reports a failed native read as unknown and reads again on the next request', async () => {
    const getNotificationSettings = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(authorized)
    const context = vm.createContext({ process: { platform: 'darwin' }, notificationSettingsState,
      getMacDesktopBinding: () => ({ getNotificationSettings }), console: { warn: vi.fn() } })
    vm.runInContext(source.slice(source.indexOf('async function getSystemNotificationSettings()'), source.indexOf('async function isSystemNotificationSuppressed()')), context)
    expect((await context.getSystemNotificationSettings()).authorization).toBe('unknown')
    expect((await context.getSystemNotificationSettings()).authorization).toBe('authorized')
  })

  it('explains disabled, quiet and unknown states without promising a visible banner', () => {
    expect(notificationSettingsMessage(notificationSettingsState({ authorizationStatus: 1 }))).toContain('关闭通知')
    expect(notificationSettingsMessage(notificationSettingsState({ ...authorized, alertStyle: 0 }))).toContain('样式已关闭')
    expect(notificationSettingsMessage(notificationSettingsState())).toContain('暂时无法读取')
    expect(notificationSettingsMessage(notificationSettingsState({ authorizationStatus: 0 }))).toContain('尚未授权')
    expect(notificationSettingsMessage(notificationSettingsState({ authorizationStatus: 3 }))).toContain('安静递送')
    expect(notificationSettingsMessage(notificationSettingsState(authorized))).toContain('仍可能隐藏横幅')
  })
})

describe('reminder delivery honors system alert preferences', () => {
  const makeContext = (suppressed: boolean, delivered = false) => {
    const context = vm.createContext({
      canUseNativeNotifications: () => true, appSettings: {},
      deliverNativeReminder: vi.fn(async () => delivered), isSystemNotificationSuppressed: vi.fn(async () => suppressed),
      reminderToastWins: new Map(), showReminderToast: vi.fn(async () => true),
      markReminderHistoryEntryRead: vi.fn(), openEventEditorInCalendar: vi.fn(), showCalendar: vi.fn(), console,
    })
    vm.runInContext(source.slice(source.indexOf('async function fireEventReminder('), source.indexOf('function broadcastReminderHistory()')), context)
    return context
  }

  it.each([true, false])('only uses the existing fallback when suppression=%s permits it', async suppressed => {
    const context = makeContext(suppressed)
    expect(await context.fireEventReminder({ title: '测试', startDate: '2026-09-17', isAllDay: true }, 'key')).toBe(true)
    expect(await context.fireReminderSummary(2)).toBe(true)
    expect(await context.fireMissedReminderSummary(3)).toBe(true)
    expect(context.showReminderToast).toHaveBeenCalledTimes(suppressed ? 0 : 3)
    expect(context.markReminderHistoryEntryRead).not.toHaveBeenCalled()
  })

  it('keeps normal native submissions on their existing path and marks read only on click', async () => {
    const context = makeContext(false, true)
    await context.fireEventReminder({ title: '测试', startDate: '2026-09-17', isAllDay: true }, 'key')
    expect(context.isSystemNotificationSuppressed).not.toHaveBeenCalled()
    expect(context.showReminderToast).not.toHaveBeenCalled()
    expect(context.markReminderHistoryEntryRead).not.toHaveBeenCalled()
    context.deliverNativeReminder.mock.calls[0][1]()
    expect(context.markReminderHistoryEntryRead).toHaveBeenCalledWith(null, 'key')
  })
})

describe('Mac permission QA fixture reaches the real due-time filter', () => {
  const qa = readFileSync('scripts/electron-macos-reminder-qa.cjs', 'utf8')
  const fixture = qa.slice(qa.indexOf('  const deniedAt = '), qa.indexOf('  const mutation = '))
  const { collectDueReminders, eventStartMillis } = require('../electron/reminder-reliability.cjs')
  it.each([[10,12,30], [10,12,59], [23,59,1], [23,59,57]])('schedules after the checkpoint at %s:%s:%s, including midnight', (hour, minute, second) => {
    const checkpoint = new Date(2026,8,17,hour,minute,second).getTime()
    class ClockDate extends Date { static now() { return checkpoint } }
    const event = vm.runInNewContext(fixture+'; deniedEvent', {
      Date:ClockDate, event:{startDate:'2026-09-17',startTime:'09:00',isAllDay:false,reminder:{enabled:true,minutesBefore:0}},
    })
    const dueAt = eventStartMillis(event)
    expect(dueAt-checkpoint).toBeGreaterThanOrEqual(5000)
    expect(dueAt-checkpoint).toBeLessThan(65000)
    const options = {events:[event],fired:{},catchUpStartMs:checkpoint,getStartMillis:eventStartMillis}
    expect(collectDueReminders({...options,nowMs:dueAt-1})).toHaveLength(0)
    expect(collectDueReminders({...options,nowMs:dueAt})).toHaveLength(1)
  })
})
