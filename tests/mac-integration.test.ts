import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { macLoginItemState, setMacLoginItem } = require('../electron/login-item-state.cjs')
const { createCalendarPresentation } = require('../electron/calendar-presentation.cjs')

describe('macOS login approval', () => {
  it('preserves an accepted registration awaiting approval without writing it again', () => {
    const app = {getLoginItemSettings:vi.fn(() => ({openAtLogin:false,status:'requires-approval'})), setLoginItemSettings:vi.fn()}
    expect(setMacLoginItem(app, true)).toMatchObject({ok:true, enabled:true, pending:true, status:'requires-approval'})
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(macLoginItemState(app.getLoginItemSettings()).message).toContain('系统设置')
  })
  it('reports approval pending on a new registration and permits explicit removal', () => {
    const app = {getLoginItemSettings:vi.fn().mockReturnValueOnce({openAtLogin:false,status:'not-registered'}).mockReturnValue({openAtLogin:false,status:'requires-approval'}), setLoginItemSettings:vi.fn()}
    expect(setMacLoginItem(app,true)).toMatchObject({ok:true,pending:true})
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({openAtLogin:true})
    app.getLoginItemSettings.mockReturnValueOnce({status:'requires-approval'}).mockReturnValue({openAtLogin:false,status:'not-registered'})
    expect(setMacLoginItem(app,false)).toMatchObject({ok:true,enabled:false,pending:false})
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({openAtLogin:false})
  })
  it('reports a missing service as failure and supports macOS 12 without status', () => {
    const app = {getLoginItemSettings:vi.fn(() => ({openAtLogin:false,status:'not-found'})), setLoginItemSettings:vi.fn()}
    expect(setMacLoginItem(app,true)).toMatchObject({ok:false,enabled:false,pending:false})
    expect(macLoginItemState({openAtLogin:true})).toMatchObject({enabled:true,status:'enabled'})
  })
})

