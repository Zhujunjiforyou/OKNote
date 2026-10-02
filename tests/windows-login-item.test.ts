import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { setWindowsLoginItem } = require('../electron/login-item-state.cjs')
const { loginItemOptions } = require('../electron/platform.cjs')
const mainSource = readFileSync(path.join(process.cwd(), 'electron/main.cjs'), 'utf8')
const canonicalName = 'com.oknote.app'
const legacyName = 'electron.app.OKNote'
const executable = 'C:\\Apps\\OKNote\\OKNote.exe'

type LaunchItem = { name: string; path: string; args: string[]; scope: string; enabled: boolean }
type WriteOptions = { name: string; path?: string; args?: string[]; enabled?: boolean; openAtLogin: boolean }
const item = (name = canonicalName, overrides: Partial<LaunchItem> = {}): LaunchItem => ({
  name, path: executable, args: [], scope: 'user', enabled: true, ...overrides,
})
const samePath = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

// Model Electron's per-name writes and path-filtered launchItems without touching
// the real account's Run or StartupApproved registry keys.
function registryApp(initial: LaunchItem[] = [], acceptWrites = true) {
  let entries = initial.map(entry => ({ ...entry, args: [...entry.args] }))
  const app = {
    getLoginItemSettings: vi.fn((options: { path: string; args?: string[] }) => {
      const queryPath = options.path.replace(/^"|"$/g, '')
      return {
        // A named registry entry must be verified through launchItems rather
        // than relying on Electron's current AppUserModelId lookup.
        openAtLogin: false,
        launchItems: entries.filter(entry => samePath(entry.path, queryPath)).map(entry => ({ ...entry, args: [...entry.args] })),
      }
    }),
    setLoginItemSettings: vi.fn((options: WriteOptions) => {
      if (!acceptWrites) return
      entries = entries.filter(entry => !(entry.scope === 'user' && entry.name === options.name))
      if (options.openAtLogin) entries.push(item(options.name, {
        path: options.path || executable, args: options.args || [], enabled: options.enabled !== false,
      }))
    }),
  }
  return { app, entries: () => entries }
}

