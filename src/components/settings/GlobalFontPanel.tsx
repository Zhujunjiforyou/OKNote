import { FontPicker } from './FontPicker'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, clampFontSize, getAdaptiveDisplayFontSize } from '@/lib/typography'

export function GlobalFontPanel({
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
  const bgColor = isDark ? '#1C1C1E' : '#F2F2F7'
  const borderColor = isDark ? '#ffffff10' : '#00000010'
  const labelO = isDark ? 0.62 : 0.72
  const subtleO = isDark ? 0.62 : 0.7
  const requestedGlobalFontSize = clampFontSize(globalFontSize)
  const displayGlobalFontSize = getAdaptiveDisplayFontSize(requestedGlobalFontSize)
  const globalFontLabel = displayGlobalFontSize === requestedGlobalFontSize
    ? `${requestedGlobalFontSize}px`
    : `${requestedGlobalFontSize} 档 · 显示 ${displayGlobalFontSize}px`

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ opacity: labelO }}>全局字体</label>
          <span className="text-[10px] tabular-nums" style={{ opacity: subtleO }}>{systemFonts.length > 0 ? `系统字体 ${systemFonts.length} 种` : '字体加载中…'}</span>
        </div>
        <FontPicker value={globalFontFamily} fonts={systemFonts} onChange={onUpdateGlobalFont}
          label="全局字体" dark={isDark} color={textColor} surfaceColor={bgColor} borderColor={borderColor} />
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
