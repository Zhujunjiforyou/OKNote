import { useState, useEffect, useId, useMemo, useRef } from 'react'
import { X, Sun, Moon, Globe, CalendarDays, StickyNote, ListTodo, Trash2, Eye, EyeOff, Tag, RotateCcw } from 'lucide-react'
import { APP_COLOR_PALETTE, contrastRatio, ensureReadableTextColor, generateId, isLightColor } from '@/lib/utils'
import { useTagStore } from '@/stores/tag.store'
import { reportPersistenceIssue } from '@/stores/persistence.store'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, clampFontSize, getAdaptiveDisplayFontSize } from '@/lib/typography'

type SettingsTab = 'global' | 'calendar' | 'notes' | 'manage' | 'tags'

const APPEARANCE_PRESETS = {
  dark: { backgroundColor: '#1C1C1E', textColor: '#F5F5F7' },
  light: { backgroundColor: '#F2F2F7', textColor: '#1D1D1F' },
} as const

const SETTINGS_TABS = [
  { id: 'global', icon: Globe, label: '通用', description: '主题、启动与全局字体' },
  { id: 'calendar', icon: CalendarDays, label: '日历', description: '日历外观与贴边行为' },
  { id: 'notes', icon: StickyNote, label: '便签', description: '便签字体与窗口外观' },
  { id: 'manage', icon: ListTodo, label: '便签管理', description: '显示、隐藏与清理便签' },
  { id: 'tags', icon: Tag, label: '标签管理', description: '维护事件分类标签' },
] as const

interface PerWinSettings {
  fontFamily: string; fontSize: number; backgroundColor: string; backgroundOpacity: number; textColor: string; edgeAutoHide?: boolean; showDockArea?: boolean
}

