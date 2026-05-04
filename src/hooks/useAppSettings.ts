import { useState, useEffect, useCallback } from 'react'
import type { AllSettings, PerWindowSettings } from '@/types/electron'

type WindowType = 'calendar' | 'notes'

const perWindowDefaults: PerWindowSettings = {
  fontFamily: 'Inter',
  fontSize: 14,
  backgroundColor: '#0d0d10',
  backgroundOpacity: 0.88,
  textColor: '#e2e8f0',
}

export function useAppSettings(windowType: WindowType) {
  const [settings, setSettings] = useState<PerWindowSettings>(perWindowDefaults)
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getSettings().then((all: AllSettings) => {
        setThemeMode(all.themeMode)
        setSettings(all[windowType] || perWindowDefaults)
        setLoaded(true)
      }).catch((err: Error) => {
        console.error('useAppSettings: getSettings failed:', err.message)
        setLoaded(true)
      })

      const cleanup = window.electronAPI.onSettingsChanged((all: AllSettings) => {
        setThemeMode(all.themeMode)
        setSettings(all[windowType] || perWindowDefaults)
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
