import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { clampFontSize } from '../src/lib/typography'

const require = createRequire(import.meta.url)
const { clampFontSetting, safeFontFamily, normalizeWindowSettings, sanitizeSettingChange } = require('../electron/settings-rules.cjs') as {
  clampFontSetting: (value: unknown) => number
  safeFontFamily: (value: unknown, fallback?: string) => string | undefined
  normalizeWindowSettings: (raw: unknown, fallback: Record<string, unknown>, includeEdgeAutoHide?: boolean) => Record<string, unknown>
  sanitizeSettingChange: (scope: string, key: string, value: unknown) => unknown
}

const defaults = Object.freeze({
  fontFamily: 'Inter', fontSize: 14, backgroundColor: '#1C1C1E',
  backgroundOpacity: 0.88, textColor: '#F5F5F7',
})

describe('settings rules without Electron side effects', () => {
  it('preserves font size bounds, fallback and renderer parity', () => {
    for (const value of [-100, 0, 9, 10, 14, 25.5, 60, 61, 100, NaN, Infinity, -Infinity]) {
      expect(clampFontSetting(value)).toBe(clampFontSize(value))
    }
    expect(clampFontSetting('24')).toBe(24)
    expect(clampFontSetting('invalid')).toBe(14)
    expect(clampFontSetting(undefined)).toBe(14)
    expect(clampFontSetting(null)).toBe(10)
    expect(clampFontSetting('')).toBe(10)
  })

  it('trims font names but keeps the existing 120-character input limit', () => {
    expect(safeFontFamily('  微软雅黑  ', 'Inter')).toBe('微软雅黑')
    expect(safeFontFamily('a'.repeat(120), 'Inter')).toBe('a'.repeat(120))
    for (const value of [null, undefined, [], {}, 14, '', '  ', 'a'.repeat(121), ` ${'a'.repeat(120)}`]) {
      expect(safeFontFamily(value, 'Inter')).toBe('Inter')
      expect(safeFontFamily(value)).toBeUndefined()
    }
  })

  it('normalizes missing and legacy window settings with unchanged defaults', () => {
    for (const raw of [undefined, null, [], 'legacy', 12, {}]) {
      expect(normalizeWindowSettings(raw, defaults)).toEqual(defaults)
      expect(normalizeWindowSettings(raw, defaults, true)).toEqual({
        ...defaults, edgeAutoHide: true, showDockArea: true,
      })
    }
    // Font size has always used 14 for missing input, not the supplied fallback.
    expect(normalizeWindowSettings({}, { ...defaults, fontSize: 32 }).fontSize).toBe(14)
  })

  it('preserves valid custom appearance values without mutating input or defaults', () => {
    const raw = Object.freeze({
      fontFamily: ' Arial ', fontSize: 22, backgroundColor: '#aAbBcc',
      backgroundOpacity: 0.45, textColor: '#123456',
      edgeAutoHide: false, showDockArea: false, unrelated: 'ignored',
    })
    const expected = {
      fontFamily: 'Arial', fontSize: 22, backgroundColor: '#aAbBcc',
      backgroundOpacity: 0.45, textColor: '#123456',
    }
    expect(normalizeWindowSettings(raw, defaults)).toEqual(expected)
    expect(normalizeWindowSettings(raw, defaults, true)).toEqual({
      ...expected, edgeAutoHide: false, showDockArea: false,
    })
    expect(raw.fontFamily).toBe(' Arial ')
    expect(defaults.fontSize).toBe(14)
  })

  it('falls back for invalid stored colors and opacity without changing custom fallbacks', () => {
    const fallback = { ...defaults, backgroundColor: '#123456', textColor: '#abcdef', backgroundOpacity: 0.65 }
    expect(normalizeWindowSettings({ backgroundColor: '#fff', textColor: 'red', backgroundOpacity: 'bad' }, fallback)).toEqual(fallback)
    for (const [value, expected] of [[0, 0.1], [2, 1], ['0.7', 0.7], [null, 0.1]] as const) {
      expect(normalizeWindowSettings({ backgroundOpacity: value }, defaults).backgroundOpacity).toBe(expected)
    }
  })

  it('accepts only explicit theme modes and known scope/key combinations', () => {
    expect(sanitizeSettingChange('theme', 'themeMode', 'dark')).toBe('dark')
    expect(sanitizeSettingChange('theme', 'themeMode', 'light')).toBe('light')
    expect(sanitizeSettingChange('theme', 'themeMode', 'system')).toBeUndefined()
    for (const [scope, key] of [
      ['unknown', 'fontSize'], ['global', 'autoLaunch'], ['global', 'fontSize'],
      ['notes', 'edgeAutoHide'], ['notes', 'showDockArea'], ['calendar', 'themeMode'],
      ['calendar', '__proto__'], ['theme', 'backgroundColor'],
    ]) {
      expect(sanitizeSettingChange(scope, key, true)).toBeUndefined()
    }
  })

  it('uses the same font rules for global and individual window changes', () => {
    for (const [scope, familyKey, sizeKey] of [
      ['global', 'globalFontFamily', 'globalFontSize'],
      ['calendar', 'fontFamily', 'fontSize'], ['notes', 'fontFamily', 'fontSize'],
    ]) {
      expect(sanitizeSettingChange(scope, familyKey, ' Arial ')).toBe('Arial')
      expect(sanitizeSettingChange(scope, familyKey, '  ')).toBeUndefined()
      expect(sanitizeSettingChange(scope, sizeKey, 100)).toBe(60)
      expect(sanitizeSettingChange(scope, sizeKey, 'bad')).toBe(14)
    }
  })

  it('rejects invalid IPC colors rather than applying load-time fallback colors', () => {
    for (const scope of ['calendar', 'notes']) {
      for (const key of ['backgroundColor', 'textColor']) {
        expect(sanitizeSettingChange(scope, key, '#aAbBcc')).toBe('#aAbBcc')
        for (const value of ['#fff', '#12345678', ' #123456', 'red', null, {}]) {
          expect(sanitizeSettingChange(scope, key, value)).toBeUndefined()
        }
      }
    }
  })

  it('clamps finite IPC opacity but rejects non-finite input', () => {
    for (const scope of ['calendar', 'notes']) {
      expect(sanitizeSettingChange(scope, 'backgroundOpacity', -1)).toBe(0.1)
      expect(sanitizeSettingChange(scope, 'backgroundOpacity', 2)).toBe(1)
      expect(sanitizeSettingChange(scope, 'backgroundOpacity', '0.75')).toBe(0.75)
      expect(sanitizeSettingChange(scope, 'backgroundOpacity', null)).toBe(0.1)
      for (const value of [undefined, 'bad', NaN, Infinity, -Infinity]) {
        expect(sanitizeSettingChange(scope, 'backgroundOpacity', value)).toBeUndefined()
      }
    }
  })

  it('preserves legacy boolean coercion differences between load and IPC paths', () => {
    for (const value of [false, true, 0, 1, '', 'false', null, undefined]) {
      for (const key of ['startMinimized', 'hideNotificationContent']) {
        expect(sanitizeSettingChange('global', key, value)).toBe(value === true)
      }
      for (const key of ['edgeAutoHide', 'showDockArea']) {
        expect(sanitizeSettingChange('calendar', key, value)).toBe(Boolean(value))
        expect(normalizeWindowSettings({ [key]: value }, defaults, true)[key]).toBe(value !== false)
      }
    }
  })
})
