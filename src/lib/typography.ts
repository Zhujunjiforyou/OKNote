export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 60

const DIRECT_SCALE_MAX = 32
const LARGE_TEXT_SCALE = 0.3

export function clampFontSize(value: number): number {
  const numeric = Number(value)
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Number.isFinite(numeric) ? numeric : 14))
}

/**
 * Keep ordinary sizes pixel-accurate. Above 32, continue growing every step
 * while reserving enough room for controls and content to remain usable.
 */
export function getAdaptiveDisplayFontSize(value: number): number {
  const requested = clampFontSize(value)
  const display = requested <= DIRECT_SCALE_MAX
    ? requested
    : DIRECT_SCALE_MAX + (requested - DIRECT_SCALE_MAX) * LARGE_TEXT_SCALE
  return Math.round(display * 10) / 10
}

export function getTypographyLayoutTier(value: number): 'normal' | 'large' | 'maximum' | 'ultra' {
  const requested = clampFontSize(value)
  if (requested >= 49) return 'ultra'
  if (requested >= 37) return 'maximum'
  if (requested >= 25) return 'large'
  return 'normal'
}