describe('explicit calendar presentation', () => {
  const makeWindow = () => Object.assign(new EventEmitter(), {isDestroyed:() => false,isMinimized:() => false,isVisible:() => true,isFocused:() => true,restore:vi.fn(),show:vi.fn(),hide:vi.fn(),moveTop:vi.fn(),focus:vi.fn()})
  const makeApp = () => Object.assign(new EventEmitter(), {isActive:vi.fn(() => true),isHidden:vi.fn(() => false),focus:vi.fn()})
  const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))
  it.each(['hide','closed','minimize'])('returns to the desktop on application hide, close or minimize (%s)', event => {
    const configure = vi.fn()
    const app = makeApp()
    const presentation = createCalendarPresentation(configure, app, 'darwin')
    const win = makeWindow()
    presentation.present(win)
    presentation.present(win)
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenCalledWith(win,{relativeLevel:0})
    expect(win.moveTop).toHaveBeenCalled()
    if (event === 'hide') app.isHidden.mockReturnValue(true)
    win.emit(event)
    expect(configure).toHaveBeenLastCalledWith(win)
    expect(win.listenerCount('blur')).toBe(0)
    expect(win.listenerCount('hide')).toBe(0)
    expect(win.listenerCount('closed')).toBe(0)
    expect(win.listenerCount('minimize')).toBe(0)
    expect(app.listenerCount('did-resign-active')).toBe(0)
  })
  it('preserves Dock presentation through the reported macOS occlusion hide/focus sequence', async () => {
    const configure = vi.fn()
    const app = makeApp()
    const win = makeWindow()
    const settings = makeWindow()
    const presentation = createCalendarPresentation(configure, app, 'darwin')
    // Returned trace: activate -> settings hide -> calendar hide -> calendar
    // focus -> settings show. The app is active and not explicitly hidden.
    app.on('activate', () => presentation.present(win))
    app.emit('activate')
    settings.emit('hide')
    win.emit('hide')
    win.emit('focus')
    settings.emit('show')
    await nextTurn()
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenLastCalledWith(win,{relativeLevel:0})
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.moveTop).toHaveBeenCalledOnce()
    app.isActive.mockReturnValue(false)
    app.emit('did-resign-active')
    await nextTurn()
    expect(configure).toHaveBeenLastCalledWith(win)
  })
  it.each(['darwin','win32'])('explicit tray hiding still dismisses the calendar on %s', platform => {
    const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const configure = vi.fn()
    const win = makeWindow()
    const calendarPresentation = createCalendarPresentation(configure, makeApp(), platform)
    calendarPresentation.present(win)
    const restore = vi.spyOn(calendarPresentation, 'restore')
    const stopEdgePolling = vi.fn()
    const showCalendar = vi.fn()
    const toggle = vm.runInNewContext(source.slice(source.indexOf('function toggleCalendar('), source.indexOf('function dispatchCalendarAction('))+'; toggleCalendar', {
      process:{platform},winRegistry:{calendar:win},calendarPresentation,stopEdgePolling,showCalendar,
    })
    toggle()
    expect(restore).toHaveBeenCalledOnce()
    expect(restore.mock.invocationCallOrder[0]).toBeLessThan(win.hide.mock.invocationCallOrder[0])
    expect(win.hide).toHaveBeenCalledOnce()
    expect(stopEdgePolling).toHaveBeenCalledOnce()
    expect(showCalendar).not.toHaveBeenCalled()
    if (platform === 'darwin') expect(configure).toHaveBeenLastCalledWith(win)
    else expect(configure).not.toHaveBeenCalled()
  })
  it('keeps the calendar in front across transient blur and focus on another OKNote panel', async () => {
    const configure = vi.fn()
    const app = makeApp()
    const win = makeWindow()
    const note = makeWindow()
    const presentation = createCalendarPresentation(configure, app, 'darwin')
    presentation.present(win)
    win.emit('blur')
    note.focus()
    win.emit('focus')
    await nextTurn()
    expect(configure).toHaveBeenCalledTimes(1)
    expect(configure).toHaveBeenLastCalledWith(win,{relativeLevel:0})
    expect(app.focus).not.toHaveBeenCalled()
    presentation.restore()
  })
  it.each(['darwin','win32'])('requests application activation only for opted-in Mac presentation (%s)', platform => {
    const app = makeApp()
    const win = makeWindow()
    const presentation = createCalendarPresentation(vi.fn(), app, platform)
    presentation.present(win, {activateApp:true})
    if (platform === 'darwin') {
      expect(app.focus).toHaveBeenCalledWith({steal:true})
      expect(app.focus.mock.invocationCallOrder[0]).toBeLessThan(win.moveTop.mock.invocationCallOrder[0])
      expect(app.focus.mock.invocationCallOrder[0]).toBeLessThan(win.focus.mock.invocationCallOrder[0])
    } else expect(app.focus).not.toHaveBeenCalled()
    presentation.restore()
  })
  it.each(['darwin','win32'].flatMap(platform => ['新建事件','提醒记录','显示/隐藏日历'].map(command => ({platform,command}))))('routes the real $command tray callback on $platform', ({platform,command}) => {
    const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const app = makeApp()
    app.isActive.mockReturnValue(false)
    const win = Object.assign(makeWindow(), {webContents:{isLoading:() => false,send:vi.fn()}})
    win.isFocused = () => false
    const calendarPresentation = createCalendarPresentation(vi.fn(), app, platform)
    // A hidden window exercises the show branch on both platforms.
    if (command === '显示/隐藏日历') win.isVisible = () => false
    let menu: any
    class Tray {
      setToolTip() {}
      setContextMenu(value: any) { menu = value }
      on() {}
    }
    vm.runInNewContext(source.slice(source.indexOf('function createTray(){'), source.indexOf('// ── Widget factory'))
      + source.slice(source.indexOf('function showCalendar('), source.indexOf('function openEventEditorInCalendar('))+'; createTray()', {
      process:{platform},tray:null,Tray,Menu:{buildFromTemplate:(items: any[]) => ({items})},createTrayIcon:() => '',
      winRegistry:{calendar:win},calendarPresentation,ensureWindowVisible:vi.fn(),checkEdgeAutoHide:vi.fn(),stopEdgePolling:vi.fn(),
      isCalendarCollapsed:false,setTimeout:(callback:() => void) => callback(),
    })
    menu.items.find((item: any) => item.label === command).click()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    if (platform === 'darwin') expect(app.focus).toHaveBeenCalledWith({steal:true})
    else expect(app.focus).not.toHaveBeenCalled()
    if (command === '新建事件') expect(win.webContents.send).toHaveBeenCalledWith('action','new-event')
    else if (command === '提醒记录') expect(win.webContents.send).toHaveBeenCalledWith('action','show-reminders')
    else expect(win.webContents.send).not.toHaveBeenCalled()
    calendarPresentation.restore()
  })
  it('returns to the desktop when the application actually loses focus', async () => {
    const configure = vi.fn()
    const app = makeApp()
    const win = makeWindow()
    createCalendarPresentation(configure, app, 'darwin').present(win)
    app.isActive.mockReturnValue(false)
    app.emit('did-resign-active')
    await nextTurn()
    expect(configure).toHaveBeenLastCalledWith(win)
    expect(app.listenerCount('did-resign-active')).toBe(0)
  })
  it('does not lower the calendar if native activation completes before the deferred check', async () => {
    const configure = vi.fn()
    const app = makeApp()
    const win = makeWindow()
    const presentation = createCalendarPresentation(configure, app, 'darwin')
    presentation.present(win)
    app.isActive.mockReturnValue(false)
    app.emit('did-resign-active')
    app.isActive.mockReturnValue(true)
    app.emit('did-become-active')
    await nextTurn()
    expect(configure).toHaveBeenCalledTimes(1)
    presentation.restore()
  })
  it('cancels stale deactivation work when explicitly reopened or closed', async () => {
    const configure = vi.fn()
    const app = makeApp()
    const win = makeWindow()
    const presentation = createCalendarPresentation(configure, app, 'darwin')
    presentation.present(win)
    app.isActive.mockReturnValue(false)
    app.emit('did-resign-active')
    presentation.present(win)
    await nextTurn()
    expect(configure).toHaveBeenCalledTimes(1)
    app.emit('did-resign-active')
    win.isDestroyed = () => true
    win.emit('closed')
    await nextTurn()
    expect(configure).toHaveBeenCalledTimes(1)
    expect(app.listenerCount('did-resign-active')).toBe(0)
  })
  it('preserves the Windows window policy', () => {
    const configure = vi.fn()
    const win = makeWindow()
    const app = makeApp()
    createCalendarPresentation(configure, app, 'win32').present(win)
    expect(configure).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(app.isActive).not.toHaveBeenCalled()
    expect(app.listenerCount('did-resign-active')).toBe(0)
  })
})

