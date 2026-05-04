import { useState, useEffect, useMemo } from 'react'
import { X, Sun, Moon, Globe, CalendarDays, StickyNote, ListTodo, Trash2, Eye } from 'lucide-react'
import { isLightColor } from '@/lib/utils'

type SettingsTab = 'global' | 'calendar' | 'notes' | 'manage'

const DARK_PRESET = { backgroundColor: '#0d0d10', textColor: '#e2e8f0' }
const LIGHT_PRESET = { backgroundColor: '#ffffff', textColor: '#1a1a2e' }

interface PerWinSettings {
  fontFamily: string; fontSize: number; backgroundColor: string; backgroundOpacity: number; textColor: string
}

// ── Reusable settings panel (for calendar/notes tabs) ──
function AppearancePanel({
  settings, systemFonts, onUpdate, textColor,
}: {
  settings: PerWinSettings
  systemFonts: string[]
  onUpdate: (key: string, value: unknown) => void
  textColor: string
}) {
  const [fontSearch, setFontSearch] = useState('')
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false)

  const filteredFonts = useMemo(() => {
    if (!fontSearch) return systemFonts
    const q = fontSearch.toLowerCase()
    return systemFonts.filter((f) => f.toLowerCase().includes(q)).slice(0, 100)
  }, [systemFonts, fontSearch])

  const applyFont = (fontName: string) => {
    onUpdate('fontFamily', fontName)
    setFontSearch('')
    setFontDropdownOpen(false)
  }

  const bgHex = settings.backgroundColor.replace('#', '')
  const bgWithAlpha = `#${bgHex}ee`
  const dark = !isLightColor(settings.backgroundColor)
  const hoverBg = dark ? 'hover:bg-white/5' : 'hover:bg-black/5'
  const labelO = dark ? 0.25 : 0.5
  const mutedO = dark ? 0.5 : 0.65

  return (
    <div className="space-y-4">
      {/* Font */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>字体</label>
        <div className="relative">
          <input
            type="text"
            value={fontSearch}
            onChange={(e) => { setFontSearch(e.target.value); setFontDropdownOpen(true) }}
            onFocus={() => setFontDropdownOpen(true)}
            onBlur={() => setTimeout(() => setFontDropdownOpen(false), 200)}
            placeholder={settings.fontFamily || '搜索或输入字体名称...'}
            className="w-full bg-white/3 border rounded-md px-2.5 py-1.5 text-[12px] outline-none transition-all"
            style={{ borderColor: `${textColor}10`, color: textColor }}
          />
          {fontDropdownOpen && filteredFonts.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-auto rounded-md border shadow-2xl z-30 backdrop-blur-xl"
              style={{ background: `${settings.backgroundColor}ee`, borderColor: `${textColor}10` }}
            >
              {filteredFonts.map((f) => (
                <button
                  key={f}
                  onMouseDown={() => applyFont(f)}
                  className={`w-full text-left px-2.5 py-1.5 text-[12px] ${hoverBg} transition-colors truncate`}
                  style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Font size */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>字号 <span style={{ opacity: mutedO }} className="font-normal">{settings.fontSize}px</span></label>
        <div className="flex items-center gap-2">
          <input type="range" min="10" max="48" step="1" value={settings.fontSize}
            onChange={(e) => onUpdate('fontSize', parseInt(e.target.value))}
            className="flex-1 accent-blue-500 h-1" />
          <span className="text-[12px] tabular-nums w-9 text-right opacity-50">{settings.fontSize}px</span>
        </div>
      </div>

      {/* Background color */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>背景色</label>
        <div className="flex items-center gap-2">
          <input type="color" value={settings.backgroundColor}
            onChange={(e) => onUpdate('backgroundColor', e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
          <input type="text" value={settings.backgroundColor}
            onChange={(e) => onUpdate('backgroundColor', e.target.value)}
            className="flex-1 bg-white/3 border rounded-md px-2.5 py-1.5 text-[11px] outline-none font-mono transition-all"
            style={{ borderColor: `${textColor}10`, color: textColor }} />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest opacity-25 mb-1.5 block">不透明度 <span className="opacity-50 font-normal">{Math.round(settings.backgroundOpacity * 100)}%</span></label>
        <div className="flex items-center gap-2">
          <input type="range" min="10" max="100" step="5" value={Math.round(settings.backgroundOpacity * 100)}
            onChange={(e) => onUpdate('backgroundOpacity', parseInt(e.target.value) / 100)}
            className="flex-1 accent-blue-500 h-1" />
          <span className="text-[12px] tabular-nums w-9 text-right opacity-50">{Math.round(settings.backgroundOpacity * 100)}%</span>
        </div>
      </div>

      {/* Text color */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest opacity-25 mb-1.5 block">文字色</label>
        <div className="flex items-center gap-2">
          <input type="color" value={settings.textColor}
            onChange={(e) => onUpdate('textColor', e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
          <input type="text" value={settings.textColor}
            onChange={(e) => onUpdate('textColor', e.target.value)}
            className="flex-1 bg-white/3 border rounded-md px-2.5 py-1.5 text-[11px] outline-none font-mono transition-all"
            style={{ borderColor: `${textColor}10`, color: textColor }} />
        </div>
      </div>

      {/* Preview */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>预览</label>
        <div
          className="rounded-lg border p-3 flex flex-col gap-1.5"
          style={{
            backgroundColor: bgWithAlpha,
            borderColor: `${textColor}10`,
            color: textColor,
            fontFamily: `"${settings.fontFamily}", system-ui, sans-serif`,
            fontSize: settings.fontSize + 'px',
          }}
        >
          <div className="font-medium opacity-80" style={{ fontSize: settings.fontSize + 'px' }}>预览标题</div>
          <div className="opacity-35" style={{ fontSize: (settings.fontSize * 0.9) + 'px' }}>展示当前字体、颜色和字号的真实效果</div>
          <div className="flex gap-1.5 mt-0.5">
            <span className="px-1.5 py-0.5 rounded text-blue-400/80" style={{ fontSize: (settings.fontSize * 0.8) + 'px', backgroundColor: '#3b82f615' }}>标签A</span>
            <span className="px-1.5 py-0.5 rounded text-green-400/80" style={{ fontSize: (settings.fontSize * 0.8) + 'px', backgroundColor: '#22c55e15' }}>标签B</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Global font panel (in global tab) ──
function GlobalFontPanel({
  globalFontFamily, globalFontSize, systemFonts, onUpdateGlobalFont, onUpdateGlobalFontSize,
  isDark, textColor,
}: {
  globalFontFamily: string
  globalFontSize: number
  systemFonts: string[]
  onUpdateGlobalFont: (family: string) => void
  onUpdateGlobalFontSize: (size: number) => void
  isDark: boolean
  textColor: string
}) {
  const [fontSearch, setFontSearch] = useState('')
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false)

  const filteredFonts = useMemo(() => {
    if (!fontSearch) return systemFonts
    const q = fontSearch.toLowerCase()
    return systemFonts.filter((f) => f.toLowerCase().includes(q)).slice(0, 100)
  }, [systemFonts, fontSearch])

  const bgColor = isDark ? '#0d0d10' : '#ffffff'
  const borderColor = isDark ? '#ffffff10' : '#00000010'
  const labelO = isDark ? 0.25 : 0.5
  const mutedO = isDark ? 0.5 : 0.65
  const subtleO = isDark ? 0.3 : 0.45

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>全局字体</label>
        <div className="relative">
          <input
            type="text"
            value={fontSearch}
            onChange={(e) => { setFontSearch(e.target.value); setFontDropdownOpen(true) }}
            onFocus={() => setFontDropdownOpen(true)}
            onBlur={() => setTimeout(() => setFontDropdownOpen(false), 200)}
            placeholder={globalFontFamily || '搜索或输入字体名称...'}
            className="w-full bg-white/3 border rounded-md px-2.5 py-1.5 text-[12px] outline-none transition-all"
            style={{ borderColor, color: textColor }}
          />
          {fontDropdownOpen && filteredFonts.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-auto rounded-md border shadow-2xl z-30 backdrop-blur-xl"
              style={{ background: `${bgColor}ee`, borderColor }}
            >
              {filteredFonts.map((f) => (
                <button
                  key={f}
                  onMouseDown={() => { onUpdateGlobalFont(f); setFontSearch(''); setFontDropdownOpen(false) }}
                  className={`w-full text-left px-2.5 py-1.5 text-[12px] ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'} transition-colors truncate`}
                  style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[10px] mt-1" style={{ opacity: subtleO }}>此字体将同时应用于日历和所有便签</p>
      </div>

      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest opacity-25 mb-1.5 block">全局字号 <span className="opacity-50 font-normal">{globalFontSize}px</span></label>
        <div className="flex items-center gap-2">
          <input type="range" min="10" max="48" step="1" value={globalFontSize}
            onChange={(e) => onUpdateGlobalFontSize(parseInt(e.target.value))}
            className="flex-1 accent-blue-500 h-1" />
          <span className="text-[12px] tabular-nums w-9 text-right opacity-50">{globalFontSize}px</span>
        </div>
        <p className="text-[10px] mt-1" style={{ opacity: subtleO }}>此字号将同时应用于日历和所有便签</p>
      </div>
    </div>
  )
}

export function SettingsWindow() {
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark')
  const [globalFontFamily, setGlobalFontFamily] = useState('Microsoft YaHei')
  const [globalFontSize, setGlobalFontSize] = useState(14)
  const [calendarSettings, setCalendarSettings] = useState<PerWinSettings>({ fontFamily: 'Inter', fontSize: 14, backgroundColor: '#0d0d10', backgroundOpacity: 0.88, textColor: '#e2e8f0' })
  const [notesSettings, setNotesSettings] = useState<PerWinSettings>({ fontFamily: 'Inter', fontSize: 14, backgroundColor: '#0d0d10', backgroundOpacity: 0.88, textColor: '#e2e8f0' })
  const [loaded, setLoaded] = useState(false)
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<SettingsTab>('global')
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const dirtyRef = { current: false }
  const [manageNotes, setManageNotes] = useState<Array<{ id: string; title: string; color: string; createdAt: string; isVisible: boolean }>>([])
  const [manageLoading, setManageLoading] = useState(false)

  // Load settings + fonts
  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getSettings().then((all) => {
        setThemeMode(all.themeMode)
        setAutoLaunch(all.autoLaunch ?? false)
        setGlobalFontFamily(all.globalFontFamily || 'Microsoft YaHei')
        setGlobalFontSize(all.globalFontSize || 14)
        setCalendarSettings(all.calendar)
        setNotesSettings(all.notes)
        setLoaded(true)
      })
      window.electronAPI.getSystemFonts().then((fonts) => {
        setSystemFonts(fonts)
        setFontsLoaded(true)
      }).catch((e) => {
        console.error('getSystemFonts failed:', e)
        setFontsLoaded(true)
      })

      return window.electronAPI.onSettingsChanged((all) => {
        // Don't overwrite if user is currently editing
        if (dirtyRef.current) return
        setThemeMode(all.themeMode)
        setAutoLaunch(all.autoLaunch ?? false)
        setGlobalFontFamily(all.globalFontFamily || 'Microsoft YaHei')
        setGlobalFontSize(all.globalFontSize || 14)
        setCalendarSettings(all.calendar)
        setNotesSettings(all.notes)
      })
    } else {
      setLoaded(true)
      setFontsLoaded(true)
    }
  }, [])

  // Apply theme to window
  useEffect(() => {
    document.documentElement.classList.toggle('light', themeMode === 'light')
    document.documentElement.classList.add('electron-transparent')
  }, [themeMode])

  // Load notes for manage tab
  const loadManageNotes = async () => {
    if (!window.electronAPI?.isElectron) return
    setManageLoading(true)
    try {
      const files = await window.electronAPI.listAppData('note_')
      if (!files || files.length === 0) {
        setManageNotes([])
        setManageLoading(false)
        return
      }
      let visibleIds: string[] = []
      try {
        visibleIds = await window.electronAPI.getVisibleNoteIds()
      } catch (_) {
        // ignore
      }
      const notes: Array<{ id: string; title: string; color: string; createdAt: string; isVisible: boolean }> = []
      for (const f of files) {
        const rawKey = f.replace('.json', '')
        let data: unknown = null
        try {
          data = await window.electronAPI.loadAppData(rawKey)
        } catch (_) {
          continue
        }
        if (data && typeof data === 'object' && 'id' in data) {
          const noteId = String((data as Record<string, unknown>).id || rawKey.replace('note_', ''))
          notes.push({
            id: noteId,
            title: String((data as Record<string, unknown>).title || '未命名'),
            color: String((data as Record<string, unknown>).color || '#888888'),
            createdAt: String((data as Record<string, unknown>).createdAt || ''),
            isVisible: visibleIds.includes(noteId),
          })
        } else {
          // skip malformed data
          continue
        }
      }
      notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setManageNotes(notes)
    } catch (e) {
      console.error('loadManageNotes failed:', e)
    } finally {
      setManageLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'manage') {
      loadManageNotes()
    }
  }, [activeTab])

  const handleThemeChange = (mode: 'dark' | 'light') => {
    const preset = mode === 'dark' ? DARK_PRESET : LIGHT_PRESET
    setThemeMode(mode)
    setCalendarSettings((prev) => ({ ...prev, backgroundColor: preset.backgroundColor, textColor: preset.textColor }))
    setNotesSettings((prev) => ({ ...prev, backgroundColor: preset.backgroundColor, textColor: preset.textColor }))
    dirtyRef.current = true
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('theme', 'themeMode', mode)
      window.electronAPI.setSetting('calendar', 'backgroundColor', preset.backgroundColor)
      window.electronAPI.setSetting('calendar', 'textColor', preset.textColor)
      window.electronAPI.setSetting('notes', 'backgroundColor', preset.backgroundColor)
      window.electronAPI.setSetting('notes', 'textColor', preset.textColor)
    }
  }

  const handleCalendarUpdate = (key: string, value: unknown) => {
    setCalendarSettings((prev) => ({ ...prev, [key]: value }))
    dirtyRef.current = true
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('calendar', key, value)
    }
  }

  const handleNotesUpdate = (key: string, value: unknown) => {
    setNotesSettings((prev) => ({ ...prev, [key]: value }))
    dirtyRef.current = true
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('notes', key, value)
    }
  }

  const handleGlobalFont = (fontName: string) => {
    setGlobalFontFamily(fontName)
    setCalendarSettings((prev) => ({ ...prev, fontFamily: fontName }))
    setNotesSettings((prev) => ({ ...prev, fontFamily: fontName }))
    dirtyRef.current = true
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('global', 'globalFontFamily', fontName)
      window.electronAPI.setSetting('calendar', 'fontFamily', fontName)
      window.electronAPI.setSetting('notes', 'fontFamily', fontName)
    }
  }

  const handleGlobalFontSize = (size: number) => {
    setGlobalFontSize(size)
    setCalendarSettings((prev) => ({ ...prev, fontSize: size }))
    setNotesSettings((prev) => ({ ...prev, fontSize: size }))
    dirtyRef.current = true
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('global', 'globalFontSize', size)
      window.electronAPI.setSetting('calendar', 'fontSize', size)
      window.electronAPI.setSetting('notes', 'fontSize', size)
    }
  }

  if (!loaded) {
    return <div className="h-screen w-screen flex items-center justify-center text-xs opacity-20 select-none">...</div>
  }

  const isDark = themeMode === 'dark'
  const bgHex = isDark ? '#0d0d10' : '#ffffff'
  const textColor = isDark ? '#e2e8f0' : '#1a1a2e'
  // Dynamic opacities: light bg needs higher opacity for readability
  const labelO = isDark ? 0.25 : 0.5
  const mutedO = isDark ? 0.6 : 0.75
  const subtleO = isDark ? 0.3 : 0.45
  const toggleOffBg = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'
  const dividerColor = isDark ? `${textColor}08` : `${textColor}0a`
  const tabActiveBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px', color: textColor }}
    >
      {/* Background */}
      <div className="absolute inset-0" style={{ backgroundColor: `${bgHex}ee` }} />

      {/* Title bar */}
      <div
        className="relative flex items-center justify-between px-4 py-2.5 shrink-0 border-b"
        style={{ WebkitAppRegion: 'drag', borderColor: `${textColor}08` } as React.CSSProperties}
      >
        <span className="text-xs font-medium tracking-wide" style={{ opacity: mutedO }}>设置</span>
        <button
          onClick={() => window.electronAPI?.closeWindow()}
          className="w-5 h-5 rounded flex items-center justify-center hover:opacity-80 hover:text-red-400 transition-all"
          style={{ WebkitAppRegion: 'no-drag', opacity: subtleO } as React.CSSProperties}
        >
          <X size={12} />
        </button>
      </div>

      {/* Tab switcher */}
      <div className="relative flex shrink-0 px-4 pt-3 gap-1">
        {([
          ['global', Globe, '全局'],
          ['calendar', CalendarDays, '日历'],
          ['notes', StickyNote, '便签'],
          ['manage', ListTodo, '便签管理'],
        ] as const).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all"
            style={{
              backgroundColor: activeTab === tab ? tabActiveBg : 'transparent',
              opacity: activeTab === tab ? 0.9 : subtleO,
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-auto p-4">
        {activeTab === 'global' && (
          <div className="space-y-5">
            {/* Theme */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest mb-2 block" style={{ opacity: labelO }}>主题风格</label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleThemeChange('dark')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs transition-all"
                  style={{
                    background: isDark ? `${textColor}10` : 'transparent',
                    opacity: isDark ? 0.9 : 0.4,
                  }}
                >
                  <Moon size={12} /> 暗色
                </button>
                <button
                  onClick={() => handleThemeChange('light')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs transition-all"
                  style={{
                    background: !isDark ? `${textColor}10` : 'transparent',
                    opacity: !isDark ? 0.9 : 0.4,
                  }}
                >
                  <Sun size={12} /> 亮色
                </button>
              </div>
            </div>

            <hr style={{ borderColor: dividerColor }} />

            {/* Auto-launch */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest opacity-25 mb-2 block">系统</label>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs opacity-60">开机自动启动</span>
                <button
                  onClick={() => {
                    const next = !autoLaunch
                    setAutoLaunch(next)
                    dirtyRef.current = true
                    window.electronAPI?.setAutoLaunch(next)
                  }}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    autoLaunch ? 'bg-blue-500' : ''
                  }`}
                  style={autoLaunch ? undefined : { backgroundColor: toggleOffBg }}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      autoLaunch ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            <hr style={{ borderColor: dividerColor }} />

            {/* Global font & fontSize */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest opacity-25 mb-3 block">全局字体设置</label>
              <GlobalFontPanel
                globalFontFamily={globalFontFamily}
                globalFontSize={globalFontSize}
                systemFonts={systemFonts}
                onUpdateGlobalFont={handleGlobalFont}
                onUpdateGlobalFontSize={handleGlobalFontSize}
                isDark={isDark}
                textColor={textColor}
              />
            </div>

            {!fontsLoaded && (
              <div className="text-xs opacity-30">正在加载系统字体列表...</div>
            )}

            <hr style={{ borderColor: dividerColor }} />

            <div className="rounded-lg border p-4 text-[11px] leading-relaxed" style={{ borderColor: `${textColor}08`, opacity: isDark ? 0.5 : 0.65 }}>
              主题风格和全局字体设置会应用于日历和所有便签窗口。
              <br />你可以在「日历」或「便签」标签页中覆盖各自的字体、字号、背景色和不透明度。
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <AppearancePanel settings={calendarSettings} systemFonts={systemFonts} onUpdate={handleCalendarUpdate} textColor={textColor} />
        )}

        {activeTab === 'notes' && (
          <AppearancePanel settings={notesSettings} systemFonts={systemFonts} onUpdate={handleNotesUpdate} textColor={textColor} />
        )}

        {activeTab === 'manage' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] opacity-40">管理已保存的便签（包括已隐藏的便签）</p>
              <button
                onClick={loadManageNotes}
                className="text-xs opacity-30 hover:opacity-70 transition-opacity px-2 py-0.5 rounded border"
                style={{ borderColor: `${textColor}10` }}
              >
                刷新
              </button>
            </div>

            {manageLoading ? (
              <div className="text-xs opacity-20 py-8 text-center">加载中...</div>
            ) : manageNotes.length === 0 ? (
              <div className="text-xs opacity-20 py-8 text-center">暂无已保存的便签</div>
            ) : (
              <div className="space-y-2">
                {manageNotes.map((note) => (
                  <div
                    key={note.id}
                    className="flex items-center gap-3 rounded-lg border p-3 transition-all"
                    style={{ borderColor: `${textColor}08` }}
                  >
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: note.isVisible ? '#22c55e' : note.color, opacity: note.isVisible ? 0.8 : 0.6 }}
                      title={note.isVisible ? '可见' : '隐藏'}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: note.color }}>
                        {note.title}
                      </div>
                      <div className="text-[10px] opacity-25 mt-0.5">
                        {note.createdAt ? new Date(note.createdAt).toLocaleDateString('zh-CN') : '未知日期'}
                        <span className="ml-2 px-1 py-0.5 rounded text-[9px]" style={{
                          backgroundColor: note.isVisible ? '#22c55e15' : '#88888810',
                          color: note.isVisible ? '#22c55e' : '#888888',
                        }}>
                          {note.isVisible ? '可见' : '隐藏'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={async () => {
                          await window.electronAPI?.showNote(note.id)
                          setTimeout(loadManageNotes, 300)
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] opacity-40 hover:opacity-90 transition-all hover:bg-white/5"
                        title="显示便签"
                      >
                        <Eye size={11} />
                        显示
                      </button>
                      <button
                        onClick={async () => {
                          await window.electronAPI?.deleteNote(note.id)
                          loadManageNotes()
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-red-400/40 hover:text-red-400 hover:bg-red-500/5 transition-all"
                        title="永久删除"
                      >
                        <Trash2 size={11} />
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
