import { describe, expect, it } from 'vitest'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  clampFontSize,
  getAdaptiveDisplayFontSize,
  getTypographyLayoutTier,
} from '../src/lib/typography'

describe('responsive typography', () => {
  it('limits the supported setting to 10 through 60', () => {
    expect(FONT_SIZE_MIN).toBe(10)
    expect(FONT_SIZE_MAX).toBe(60)
    expect(clampFontSize(-20)).toBe(10)
    expect(clampFontSize(90)).toBe(60)
  })

  it('keeps every slider step visually increasing', () => {
    const renderedSizes = Array.from(
      { length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 },
      (_, index) => getAdaptiveDisplayFontSize(FONT_SIZE_MIN + index),
    )

    for (let index = 1; index < renderedSizes.length; index += 1) {
      expect(renderedSizes[index]).toBeGreaterThan(renderedSizes[index - 1])
    }
    expect(getAdaptiveDisplayFontSize(32)).toBe(32)
    expect(getAdaptiveDisplayFontSize(60)).toBe(40.4)
  })

  it('switches layout tiers from the current setting without retained state', () => {
    expect(getTypographyLayoutTier(10)).toBe('normal')
    expect(getTypographyLayoutTier(32)).toBe('large')
    expect(getTypographyLayoutTier(40)).toBe('maximum')
    expect(getTypographyLayoutTier(60)).toBe('ultra')
    expect(getTypographyLayoutTier(10)).toBe('normal')
  })
})