describe('Windows login item migration and approval', () => {
  it('creates one stable registration and is idempotent on later startup', () => {
    const h = registryApp()
    const settings = { autoLaunch: true, startMinimized: false }
    expect(setWindowsLoginItem(h.app, settings, false, executable)).toMatchObject({ ok: true, enabled: true, startMinimized: false })
    expect(h.app.setLoginItemSettings).toHaveBeenCalledOnce()
    expect(h.app.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({
      name: canonicalName, path: executable, args: [], openAtLogin: true, enabled: true,
    }))
    h.app.setLoginItemSettings.mockClear()
    expect(setWindowsLoginItem(h.app, settings, false, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(h.entries()).toHaveLength(1)
  })

  it('creates and verifies the canonical entry before deleting the matching legacy entry', () => {
    const h = registryApp([item(legacyName)])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: true }, false, executable)).toMatchObject({
      ok: true, enabled: true, startMinimized: true,
    })
    expect(h.app.setLoginItemSettings.mock.calls.map(([options]) => [options.name, options.openAtLogin])).toEqual([
      [canonicalName, true], [legacyName, false],
    ])
    const canonicalWrite = h.app.setLoginItemSettings.mock.invocationCallOrder[0]
    const legacyDelete = h.app.setLoginItemSettings.mock.invocationCallOrder[1]
    expect(h.app.getLoginItemSettings.mock.invocationCallOrder.some(order => order > canonicalWrite && order < legacyDelete)).toBe(true)
    expect(h.entries()).toEqual([item(canonicalName, { args: ['--hidden'] })])
  })

  it('removes an old duplicate without rewriting an already correct canonical registration', () => {
    const h = registryApp([item(), item(legacyName)])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.app.setLoginItemSettings).toHaveBeenCalledOnce()
    expect(h.app.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ name: legacyName, openAtLogin: false }))
    expect(h.entries()).toEqual([item()])
  })

  it('keeps the legacy registration when Windows does not accept the canonical write', () => {
    const h = registryApp([item(legacyName)], false)
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, executable)).toMatchObject({ ok: false, enabled: false })
    expect(h.app.setLoginItemSettings.mock.calls.some(([options]) => options.name === legacyName && !options.openAtLogin)).toBe(false)
    expect(h.entries()).toEqual([item(legacyName)])
  })

  it('changes normal and hidden startup in both directions without creating another entry', () => {
    const h = registryApp([item()])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: true }, false, executable)).toMatchObject({ ok: true, enabled: true, startMinimized: true })
    expect(h.entries()).toEqual([item(canonicalName, { args: ['--hidden'] })])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, executable)).toMatchObject({ ok: true, enabled: true, startMinimized: false })
    expect(h.entries()).toEqual([item()])
    expect(h.app.setLoginItemSettings.mock.calls.every(([options]) => options.name === canonicalName)).toBe(true)
  })

  it('reports a rejected hidden-argument update without deleting the legacy fallback', () => {
    const h = registryApp([item(), item(legacyName)], false)
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: true }, false, executable)).toMatchObject({ ok: false, enabled: false, startMinimized: true })
    expect(h.entries()).toHaveLength(2)
    expect(h.app.setLoginItemSettings.mock.calls.some(([options]) => options.name === legacyName)).toBe(false)
  })

  it('removes both owned registrations when automatic startup is turned off', () => {
    const h = registryApp([item(canonicalName, { args: ['--hidden'] }), item(legacyName)])
    expect(setWindowsLoginItem(h.app, { autoLaunch: false, startMinimized: true }, false, executable)).toMatchObject({
      ok: true, enabled: false, startMinimized: true,
    })
    expect(h.entries()).toEqual([])
    expect(h.app.setLoginItemSettings.mock.calls.map(([options]) => [options.name, options.openAtLogin])).toEqual([
      [canonicalName, false], [legacyName, false],
    ])
  })

  it.each([{ args: [] }, { args: ['--hidden'] }])('reports removal failure regardless of the residual canonical arguments: %j', ({ args }) => {
    const h = registryApp([item(canonicalName, { args })], false)
    expect(setWindowsLoginItem(h.app, { autoLaunch: false, startMinimized: false }, false, executable)).toMatchObject({ ok: false, enabled: true })
    expect(h.entries()).toEqual([item(canonicalName, { args })])
  })

  it('reports an uncleared legacy duplicate after creating a verified canonical registration', () => {
    const h = registryApp([item(legacyName)])
    const write = h.app.setLoginItemSettings.getMockImplementation()!
    h.app.setLoginItemSettings.mockImplementation(options => {
      if (options.name === legacyName && !options.openAtLogin) return
      write(options)
    })
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, executable)).toMatchObject({ ok: false, enabled: true })
    expect(h.entries().map(entry => entry.name)).toEqual([legacyName, canonicalName])
  })

  it('does not rewrite or revive a canonical entry disabled in Windows settings', () => {
    const h = registryApp([item(canonicalName, { enabled: false })])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(h.entries()[0].enabled).toBe(false)
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: true }, false, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.entries()).toEqual([item(canonicalName, { enabled: false, args: ['--hidden'] })])
    expect(h.app.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ name: canonicalName, enabled: false }))
  })

  it('preserves the disabled legacy approval during migration', () => {
    const h = registryApp([item(legacyName, { enabled: false })])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.entries()).toEqual([item(canonicalName, { enabled: false })])
  })

  it('gives canonical approval precedence over an enabled legacy duplicate', () => {
    const h = registryApp([item(canonicalName, { enabled: false }), item(legacyName)])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: true }, false, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.entries()).toEqual([item(canonicalName, { enabled: false, args: ['--hidden'] })])
  })

  it.each([canonicalName, legacyName])('explicitly enabling startup re-enables a disabled %s entry', name => {
    const h = registryApp([item(name, { enabled: false })])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, true, executable)).toMatchObject({ ok: true, enabled: true })
    expect(h.entries()).toEqual([item()])
    expect(h.app.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ name: canonicalName, enabled: true }))
  })

  it('rejects an explicit enable when Windows keeps StartupApproved disabled and preserves the legacy fallback', () => {
    const h = registryApp([item(canonicalName, { enabled: false }), item(legacyName)], false)
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, true, executable)).toMatchObject({ ok: false, enabled: true })
    expect(h.app.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ name: canonicalName, enabled: true }))
    expect(h.app.setLoginItemSettings.mock.calls.some(([options]) => options.name === legacyName)).toBe(false)
    expect(h.entries()[0].enabled).toBe(false)
  })

  it('quotes a spaced executable query and matches Windows path casing', () => {
    const installedPath = 'C:\\Program Files\\OKNote\\OKNote.exe'
    const h = registryApp([item(legacyName, { path: installedPath.toUpperCase() })])
    expect(setWindowsLoginItem(h.app, { autoLaunch: true, startMinimized: false }, false, installedPath)).toMatchObject({ ok: true, enabled: true })
    expect(h.app.getLoginItemSettings.mock.calls.every(([options]) => options.path === `"${installedPath}"`)).toBe(true)
    expect(h.entries()).toEqual([item(canonicalName, { path: installedPath })])
  })

  it.each([true, false])('leaves unrelated names, paths and machine entries untouched (autoLaunch=%s)', autoLaunch => {
    const unrelated = [
      item(legacyName, { path: 'D:\\Other installation\\OKNote.exe' }),
      item(legacyName, { scope: 'machine' }),
      item('electron.app.Electron'),
      item('AnotherApp'),
    ]
    const h = registryApp([item(), ...unrelated])
    expect(setWindowsLoginItem(h.app, { autoLaunch, startMinimized: false }, false, executable)).toMatchObject({ ok: true, enabled: autoLaunch })
    expect(h.entries()).toEqual(autoLaunch ? [item(), ...unrelated] : unrelated)
    expect(h.app.setLoginItemSettings.mock.calls.every(([options]) => options.name === canonicalName)).toBe(true)
  })
})

