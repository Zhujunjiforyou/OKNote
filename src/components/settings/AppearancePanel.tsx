import { FontPicker } from './FontPicker'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, clampFontSize, getAdaptiveDisplayFontSize } from '@/lib/typography'
import { contrastRatio, ensureReadableTextColor, isImeComposing, isLightColor } from '@/lib/utils'
import type { PerWindowSettings } from '@/types/electron'

export function AppearancePanel({
  settings, systemFonts, onUpdate, textColor, showColorControls = true,
}: {
  settings: PerWindowSettings
  systemFonts: string[]
  onUpdate: (key: string, value: unknown) => void
  textColor: string
  showColorControls?: boolean
}) {
  const bgHex = settings.backgroundColor.replace('#', '')
  const bgWithAlpha = `#${bgHex}${Math.round(settings.backgroundOpacity * 255).toString(16).padStart(2, '0')}`
  const dark = isLightColor(textColor)
  const menuSurface = dark ? '#1C1C1E' : '#F2F2F7'
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
        <FontPicker value={settings.fontFamily} fonts={systemFonts} onChange={(family) => onUpdate('fontFamily', family)}
          label="窗口字体" dark={dark} color={textColor} surfaceColor={menuSurface} borderColor={`${textColor}10`} />
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
              onKeyDown={(e) => { if (!isImeComposing(e) && e.key === 'Enter') e.currentTarget.blur() }}
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
              onKeyDown={(e) => { if (!isImeComposing(e) && e.key === 'Enter') e.currentTarget.blur() }}
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
