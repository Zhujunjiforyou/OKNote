import { useEffect, useState } from 'react'
import type { SystemNotificationSettings } from '@/types/electron'

export function notificationSettingsMessage(settings: SystemNotificationSettings | null) {
  const location = '系统设置 → 通知 → OKNote'
  if (!settings || settings.authorization === 'unknown') return `暂时无法读取通知设置。请到“${location}”检查，切回此窗口会重新读取。`
  if (settings.authorization === 'denied') return `已在 macOS 中关闭通知。如需提醒，请到“${location}”开启。`
  if (settings.authorization === 'not-determined') return '尚未授权。首次发送系统提醒时，macOS 会询问是否允许通知。'
  if (settings.authorization === 'provisional') return `当前为安静递送，不显示横幅。如需横幅，请到“${location}”调整。`
  if (settings.alerts === 'disabled' || settings.alertStyle === 'none') return `已允许通知，但横幅或提醒样式已关闭。可到“${location}”调整。`
  return '已允许系统通知。专注模式等系统设置仍可能隐藏横幅。'
}

export function SystemNotificationStatus({ explainHistory = false }: { explainHistory?: boolean }) {
  const [settings, setSettings] = useState<SystemNotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const isMac = window.electronAPI?.platform === 'darwin'

  useEffect(() => {
    const api = window.electronAPI
    if (!isMac || !api) return
    let active = true
    let request = 0
    const refresh = async () => {
      const current = ++request
      let value: SystemNotificationSettings | null = null
      try { value = await api.getNotificationSettings() } catch { /* Report an unknown state, not permission denial. */ }
      if (active && current === request) {
        setSettings(value)
        setLoading(false)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
    }
  }, [isMac])

  if (!isMac) return null
  return (
    <div className="min-w-0 py-2 text-sm leading-relaxed" data-notification-status role="status">
      <p className="font-medium">系统通知</p>
      <p className="mt-1 break-words">{loading ? '正在读取 macOS 通知设置…' : notificationSettingsMessage(settings)}</p>
      {explainHistory && <p className="mt-2 break-words">记录表示提醒已触发，不代表系统横幅已显示。打开提醒或手动标记后，记录才会变为已读。</p>}
    </div>
  )
}