describe('settings window platform policy', () => {
  const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  const functions = source.slice(source.indexOf('function createWidget('), source.indexOf('function intersectionArea('))
    + source.slice(source.indexOf('function createSettingsWindow('), source.indexOf('// ── Tidy'))
  const setup = (platform: string) => {
    class Window extends EventEmitter {
      constructor(public options: Record<string, any>) { super() }
      isDestroyed = () => false
      setAlwaysOnTop = vi.fn()
      showInactive = vi.fn()
      show = vi.fn()
      moveTop = vi.fn()
      focus = vi.fn(() => this.emit('focus'))
      loadURL = vi.fn()
    }
    const configureDesktopWindow = vi.fn()
    const broadcastSettings = vi.fn()
    const api = vm.runInNewContext(functions+'; ({createWidget,createSettingsWindow})', {
      process:{platform}, BrowserWindow:Window, path, APP_NAME:'OKNote', ICONS_DIR:'icons', __dirname:'electron',
      configureDesktopWindow, broadcastSettings, hardenWebContents:vi.fn(), attachDraftCloseGuard:vi.fn(),
      winRegistry:{settings:null}, makeWidgetURL:(route: string) => route,
    })
    return { ...api, configureDesktopWindow, broadcastSettings }
  }
  it('opens and reopens Mac settings as an input-capable nonactivating panel at normal level', () => {
    const api = setup('darwin')
    const settings = api.createSettingsWindow()
    expect(settings.options).toMatchObject({type:'panel',show:false,acceptFirstMouse:true})
    expect(api.configureDesktopWindow).toHaveBeenCalledWith(settings,{relativeLevel:0})
    expect(settings.showInactive).toHaveBeenCalledOnce()
    settings.emit('ready-to-show')
    expect(settings.focus).toHaveBeenCalledOnce()
    expect(api.broadcastSettings).toHaveBeenCalledOnce()
    expect(api.createSettingsWindow()).toBe(settings)
    expect(settings.focus).toHaveBeenCalledTimes(2)
    expect(settings.moveTop).toHaveBeenCalledTimes(2)
    expect(settings.setAlwaysOnTop).not.toHaveBeenCalled()
    const desktop = api.createWidget({desktop:true})
    expect(api.configureDesktopWindow).toHaveBeenLastCalledWith(desktop,{relativeLevel:-1})
    expect(desktop.options.webPreferences.backgroundThrottling).toBe(false)
  })
  it('retains Windows settings creation and reopen behavior', () => {
    const api = setup('win32')
    const settings = api.createSettingsWindow()
    expect(settings.options.type).toBeUndefined()
    expect(settings.options.show).toBeUndefined()
    expect(settings.setAlwaysOnTop).toHaveBeenCalledWith(true,'pop-up-menu')
    expect(api.createSettingsWindow()).toBe(settings)
    expect(settings.show).toHaveBeenCalledOnce()
    expect(settings.focus).toHaveBeenCalledOnce()
    expect(api.configureDesktopWindow).not.toHaveBeenCalled()
  })
})
