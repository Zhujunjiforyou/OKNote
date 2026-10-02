import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { defaultFont, fallbackFonts, fontQuery, parseFontNames, loginItemOptions, shouldStartHidden, macMenuTemplate } = require('../electron/platform.cjs')

describe('desktop platform integration', () => {
  it('uses macOS font families and never invokes PowerShell on macOS', () => {
    expect(defaultFont('darwin')).toBe('PingFang SC')
    expect(defaultFont('win32')).toBe('Microsoft YaHei')
    expect(fallbackFonts('darwin')).not.toContain('SimSun')
    expect(fontQuery('darwin')).toEqual({ file: '/usr/sbin/system_profiler', args: ['SPFontsDataType', '-json'] })
    expect(fontQuery('win32').file).toBe('powershell.exe')
  })

  it('extracts deduplicated font families instead of file or PostScript face names', () => {
    const data = { SPFontsDataType: [{ _name: 'PingFang.ttc', path: '/System/Library/Fonts/PingFang.ttc', typefaces: [
      { _name: 'PingFangSC-Regular', family: 'PingFang SC' },
      { _name: 'PingFangSC-Bold', family: 'PingFang SC' },
    ] }] }
    expect(parseFontNames(JSON.stringify(data), 'darwin')).toEqual(['PingFang SC'])
    expect(parseFontNames('Arial\r\nMicrosoft YaHei', 'win32')).toEqual(['Arial', 'Microsoft YaHei'])
    expect(() => parseFontNames('{broken', 'darwin')).toThrow()
  })

  it('omits private macOS families while preserving public, localized and custom fonts', () => {
    const families = ['.Arial Hebrew Desk Interface', ' .SF NS ', 'Arial', 'Arial Hebrew', '苹方-简', 'My.Custom Font']
    const data = { SPFontsDataType: [{ typefaces: families.map(family => ({ family })) }, { family_name: '.LastResort' }] }
    expect(parseFontNames(JSON.stringify(data), 'darwin')).toEqual(['Arial', 'Arial Hebrew', '苹方-简', 'My.Custom Font'])
    expect(parseFontNames('.Custom Windows Family\nArial', 'win32')).toEqual(['.Custom Windows Family', 'Arial'])
  })

  it('recognizes private Mac families wrapped in bidi controls without rewriting public names', () => {
    const families = ['\u202d.\u202cArial Hebrew Desk Interface', '\u2066 .SF NS\u2069', '\u200f.LastResort', 'Arial', '\u2067خط مخصص\u2069', 'My.Custom Font']
    const data = { SPFontsDataType: families.map(family_name => ({ family_name })) }
    expect(parseFontNames(JSON.stringify(data), 'darwin')).toEqual(families.slice(3))
    expect(parseFontNames(families.join('\n'), 'win32')).toEqual(families)
  })

  it('registers Windows executable arguments, but does not pass them to macOS login items', () => {
    const settings = { autoLaunch: true, startMinimized: true }
    expect(loginItemOptions(settings, 'win32', 'C:\\Apps\\OKNote.exe')).toEqual({ openAtLogin: true, name: 'com.oknote.app', path: 'C:\\Apps\\OKNote.exe', args: ['--hidden'] })
    expect(loginItemOptions(settings, 'darwin', '/Applications/OKNote.app')).toEqual({ openAtLogin: true })
    expect(loginItemOptions({ ...settings, autoLaunch: false }, 'win32', 'app').args).toEqual([])
  })

  it('hides only a login launch when requested, while explicit app launches still show the calendar', () => {
    expect(shouldStartHidden({ startMinimized: true }, { wasOpenedAtLogin: true }, [], 'darwin')).toBe(true)
    expect(shouldStartHidden({ startMinimized: true }, { wasOpenedAtLogin: false }, [], 'darwin')).toBe(false)
    expect(shouldStartHidden({ startMinimized: false }, { wasOpenedAtLogin: true }, [], 'darwin')).toBe(false)
    expect(shouldStartHidden({}, null, ['--hidden'], 'win32')).toBe(true)
  })

  it('provides native edit roles and routes Command+Q through the unsaved-draft guard', () => {
    const actions = { settings: vi.fn(), quit: vi.fn(), calendar: vi.fn(), daily: vi.fn() }
    const menu = macMenuTemplate(actions)
    expect(menu.find((item: {label:string}) => item.label === '编辑').submenu.map((item: { role: string }) => item.role)).toEqual(expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']))
    menu[0].submenu.find((item: { accelerator: string }) => item.accelerator === 'Command+Q').click()
    expect(actions.quit).toHaveBeenCalledOnce()
    expect(menu.find((item: {label:string}) => item.label === '文件').submenu).toContainEqual({role:'close',label:'关闭窗口',accelerator:'Command+W'})
  })
})
