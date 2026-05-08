import { useState, useEffect, useCallback } from 'react'
import type { AllSettings, PerWindowSettings } from '@/types/electron'

type WindowType = 'calendar' | 'notes'

const perWindowDefaults: PerWindowSettings = {
  fontFamily: 'Inter',
  fontSize: 14,
  backgroundColor: '#08111F',
  backgroundOpacity: 0.88,
  textColor: '#EAF2FF',
}

/** Merge loaded settings with defaults to ensure all fields exist */
function mergeWithDefaults(raw: Record<string, unknown> | null | undefined): PerWindowSettings {
  return {
    fontFamily: typeof raw?.fontFamily === 'string' ? raw.fontFamily : perWindowDefaults.fontFamily,
    fontSize: typeof raw?.fontSize === 'number' ? raw.fontSize : perWindowDefaults.fontSize,
    backgroundColor: typeof raw?.backgroundColor === 'string' ? raw.backgroundColor : perWindowDefaults.backgroundColor,
    backgroundOpacity: typeof raw?.backgroundOpacity === 'number' ? raw.backgroundOpacity : perWindowDefaults.backgroundOpacity,
    textColor: typeof raw?.textColor === 'string' ? raw.textColor : perWindowDefaults.textColor,
    ...(raw?.edgeAutoHide !== undefined ? { edgeAutoHide: !!raw.edgeAutoHide } : {}),
  }
}

export function useAppSettings(windowType: WindowType) {
  const [settings, setSettings] = useState<PerWindowSettings>(perWindowDefaults)
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getSettings().then((all: AllSettings) => {
        setThemeMode(all.themeMode || 'dark')
        setSettings(mergeWithDefaults(all[windowType] as unknown as Record<string, unknown> | undefined))
        setLoaded(true)
      }).catch((err: Error) => {
        console.error('useAppSettings: getSettings failed:', err.message)
        setLoaded(true)
      })

      const cleanup = window.electronAPI.onSettingsChanged((all: AllSettings) => {
        setThemeMode(all.themeMode || 'dark')
        setSettings(mergeWithDefaults(all[windowType] as unknown as Record<string, unknown> | undefined))
      })

      return cleanup
    } else {
      setLoaded(true)
    }
  }, [windowType])

  const updateSetting = useCallback((key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting(windowType, key, value)
    }
  }, [windowType])

  const updateThemeMode = useCallback((mode: 'dark' | 'light') => {
    setThemeMode(mode)
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('theme', 'themeMode', mode)
    }
  }, [])

  return { settings, themeMode, loaded, updateSetting, updateThemeMode }
}