// ── Reusable settings panel (for calendar/notes tabs) ──
function AppearancePanel({
  settings, systemFonts, onUpdate, textColor, showColorControls = true,
}: {
  settings: PerWinSettings
  systemFonts: string[]
  onUpdate: (key: string, value: unknown) => void
  textColor: string
  showColorControls?: boolean
}) {
  const [fontSearch, setFontSearch] = useState('')
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false)
  const [activeFontIndex, setActiveFontIndex] = useState(0)
  const fontListId = useId()

  const filteredFonts = useMemo(() => {
    if (!fontSearch) return systemFonts
    const q = fontSearch.toLowerCase()
    return systemFonts.filter((f) => f.toLowerCase().includes(q))
  }, [systemFonts, fontSearch])

  useEffect(() => {
    if (!fontDropdownOpen) return
    document.getElementById(`${fontListId}-${activeFontIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeFontIndex, fontDropdownOpen, fontListId])

  const applyFont = (fontName: string) => {
    onUpdate('fontFamily', fontName)
    setFontSearch('')
    setFontDropdownOpen(false)
  }

  const handleFontKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setFontDropdownOpen(false)
      setFontSearch('')
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setFontDropdownOpen(true)
      if (filteredFonts.length === 0) return
      setActiveFontIndex((current) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return filteredFonts.length - 1
        return event.key === 'ArrowDown'
          ? (current + 1) % filteredFonts.length
          : (current - 1 + filteredFonts.length) % filteredFonts.length
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = fontDropdownOpen ? filteredFonts[activeFontIndex] : undefined
      const fontName = selected || fontSearch.trim()
      if (fontName) applyFont(fontName)
    }
  }

  const bgHex = settings.backgroundColor.replace('#', '')
  const bgWithAlpha = `#${bgHex}${Math.round(settings.backgroundOpacity * 255).toString(16).padStart(2, '0')}`
  const dark = isLightColor(textColor)
  const menuSurface = dark ? '#1C1C1E' : '#F2F2F7'
  const hoverBg = dark ? 'hover:bg-white/5' : 'hover:bg-black/5'
  const labelO = dark ? 0.62 : 0.72
  const mutedO = dark ? 0.7 : 0.78
  const requestedFontSize = clampFontSize(settings.fontSize)
  const previewFontSize = getAdaptiveDisplayFontSize(requestedFontSize)
  const configuredContrast = contrastRatio(settings.backgroundColor, settings.textColor)
  const previewTextColor = ensureReadableTextColor(settings.backgroundColor, settings.textColor)
  const adaptedFontLabel = previewFontSize === requestedFontSize
    ? `${requestedFontSize}px`
    : `${requestedFontSize} 档 · 显示 ${previewFontSize}px`

  return (
    <div className="space-y-4">
      {/* Font */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ opacity: labelO }}>字体</label>
          <span className="text-[10px] tabular-nums" style={{ opacity: mutedO }}>{systemFonts.length > 0 ? `系统字体 ${systemFonts.length} 种` : '字体加载中…'}</span>
        </div>
        <div className="relative">
          <input
            type="text"
            maxLength={120}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={fontListId}
            aria-activedescendant={fontDropdownOpen && filteredFonts[activeFontIndex] ? `${fontListId}-${activeFontIndex}` : undefined}
            aria-expanded={fontDropdownOpen}
            aria-label="窗口字体"
            value={fontDropdownOpen ? fontSearch : settings.fontFamily}
            onChange={(e) => { setFontSearch(e.target.value); setActiveFontIndex(0); setFontDropdownOpen(true) }}
            onFocus={(event) => {
              const input = event.currentTarget
              setFontSearch('')
              setFontDropdownOpen(true)
              window.requestAnimationFrame(() => input.select())
            }}
            onBlur={() => setTimeout(() => { setFontDropdownOpen(false); setFontSearch('') }, 200)}
            onKeyDown={handleFontKeyDown}
            placeholder={`当前：${settings.fontFamily || '默认字体'}；输入可搜索`}
            className="settings-input w-full rounded-lg border px-3 py-2 text-[12px] outline-none transition-colors"
            style={{ borderColor: `${textColor}10`, color: textColor }}
          />
          {fontDropdownOpen && filteredFonts.length > 0 && (
            <div
              id={fontListId}
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto overscroll-contain rounded-lg shadow-2xl"
              style={{ background: `${menuSurface}fa` }}
              role="listbox"
              aria-label="系统字体"
            >
              {filteredFonts.map((f, index) => (
                <button
                  key={f}
                  id={`${fontListId}-${index}`}
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveFontIndex(index)}
                  onMouseDown={(event) => { event.preventDefault(); applyFont(f) }}
                  className={`font-option min-h-8 w-full px-2.5 py-1.5 text-left text-[12px] leading-snug ${index === activeFontIndex ? (dark ? 'bg-white/8' : 'bg-black/8') : hoverBg} transition-colors`}
                  style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
                  title={f}
                  role="option"
                  aria-selected={f === settings.fontFamily}
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
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>字号 <span style={{ opacity: mutedO }} className="font-normal">{adaptedFontLabel}</span></label>
        <div className="flex items-center gap-2">
          <span className="w-4 text-[10px] tabular-nums opacity-45">{FONT_SIZE_MIN}</span>
          <input type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1" value={requestedFontSize}
            onChange={(e) => onUpdate('fontSize', parseInt(e.target.value))}
            aria-label="字号"
            className="settings-range flex-1" />
          <span className="w-5 text-right text-[10px] tabular-nums opacity-45">{FONT_SIZE_MAX}</span>
          <span className="text-[12px] tabular-nums w-10 text-right opacity-60">{requestedFontSize}</span>
        </div>
        <p className="mt-1 text-[10px]" style={{ opacity: mutedO }}>10–32 按实际像素显示；33–60 连续放大并自动切换大字布局。</p>
      </div>

      {showColorControls && (
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>背景色</label>
          <div className="flex items-center gap-2">
            <input type="color" value={settings.backgroundColor}
              onChange={(e) => onUpdate('backgroundColor', e.target.value)}
              aria-label="选择背景色"
              className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
            <input type="text" defaultValue={settings.backgroundColor} key={settings.backgroundColor}
              onBlur={(e) => {
                const value = e.currentTarget.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(value)) onUpdate('backgroundColor', value)
                else e.currentTarget.value = settings.backgroundColor
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              aria-label="背景色十六进制值"
              className="settings-input flex-1 rounded-lg border px-3 py-2 text-[11px] outline-none font-mono transition-colors"
              style={{ borderColor: `${textColor}10`, color: textColor }} />
          </div>
          {configuredContrast < 4.5 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-amber-500/85" role="status">
              当前文字与背景对比度为 {configuredContrast.toFixed(1)}:1；日历会自动改用高对比文字，避免内容看不清。
            </p>
          )}
        </div>
      )}

      {/* Opacity */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest opacity-45 mb-1.5 block">不透明度 <span className="opacity-60 font-normal">{Math.round(settings.backgroundOpacity * 100)}%</span></label>
        <div className="flex items-center gap-2">
          <input type="range" min="10" max="100" step="1" value={Math.round(settings.backgroundOpacity * 100)}
            onChange={(e) => onUpdate('backgroundOpacity', parseInt(e.target.value) / 100)}
            aria-label="不透明度"
            className="settings-range flex-1" />
          <span className="text-[12px] tabular-nums w-9 text-right opacity-50">{Math.round(settings.backgroundOpacity * 100)}%</span>
        </div>
      </div>

      {showColorControls && (
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-widest opacity-45 mb-1.5 block">文字色</label>
          <div className="flex items-center gap-2">
            <input type="color" value={settings.textColor}
              onChange={(e) => onUpdate('textColor', e.target.value)}
              aria-label="选择文字色"
              className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
            <input type="text" defaultValue={settings.textColor} key={settings.textColor}
              onBlur={(e) => {
                const value = e.currentTarget.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(value)) onUpdate('textColor', value)
                else e.currentTarget.value = settings.textColor
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              aria-label="文字色十六进制值"
              className="settings-input flex-1 rounded-lg border px-3 py-2 text-[11px] outline-none font-mono transition-colors"
              style={{ borderColor: `${textColor}10`, color: textColor }} />
          </div>
        </div>
      )}

      {showColorControls && <div>
        <label className="text-[11px] font-semibold uppercase tracking-widest mb-1.5 block" style={{ opacity: labelO }}>预览</label>
        <div
          className="settings-preview rounded-xl border p-3 flex flex-col gap-1.5 overflow-hidden"
          style={{
            backgroundColor: bgWithAlpha,
            borderColor: `${textColor}10`,
            color: previewTextColor,
            fontFamily: `"${settings.fontFamily}", system-ui, sans-serif`,
            fontSize: previewFontSize + 'px',
          }}
        >
          <div className="font-medium opacity-80" style={{ fontSize: previewFontSize + 'px' }}>预览标题</div>
          <div className="opacity-45" style={{ fontSize: (previewFontSize * 0.9) + 'px' }}>展示当前字体、颜色和适配后字号的真实效果</div>
          <div className="flex gap-1.5 mt-0.5">
            <span className="px-1.5 py-0.5 rounded text-sky-400/80" style={{ fontSize: (previewFontSize * 0.8) + 'px', backgroundColor: '#38bdf815' }}>标签A</span>
            <span className="px-1.5 py-0.5 rounded text-teal-400/80" style={{ fontSize: (previewFontSize * 0.8) + 'px', backgroundColor: '#2dd4bf15' }}>标签B</span>
          </div>
        </div>
      </div>}
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
  const [activeFontIndex, setActiveFontIndex] = useState(0)
  const fontListId = useId()

  const filteredFonts = useMemo(() => {
    if (!fontSearch) return systemFonts
    const q = fontSearch.toLowerCase()
    return systemFonts.filter((f) => f.toLowerCase().includes(q))
  }, [systemFonts, fontSearch])

  useEffect(() => {
    if (!fontDropdownOpen) return
    document.getElementById(`${fontListId}-${activeFontIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeFontIndex, fontDropdownOpen, fontListId])

  const bgColor = isDark ? '#1C1C1E' : '#F2F2F7'
  const borderColor = isDark ? '#ffffff10' : '#00000010'
  const labelO = isDark ? 0.62 : 0.72
  const mutedO = isDark ? 0.7 : 0.78
  const subtleO = isDark ? 0.62 : 0.7
  const requestedGlobalFontSize = clampFontSize(globalFontSize)
  const displayGlobalFontSize = getAdaptiveDisplayFontSize(requestedGlobalFontSize)
  const globalFontLabel = displayGlobalFontSize === requestedGlobalFontSize
    ? `${requestedGlobalFontSize}px`
    : `${requestedGlobalFontSize} 档 · 显示 ${displayGlobalFontSize}px`

  const applyGlobalFont = (fontName: string) => {
    onUpdateGlobalFont(fontName)
    setFontSearch('')
    setFontDropdownOpen(false)
  }

  const handleFontKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setFontDropdownOpen(false)
      setFontSearch('')
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setFontDropdownOpen(true)
      if (filteredFonts.length === 0) return
      setActiveFontIndex((current) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return filteredFonts.length - 1
        return event.key === 'ArrowDown'
          ? (current + 1) % filteredFonts.length
          : (current - 1 + filteredFonts.length) % filteredFonts.length
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = fontDropdownOpen ? filteredFonts[activeFontIndex] : undefined
      const fontName = selected || fontSearch.trim()
      if (fontName) applyGlobalFont(fontName)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ opacity: labelO }}>全局字体</label>
          <span className="text-[10px] tabular-nums" style={{ opacity: subtleO }}>{systemFonts.length > 0 ? `系统字体 ${systemFonts.length} 种` : '字体加载中…'}</span>
        </div>
        <div className="relative">
          <input
            type="text"
            maxLength={120}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={fontListId}
            aria-activedescendant={fontDropdownOpen && filteredFonts[activeFontIndex] ? `${fontListId}-${activeFontIndex}` : undefined}
            aria-expanded={fontDropdownOpen}
            aria-label="全局字体"
            value={fontDropdownOpen ? fontSearch : globalFontFamily}
            onChange={(e) => { setFontSearch(e.target.value); setActiveFontIndex(0); setFontDropdownOpen(true) }}
            onFocus={(event) => {
              const input = event.currentTarget
              setFontSearch('')
              setFontDropdownOpen(true)
              window.requestAnimationFrame(() => input.select())
            }}
            onBlur={() => setTimeout(() => { setFontDropdownOpen(false); setFontSearch('') }, 200)}
            onKeyDown={handleFontKeyDown}
            placeholder={`当前：${globalFontFamily || '默认字体'}；输入可搜索`}
            className="settings-input w-full rounded-lg border px-3 py-2 text-[12px] outline-none transition-colors"
            style={{ borderColor, color: textColor }}
          />
          {fontDropdownOpen && filteredFonts.length > 0 && (
            <div
              id={fontListId}
              className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto overscroll-contain rounded-lg shadow-2xl"
              style={{ background: `${bgColor}fa` }}
              role="listbox"
              aria-label="系统字体"
            >
              {filteredFonts.map((f, index) => (
                <button
                  key={f}
                  id={`${fontListId}-${index}`}
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveFontIndex(index)}
                  onMouseDown={(event) => { event.preventDefault(); applyGlobalFont(f) }}
                  className={`font-option min-h-8 w-full px-2.5 py-1.5 text-left text-[12px] leading-snug ${index === activeFontIndex ? (isDark ? 'bg-white/8' : 'bg-black/8') : (isDark ? 'hover:bg-white/5' : 'hover:bg-black/5')} transition-colors`}
                  style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
                  title={f}
                  role="option"
                  aria-selected={f === globalFontFamily}
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
        <label className="text-[11px] font-semibold uppercase tracking-widest opacity-45 mb-1.5 block">全局字号 <span className="opacity-60 font-normal">{globalFontLabel}</span></label>
        <div className="flex items-center gap-2">
          <span className="w-4 text-[10px] tabular-nums opacity-45">{FONT_SIZE_MIN}</span>
          <input type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1" value={requestedGlobalFontSize}
            onChange={(e) => onUpdateGlobalFontSize(parseInt(e.target.value))}
            aria-label="全局字号"
            className="settings-range flex-1" />
          <span className="w-5 text-right text-[10px] tabular-nums opacity-45">{FONT_SIZE_MAX}</span>
          <span className="text-[12px] tabular-nums w-10 text-right opacity-60">{requestedGlobalFontSize}</span>
        </div>
        <p className="text-[11px] mt-1" style={{ opacity: subtleO }}>日历与便签使用同一字号；大字号会连续放大并自动重排内容，不会等比撑大控件和留白。</p>
      </div>
    </div>
  )
}

export function SettingsWindow() {
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark')
  const [globalFontFamily, setGlobalFontFamily] = useState('Microsoft YaHei')
  const [globalFontSize, setGlobalFontSize] = useState(14)
  const [calendarSettings, setCalendarSettings] = useState<PerWinSettings>({ fontFamily: 'Inter', fontSize: 14, backgroundColor: '#1C1C1E', backgroundOpacity: 0.88, textColor: '#F5F5F7', edgeAutoHide: true, showDockArea: true })
  const [notesSettings, setNotesSettings] = useState<PerWinSettings>({ fontFamily: 'Inter', fontSize: 14, backgroundColor: '#1C1C1E', backgroundOpacity: 0.88, textColor: '#F5F5F7' })
  const [loaded, setLoaded] = useState(false)
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<SettingsTab>('global')
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  const [hideNotificationContent, setHideNotificationContent] = useState(false)
  const dirtyRef = useRef(false)
  const dirtyResetTimerRef = useRef<number | null>(null)
  const settingsContentRef = useRef<HTMLElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [manageNotes, setManageNotes] = useState<Array<{ id: string; title: string; color: string; createdAt: string; isVisible: boolean; isDocked: boolean; isHidden: boolean; noteType: 'independent' | 'echo' | 'view' | 'daily' }>>([])
  const [deletedNotes, setDeletedNotes] = useState<Array<{ trashId: string; noteId: string; title: string; color: string; deletedAt: string }>>([])
  const [manageLoading, setManageLoading] = useState(false)
  const [showTagForm, setShowTagForm] = useState(false)
  const [tagNameInput, setTagNameInput] = useState('')
  const [tagColorInput, setTagColorInput] = useState('#2563EB')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [tagDraftBaseline, setTagDraftBaseline] = useState('|#2563eb')
  const tagFormReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'delete-note'; id: string; title: string }
    | { type: 'delete-tag'; id: string; title: string }
    | { type: 'delete-trash'; id: string; title: string }
    | { type: 'discard-tag-form'; id: string; title: string }
    | null
  >(null)
  const tags = useTagStore((s) => s.tags)
  const addTag = useTagStore((s) => s.addTag)
  const updateTag = useTagStore((s) => s.updateTag)
  const deleteTag = useTagStore((s) => s.deleteTag)
  const tagFormDirty = showTagForm && `${tagNameInput}|${tagColorInput.toLowerCase()}` !== tagDraftBaseline

  const closeTagForm = () => {
    setShowTagForm(false)
    setEditingTagId(null)
    setTagNameInput('')
    setTagColorInput('#2563EB')
    setTagDraftBaseline('|#2563eb')
    window.requestAnimationFrame(() => tagFormReturnFocusRef.current?.focus())
  }

  const requestCloseTagForm = () => {
    if (tagFormDirty) {
      setPendingConfirm({ type: 'discard-tag-form', id: '', title: editingTagId ? '标签修改' : '新标签' })
      return
    }
    closeTagForm()
  }
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    window.electronAPI.setWindowDraftState(tagFormDirty ? ['tag-form'] : [])
  }, [tagFormDirty])

  useEffect(() => () => {
    window.electronAPI?.setWindowDraftState([])
  }, [])

  const markDirty = () => {
    dirtyRef.current = true
    if (dirtyResetTimerRef.current !== null) window.clearTimeout(dirtyResetTimerRef.current)
    dirtyResetTimerRef.current = window.setTimeout(() => {
      dirtyRef.current = false
      dirtyResetTimerRef.current = null
    }, 300)
  }

  // Load settings + fonts
  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getSettings().then((all) => {
        setThemeMode(all.themeMode)
        setAutoLaunch(all.autoLaunch ?? false)
        setStartMinimized(all.startMinimized ?? false)
        setHideNotificationContent(all.hideNotificationContent ?? false)
        setGlobalFontFamily(all.globalFontFamily || 'Microsoft YaHei')
        setGlobalFontSize(clampFontSize(all.globalFontSize || 14))
        setCalendarSettings({ ...all.calendar, fontSize: clampFontSize(all.calendar.fontSize) })
        setNotesSettings({ ...all.notes, fontSize: clampFontSize(all.notes.fontSize) })
        setLoaded(true)
      }).catch((error) => {
        console.error('getSettings failed:', error)
        setLoadError(true)
        setLoaded(true)
      })
      window.electronAPI.getSystemFonts().then((fonts) => {
        setSystemFonts(fonts)
        setFontsLoaded(true)
      }).catch((e) => {
        console.error('getSystemFonts failed:', e)
        setFontsLoaded(true)
      })
      const cleanupFonts = window.electronAPI.onSystemFontsChanged((fonts) => {
        setSystemFonts(fonts)
        setFontsLoaded(true)
      })
      const cleanupSettings = window.electronAPI.onSettingsChanged((all) => {
        // Don't overwrite if user is currently editing
        if (dirtyRef.current) return
        setThemeMode(all.themeMode)
        setAutoLaunch(all.autoLaunch ?? false)
        setStartMinimized(all.startMinimized ?? false)
        setHideNotificationContent(all.hideNotificationContent ?? false)
        setGlobalFontFamily(all.globalFontFamily || 'Microsoft YaHei')
        setGlobalFontSize(clampFontSize(all.globalFontSize || 14))
        setCalendarSettings({ ...all.calendar, fontSize: clampFontSize(all.calendar.fontSize) })
        setNotesSettings({ ...all.notes, fontSize: clampFontSize(all.notes.fontSize) })
      })

      // Load tags into settings window's store
      window.electronAPI.getTags().then((data) => {
        if (Array.isArray(data)) {
          useTagStore.getState().loadTags(data as import('@/types/tag.types').EventTag[])
        }
      })
      // Listen for tag changes from other windows
      const cleanupTags = window.electronAPI.onTagsChanged(() => {
        window.electronAPI!.getTags().then((data) => {
          if (Array.isArray(data)) {
            useTagStore.getState().loadTags(data as import('@/types/tag.types').EventTag[])
          }
        })
      })

      return () => {
        cleanupSettings()
        cleanupTags()
        cleanupFonts()
        if (dirtyResetTimerRef.current !== null) window.clearTimeout(dirtyResetTimerRef.current)
      }
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
  const loadManageNotes = async (silent = false) => {
    if (!window.electronAPI?.isElectron) return
    const previousScrollTop = settingsContentRef.current?.scrollTop ?? 0
    if (!silent) setManageLoading(true)
    try {
      const [notes, trash] = await Promise.all([
        window.electronAPI.getNoteSummaries(),
        window.electronAPI.listDeletedNotes(),
      ])
      setDeletedNotes(trash)
      if (!notes || notes.length === 0) {
        setManageNotes([])
        return
      }
      setManageNotes([...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    } catch (e) {
      console.error('loadManageNotes failed:', e)
    } finally {
      if (!silent) setManageLoading(false)
      if (silent) {
        window.requestAnimationFrame(() => {
          if (settingsContentRef.current) settingsContentRef.current.scrollTop = previousScrollTop
        })
      }
    }
  }

  useEffect(() => {
    if (activeTab === 'manage') {
      void loadManageNotes()
    }
  }, [activeTab])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onNotesChanged(() => {
      if (activeTab === 'manage') void loadManageNotes(true)
    })
  }, [activeTab])

  const handleThemeChange = (mode: 'dark' | 'light') => {
    const preset = APPEARANCE_PRESETS[mode]
    setThemeMode(mode)
    setCalendarSettings((prev) => ({ ...prev, ...preset }))
    markDirty()
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('theme', 'themeMode', mode)
    }
  }

  const handleCalendarUpdate = (key: string, value: unknown) => {
    const nextValue = key === 'fontSize' ? clampFontSize(Number(value)) : value
    setCalendarSettings((prev) => ({ ...prev, [key]: nextValue }))
    markDirty()
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('calendar', key, nextValue)
    }
  }

  const handleNotesUpdate = (key: string, value: unknown) => {
    const nextValue = key === 'fontSize' ? clampFontSize(Number(value)) : value
    setNotesSettings((prev) => ({ ...prev, [key]: nextValue }))
    markDirty()
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('notes', key, nextValue)
    }
  }

  const handleGlobalFont = (fontName: string) => {
    setGlobalFontFamily(fontName)
    setCalendarSettings((prev) => ({ ...prev, fontFamily: fontName }))
    setNotesSettings((prev) => ({ ...prev, fontFamily: fontName }))
    markDirty()
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('global', 'globalFontFamily', fontName)
      window.electronAPI.setSetting('calendar', 'fontFamily', fontName)
      window.electronAPI.setSetting('notes', 'fontFamily', fontName)
    }
  }

  const handleGlobalFontSize = (size: number) => {
    const nextSize = clampFontSize(size)
    setGlobalFontSize(nextSize)
    setCalendarSettings((prev) => ({ ...prev, fontSize: nextSize }))
    setNotesSettings((prev) => ({ ...prev, fontSize: nextSize }))
    markDirty()
    if (window.electronAPI?.isElectron) {
      window.electronAPI.setSetting('global', 'globalFontSize', nextSize)
      window.electronAPI.setSetting('calendar', 'fontSize', nextSize)
      window.electronAPI.setSetting('notes', 'fontSize', nextSize)
    }
  }

  if (!loaded) {
    return <div className="h-screen w-screen flex items-center justify-center text-xs opacity-20 select-none">...</div>
  }

  const isDark = themeMode === 'dark'
  const bgHex = isDark ? '#1C1C1E' : '#F2F2F7'
  const textColor = isDark ? '#F5F5F7' : '#1D1D1F'
  // Dynamic opacities: light bg needs higher opacity for readability
  const labelO = isDark ? 0.62 : 0.72
  const mutedO = isDark ? 0.7 : 0.78
  const subtleO = isDark ? 0.62 : 0.7
  const toggleOffBg = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'
  const dividerColor = isDark ? `${textColor}08` : `${textColor}0a`
  const activeTabMeta = SETTINGS_TABS.find((item) => item.id === activeTab) ?? SETTINGS_TABS[0]

  return (
    <div
      className="settings-window h-screen w-screen flex flex-col overflow-hidden"
      style={{
        fontFamily: '"Microsoft YaHei", system-ui, sans-serif',
        fontSize: '13px',
        color: textColor,
        ['--settings-text' as string]: textColor,
        ['--settings-border' as string]: isDark ? 'rgba(255,255,255,0.11)' : 'rgba(60,60,67,0.16)',
        ['--settings-panel' as string]: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.68)',
        ['--settings-panel-hover' as string]: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.92)',
      } as React.CSSProperties}
    >
      {/* Background */}
      <div className="settings-window-bg absolute inset-0" style={{ backgroundColor: `${bgHex}fa` }} />

      {/* Title bar */}
      <div
        className="settings-titlebar relative flex h-14 shrink-0 items-center justify-between border-b px-4 select-none"
        style={{ WebkitAppRegion: 'drag', borderColor: `${textColor}10` } as React.CSSProperties}
      >
        <div>
          <div className="text-[13px] font-semibold tracking-tight">偏好设置</div>
          <div className="mt-0.5 text-[11px]" style={{ opacity: subtleO }}>OKNote 外观与行为</div>
        </div>
        <button
          onClick={() => window.electronAPI?.closeWindow()}
          className="settings-close flex h-8 w-8 items-center justify-center rounded-lg hover:text-red-400 transition-colors"
          style={{ WebkitAppRegion: 'no-drag', opacity: subtleO } as React.CSSProperties}
          aria-label="关闭设置"
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Section navigation */}
        <nav className="settings-sidebar flex w-[132px] shrink-0 flex-col gap-1 border-r p-3" style={{ borderColor: `${textColor}0d` }} aria-label="设置分类">
          {SETTINGS_TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`settings-nav-button flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${activeTab === id ? 'is-active' : ''}`}
              aria-current={activeTab === id ? 'page' : undefined}
            >
              <Icon size={14} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main ref={settingsContentRef} className="settings-content min-w-0 flex-1 overflow-auto px-5 pb-5 pt-4">
          <div className="mb-5 border-b pb-4" style={{ borderColor: `${textColor}0d` }}>
            <h1 className="text-[16px] font-semibold tracking-tight">{activeTabMeta.label}</h1>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ opacity: mutedO }}>{activeTabMeta.description}</p>
          </div>
          {loadError && (
            <div role="alert" className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-500">
              设置读取失败，当前显示安全默认值；请重新打开设置窗口后再试。
            </div>
          )}
        {activeTab === 'global' && (
          <div className="space-y-5">
            {/* Theme */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest mb-2 block" style={{ opacity: labelO }}>主题风格</label>
              <div className="settings-theme-segment flex gap-1 rounded-[10px] p-1">
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`settings-theme-choice flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs transition-colors ${isDark ? 'is-active' : ''}`}
                  style={{
                    background: isDark ? `${textColor}10` : 'transparent',
                    opacity: isDark ? 0.95 : 0.68,
                  }}
                  aria-pressed={isDark}
                >
                  <Moon size={12} /> 暗色
                </button>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`settings-theme-choice flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs transition-colors ${!isDark ? 'is-active' : ''}`}
                  style={{
                    background: !isDark ? `${textColor}10` : 'transparent',
                    opacity: !isDark ? 0.95 : 0.68,
                  }}
                  aria-pressed={!isDark}
                >
                  <Sun size={12} /> 亮色
                </button>
              </div>
              <p className="mt-1.5 text-[11px]" style={{ opacity: subtleO }}>切换设置与日历的明暗外观；便签始终保留各自的配色。</p>
            </div>

            <hr style={{ borderColor: dividerColor }} />

            {/* Auto-launch */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest opacity-45 mb-2 block">系统</label>
              <div className="settings-toggle-row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2">
                <span className="min-w-0 text-xs opacity-60">开机自动启动</span>
                <button
                  onClick={async () => {
                    const next = !autoLaunch
                    setAutoLaunch(next)
                    markDirty()
                    if (!window.electronAPI?.isElectron) return
                    const result = await window.electronAPI.setAutoLaunch(next)
                    setAutoLaunch(result.enabled)
                    if (!result.ok) reportPersistenceIssue('开机启动设置未生效', result.message || '系统拒绝了该设置。')
                  }}
                  className={`settings-toggle relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                    autoLaunch ? 'bg-blue-500' : ''
                  }`}
                  style={autoLaunch ? undefined : { backgroundColor: toggleOffBg }}
                  role="switch"
                  aria-checked={autoLaunch}
                  aria-label="开机自动启动"
                >
                  <div
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                      autoLaunch ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="settings-toggle-row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2">
                <span className="min-w-0">
                  <span className="block text-xs opacity-70">开机后静默启动</span>
                  <span className="mt-0.5 block text-[11px] opacity-55">不自动显示日历，可从托盘打开</span>
                </span>
                <button
                  type="button"
                  disabled={!autoLaunch}
                  onClick={async () => {
                    const next = !startMinimized
                    setStartMinimized(next)
                    markDirty()
                    if (!window.electronAPI?.isElectron) return
                    const result = await window.electronAPI.setStartMinimized(next)
                    setStartMinimized(result.enabled)
                    if (!result.ok) reportPersistenceIssue('静默启动设置未生效', result.message || '系统未接受该启动参数。')
                  }}
                  className={`settings-toggle relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${startMinimized ? 'bg-blue-500' : ''}`}
                  style={startMinimized ? undefined : { backgroundColor: toggleOffBg }}
                  role="switch"
                  aria-checked={startMinimized}
                  aria-label="开机后静默启动"
                >
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${startMinimized ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="settings-toggle-row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-2">
                <span className="min-w-0">
                  <span className="block text-xs opacity-70">隐藏系统通知内容</span>
                  <span className="mt-0.5 block text-[11px] opacity-55">锁屏与通知中心只显示“事件提醒”，不显示标题和日期</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !hideNotificationContent
                    setHideNotificationContent(next)
                    markDirty()
                    window.electronAPI?.setSetting('global', 'hideNotificationContent', next)
                  }}
                  className={`settings-toggle relative h-6 w-10 shrink-0 rounded-full transition-colors ${hideNotificationContent ? 'bg-blue-500' : ''}`}
                  style={hideNotificationContent ? undefined : { backgroundColor: toggleOffBg }}
                  role="switch"
                  aria-checked={hideNotificationContent}
                  aria-label="隐藏系统通知内容"
                >
                  <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${hideNotificationContent ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            <hr style={{ borderColor: dividerColor }} />

            {/* Global font & fontSize */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest opacity-45 mb-3 block">全局字体设置</label>
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
              <div className="text-xs opacity-45">正在加载系统字体列表...</div>
            )}

            <hr style={{ borderColor: dividerColor }} />

            <div className="rounded-xl border p-4 text-[11px] leading-relaxed" style={{ borderColor: `${textColor}10`, opacity: isDark ? 0.62 : 0.72, background: 'var(--settings-panel)' }}>
              通用字体是批量同步入口，会同时更新日历和便签。
              <br />需要单独微调时，再进入「日历」或「便签」调整对应窗口。
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <>
            <div className="settings-toggle-row flex items-start justify-between gap-4 px-1 py-2">
              <div>
                <span className="text-sm font-medium">贴边自动收起</span>
                <p className="text-[0.65em] opacity-50 mt-0.5">日历窗口贴近屏幕边缘时自动缩成小条，鼠标悬停展开</p>
              </div>
              <button
                onClick={() => handleCalendarUpdate('edgeAutoHide', !calendarSettings.edgeAutoHide)}
                className={`settings-toggle relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                  calendarSettings.edgeAutoHide ? 'bg-blue-500' : ''
                }`}
                style={calendarSettings.edgeAutoHide ? undefined : { backgroundColor: toggleOffBg }}
                role="switch"
                aria-checked={!!calendarSettings.edgeAutoHide}
                aria-label="贴边自动收起"
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${calendarSettings.edgeAutoHide ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="settings-toggle-row flex items-start justify-between gap-4 px-1 py-2 mb-2">
              <div>
                <span className="text-sm font-medium">显示底部区域</span>
                <p className="text-[0.65em] opacity-50 mt-0.5">关闭后只显示日历，隐藏当日视图、挂载便签和高度调节条</p>
              </div>
              <button
                onClick={() => handleCalendarUpdate('showDockArea', calendarSettings.showDockArea === false)}
                className={`settings-toggle relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                  calendarSettings.showDockArea !== false ? 'bg-blue-500' : ''
                }`}
                style={calendarSettings.showDockArea !== false ? undefined : { backgroundColor: toggleOffBg }}
                role="switch"
                aria-checked={calendarSettings.showDockArea !== false}
                aria-label="显示当日视图与挂载区"
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${calendarSettings.showDockArea !== false ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <hr className="border-white/5 mb-3" />
            <AppearancePanel settings={calendarSettings} systemFonts={systemFonts} onUpdate={handleCalendarUpdate} textColor={textColor} />
          </>
        )}

        {activeTab === 'notes' && (
          <>
            <p className="mb-3 px-0.5 text-[11px] leading-relaxed opacity-60">便签颜色在每张便签的菜单中单独设置，主题切换不会覆盖。这里仅调整全部便签的字体、字号与不透明度。</p>
            <AppearancePanel settings={notesSettings} systemFonts={systemFonts} onUpdate={handleNotesUpdate} textColor={textColor} showColorControls={false} />
          </>
        )}

        {activeTab === 'manage' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] opacity-55">管理已保存的便签（包括已隐藏的便签）</p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => window.electronAPI?.tidyNotes()}
                  className="min-h-8 rounded border px-2 text-xs opacity-60 transition-opacity hover:opacity-90"
                  style={{ borderColor: `${textColor}10` }}
                  title="将可见的外部便签优先排列到日历下方"
                >
                  整理桌面便签
                </button>
                <button
                  onClick={() => { void loadManageNotes() }}
                  className="min-h-8 rounded border px-2 text-xs opacity-50 transition-opacity hover:opacity-80"
                  style={{ borderColor: `${textColor}10` }}
                >
                  刷新
                </button>
              </div>
            </div>

            {manageLoading ? (
              <div className="text-xs opacity-35 py-8 text-center">加载中...</div>
            ) : manageNotes.length === 0 ? (
              <div className="text-xs opacity-35 py-8 text-center">暂无已保存的便签</div>
            ) : (
              <div className="space-y-1">
                {manageNotes.map((note) => (
                  <div
                    key={note.id}
                    className="flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all"
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
                      <div className="text-[10px] opacity-45 mt-0.5">
                        {note.createdAt ? new Date(note.createdAt).toLocaleDateString('zh-CN') : '未知日期'}
                        <span className="ml-2 px-1 py-0.5 rounded text-[9px]" style={{
                          backgroundColor: note.isVisible ? '#22c55e15' : '#88888810',
                          color: note.isVisible ? '#22c55e' : '#888888',
                        }}>
                          {note.isVisible ? '可见' : '隐藏'}
                        </span>
                        <span className="ml-1 px-1 py-0.5 rounded text-[9px]" style={{
                          backgroundColor: note.isDocked ? '#38bdf815' : '#88888810',
                          color: note.isDocked ? '#38bdf8' : '#888888',
                        }}>
                          {note.isDocked ? '已挂载' : '外部'}
                        </span>
                        <span className="ml-1 px-1 py-0.5 rounded text-[9px]" style={{
                          backgroundColor: note.noteType === 'echo' ? '#a855f715' : note.noteType === 'daily' ? '#22c55e15' : note.noteType === 'view' ? '#64748b15' : '#f59e0b15',
                          color: note.noteType === 'echo' ? '#a855f7' : note.noteType === 'daily' ? '#22c55e' : note.noteType === 'view' ? '#94a3b8' : '#f59e0b',
                        }}>
                          {note.noteType === 'echo' ? '标签视图便签' : note.noteType === 'daily' ? '每日待办' : note.noteType === 'view' ? '旧版固定视图' : '独立便签'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {note.noteType === 'view' ? (
                        <span className="px-2 text-[10px] opacity-45" title="旧版固定视图不再作为独立窗口显示，仍可移入回收站">旧数据</span>
                      ) : note.isVisible ? (
                        <button
                          onClick={async () => {
                            const scrollTop = settingsContentRef.current?.scrollTop ?? 0
                            const result = await window.electronAPI?.hideNoteById(note.id)
                            if (!result?.ok) {
                              if (result?.canceled) return
                              reportPersistenceIssue('便签未隐藏', result?.message || '便签状态未能写入磁盘。')
                              return
                            }
                            setManageNotes((items) => items.map((item) => item.id === note.id
                              ? { ...item, isVisible: false, isHidden: true }
                              : item))
                            window.requestAnimationFrame(() => {
                              if (settingsContentRef.current) settingsContentRef.current.scrollTop = scrollTop
                            })
                          }}
                          className="min-h-8 flex items-center gap-1 px-2.5 rounded-md text-[11px] opacity-55 hover:opacity-90 transition-all hover:bg-white/5"
                          title="隐藏便签"
                        >
                          <EyeOff size={11} />
                          隐藏
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            const scrollTop = settingsContentRef.current?.scrollTop ?? 0
                            setManageNotes((items) => items.map((item) => item.id === note.id
                              ? { ...item, isVisible: true, isHidden: false }
                              : item))
                            window.electronAPI?.showNote(note.id)
                            window.requestAnimationFrame(() => {
                              if (settingsContentRef.current) settingsContentRef.current.scrollTop = scrollTop
                            })
                          }}
                          className="min-h-8 flex items-center gap-1 px-2.5 rounded-md text-[11px] opacity-55 hover:opacity-90 transition-all hover:bg-white/5"
                          title="显示便签"
                        >
                          <Eye size={11} />
                          显示
                        </button>
                      )}
                      <button
                        onClick={() => setPendingConfirm({ type: 'delete-note', id: note.id, title: note.title })}
                        className="min-h-8 flex items-center gap-1 px-2.5 rounded-md text-[11px] text-red-400/40 hover:text-red-400 hover:bg-red-500/5 transition-all"
                        title="移入回收站"
                      >
                        <Trash2 size={11} />
                        回收
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!manageLoading && (
              <section className="mt-5 border-t pt-4" style={{ borderColor: `${textColor}12` }} aria-labelledby="note-trash-heading">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h2 id="note-trash-heading" className="text-xs font-semibold">回收站</h2>
                    <p className="mt-0.5 text-[11px] opacity-60">删除的便签会保留在这里，恢复后默认保持隐藏。</p>
                  </div>
                  <span className="text-xs tabular-nums opacity-55">{deletedNotes.length}</span>
                </div>
                {deletedNotes.length === 0 ? (
                  <p className="py-4 text-center text-xs opacity-45">回收站为空</p>
                ) : (
                  <div className="space-y-1">
                    {deletedNotes.map((deleted) => (
                      <div key={deleted.trashId} className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: deleted.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{deleted.title}</div>
                          <div className="mt-0.5 text-[11px] opacity-55">{new Date(deleted.deletedAt).toLocaleString('zh-CN')}</div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const result = await window.electronAPI?.restoreDeletedNote(deleted.trashId)
                            if (!result?.ok) {
                              reportPersistenceIssue('便签未恢复', result?.message || '无法从回收站恢复该便签。')
                              return
                            }
                            await loadManageNotes(true)
                          }}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs opacity-70 hover:bg-white/8 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                        >
                          <RotateCcw size={13} />
                          恢复
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingConfirm({ type: 'delete-trash', id: deleted.trashId, title: deleted.title })}
                          className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs text-red-400/65 hover:bg-red-500/8 hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
                          title="永久删除便签"
                        >
                          <Trash2 size={13} />
                          永久删除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === 'tags' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] opacity-55">管理事件分类标签</p>
              <button
                onClick={(event) => {
                  tagFormReturnFocusRef.current = event.currentTarget
                  setEditingTagId(null)
                  setTagNameInput('')
                  setTagColorInput('#2563EB')
                  setTagDraftBaseline('|#2563eb')
                  setShowTagForm(true)
                }}
                className="min-h-8 text-xs opacity-55 hover:opacity-80 transition-opacity px-2 rounded border"
                style={{ borderColor: `${textColor}10` }}
              >
                新建标签
              </button>
            </div>

            {showTagForm && (
              <div
                className="rounded-lg border p-3 space-y-2"
                style={{ borderColor: `${textColor}10` }}
                role="group"
                aria-label={editingTagId ? '编辑标签' : '新建标签'}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  requestCloseTagForm()
                }}
              >
                <input
                  type="text"
                  maxLength={50}
                  value={tagNameInput}
                  onChange={(e) => setTagNameInput(e.target.value)}
                  placeholder="标签名称"
                  aria-label="标签名称"
                  className="w-full bg-white/3 border rounded-md px-2.5 py-1.5 text-[12px] outline-none"
                  style={{ borderColor: `${textColor}10`, color: textColor }}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] opacity-50">颜色</span>
                  <input
                    type="color"
                    value={tagColorInput}
                    onChange={(e) => setTagColorInput(e.target.value)}
                    aria-label="标签颜色"
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      const name = tagNameInput.trim()
                      if (!name) return
                      if (editingTagId) {
                        const tag = tags.find(t => t.id === editingTagId)
                        if (tag) updateTag({ ...tag, name, color: tagColorInput })
                      } else {
                        addTag({ id: generateId(), name, color: tagColorInput, createdAt: new Date().toISOString() })
                      }
                      closeTagForm()
                    }}
                    className="min-h-8 text-xs px-2 rounded bg-primary/20 text-primary"
                  >
                    {editingTagId ? '保存' : '创建'}
                  </button>
                  <button
                    onClick={requestCloseTagForm}
                    className="min-h-8 text-xs opacity-50 hover:opacity-75 px-2 rounded"
                  >
                    取消
                  </button>
                </div>
                <div className="grid grid-cols-12 gap-1 pt-1">
                  {APP_COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      onClick={() => setTagColorInput(color)}
                      className={`h-4 rounded transition-transform hover:scale-110 ${tagColorInput.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-primary/70 ring-offset-1 ring-offset-background' : ''}`}
                      style={{
                        backgroundColor: color,
                        boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.20)',
                      }}
                      title={color}
                      aria-label={`选择颜色 ${color}`}
                      aria-pressed={tagColorInput.toLowerCase() === color.toLowerCase()}
                    />
                  ))}
                </div>
              </div>
            )}

            {tags.length === 0 ? (
              <div className="text-xs opacity-35 py-8 text-center">暂无标签</div>
            ) : (
              <div className="space-y-2">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center gap-3 rounded-lg border p-3 transition-all"
                    style={{ borderColor: `${textColor}08` }}
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1 text-xs font-medium" style={{ color: tag.color }}>{tag.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(event) => {
                          tagFormReturnFocusRef.current = event.currentTarget
                          setEditingTagId(tag.id)
                          setTagNameInput(tag.name)
                          setTagColorInput(tag.color)
                          setTagDraftBaseline(`${tag.name}|${tag.color.toLowerCase()}`)
                          setShowTagForm(true)
                        }}
                        className="min-h-8 px-2 text-[11px] opacity-50 hover:opacity-80 rounded transition-all"
                        style={{ color: textColor }}
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setPendingConfirm({ type: 'delete-tag', id: tag.id, title: tag.name })}
                        className="min-h-8 px-2 text-[11px] text-red-400/40 hover:text-red-400 rounded transition-all"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </main>
      </div>
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.type === 'delete-tag'
          ? '删除这个标签？'
          : pendingConfirm?.type === 'discard-tag-form'
            ? '放弃标签草稿？'
            : pendingConfirm?.type === 'delete-trash'
              ? '永久删除这张便签？'
              : '将便签移入回收站？'}
        description={pendingConfirm?.type === 'delete-tag'
          ? `“${pendingConfirm.title}”删除后，相关事件会保留并改为“未分类”；仅绑定该标签的标签视图便签会移入回收站并关闭。`
          : pendingConfirm?.type === 'discard-tag-form'
            ? `${pendingConfirm.title}尚未保存，继续将放弃当前输入。`
            : pendingConfirm?.type === 'delete-trash'
              ? `“${pendingConfirm.title}”将从回收站永久删除，此操作无法撤销。`
              : `“${pendingConfirm?.title || '未命名便签'}”会从桌面移除，之后仍可在本页回收站恢复。`}
        confirmLabel={pendingConfirm?.type === 'delete-tag'
          ? '删除标签'
          : pendingConfirm?.type === 'discard-tag-form'
            ? '放弃草稿'
            : pendingConfirm?.type === 'delete-trash'
              ? '永久删除'
              : '移入回收站'}
        destructive
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const target = pendingConfirm
          setPendingConfirm(null)
          if (!target) return
          if (target.type === 'discard-tag-form') {
            closeTagForm()
            return
          }
          if (target.type === 'delete-tag') {
            void deleteTag(target.id)
            return
          }
          if (target.type === 'delete-trash') {
            void (async () => {
              const result = await window.electronAPI?.permanentlyDeleteNote(target.id)
              if (!result?.ok) {
                reportPersistenceIssue('便签未永久删除', result?.message || '无法清理这条回收站记录。')
                return
              }
              setDeletedNotes((items) => items.filter((item) => item.trashId !== target.id))
            })()
            return
          }
          void (async () => {
            const result = await window.electronAPI?.deleteNote(target.id)
            if (result && !result.ok && !result.canceled) reportPersistenceIssue('便签未删除', result.message || '便签未能移入回收站。')
            await loadManageNotes(true)
          })()
        }}
      />
    </div>
  )
}