function mainLoginHarness({ platform = 'win32', packaged = true, isolated = false } = {}) {
  const settings = { autoLaunch: true, startMinimized: true }
  const app = { isPackaged: packaged, getLoginItemSettings: vi.fn(), setLoginItemSettings: vi.fn() }
  const setWindowsLoginItemMock = vi.fn(() => ({ ok: true, enabled: true, startMinimized: true }))
  const setMacLoginItem = vi.fn(() => ({ ok: true, enabled: true }))
  const fn = vm.runInNewContext(
    mainSource.slice(mainSource.indexOf('function applyLoginItemSettings('), mainSource.indexOf('function getLoginItemSnapshot(')) + '; applyLoginItemSettings',
    {
      app, appSettings: settings, isIsolatedTestInstance: isolated, process: { platform, execPath: executable },
      setWindowsLoginItem: setWindowsLoginItemMock, setMacLoginItem, loginItemOptions,
      console: { error: vi.fn() },
    },
  )
  return { fn, app, settings, setWindowsLoginItemMock, setMacLoginItem }
}

describe('main-process login item isolation', () => {
  it.each([
    { packaged: false, isolated: false },
    { packaged: true, isolated: true },
    { packaged: false, isolated: true },
  ])('does not touch Windows startup registrations in development or isolated verification: %o', options => {
    const h = mainLoginHarness(options)
    expect(h.fn(true)).toMatchObject({ ok: true, enabled: true, startMinimized: true })
    expect(h.app.getLoginItemSettings).not.toHaveBeenCalled()
    expect(h.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(h.setWindowsLoginItemMock).not.toHaveBeenCalled()
    expect(h.setMacLoginItem).not.toHaveBeenCalled()
  })

  it('uses the Windows helper and forwards explicit enable intent in a packaged build', () => {
    const h = mainLoginHarness()
    expect(h.fn(true)).toMatchObject({ ok: true, enabled: true, startMinimized: true })
    expect(h.setWindowsLoginItemMock.mock.calls[0].slice(0, 3)).toEqual([h.app, h.settings, true])
    expect(h.setMacLoginItem).not.toHaveBeenCalled()
  })

  it('keeps ordinary packaged startup distinct from an explicit enable action', () => {
    const h = mainLoginHarness()
    h.fn()
    expect(h.setWindowsLoginItemMock.mock.calls[0].slice(0, 3)).toEqual([h.app, h.settings, false])
  })

  it('preserves the existing macOS login-item path even for an unpackaged preview', () => {
    const h = mainLoginHarness({ platform: 'darwin', packaged: false })
    expect(h.fn()).toMatchObject({ ok: true, enabled: true, startMinimized: true })
    expect(h.setMacLoginItem).toHaveBeenCalledWith(h.app, true)
    expect(h.setWindowsLoginItemMock).not.toHaveBeenCalled()
  })
})
