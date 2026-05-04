// ── Lunar (Chinese) calendar calculation for 1900-2100 ──
// Based on the classic lookup-table algorithm widely used in Chinese calendar software.
// Each year is encoded as a hex value where:
//   bits  0-3 : leap month number (0 = no leap month)
//   bits  4-15: 12 bits, one per month — 1 = 30 days, 0 = 29 days
//   bit  16   : leap month length: 0 = 29 days, 1 = 30 days

const LUNAR_YEAR_INFO: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554,
  0x056a0, 0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250,
  0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970,
  0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570,
  0x052f2, 0x04970, 0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0,
  0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, 0x0d4a0, 0x1d8a6,
  0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950,
  0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573,
  0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60,
  0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558,
  0x0b540, 0x0b6a0, 0x195a6, 0x095b0, 0x049b0, 0x0a974, 0x0a4b0,
  0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, 0x04af5,
  0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60,
  0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552,
  0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
  0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0,
  0x0a930, 0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6,
  0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0,
  0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50,
  0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370, 0x049f8, 0x04970,
  0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, 0x092e0,
  0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0,
  0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6,
  0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, 0x0b273, 0x06930,
  0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4,
  0x0d160, 0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0,
  0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252, 0x0d520,
]

// ── Anchor: Chinese New Year 1900 = 1900-01-31 ──
// Base offset: days from 1900-01-01 to 1900-01-31 = 30
const CNY_1900_OFFSET = 30

// Precomputed offsets (days from 1900-01-01) for the start of each lunar year.
const CNY_OFFSETS: number[] = (() => {
  const offsets: number[] = [CNY_1900_OFFSET]
  let cum = CNY_1900_OFFSET
  for (let i = 0; i < LUNAR_YEAR_INFO.length; i++) {
    cum += getLunarYearMonths(LUNAR_YEAR_INFO[i]).reduce((a, b) => a + b, 0)
    offsets.push(cum)
  }
  return offsets
})()

// Convert an offset (days from 1900-01-01) to a solar Date
function offsetToDate(offset: number): Date {
  let y = 1900
  while (true) {
    const diy = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
    if (offset < diy) break
    offset -= diy
    y++
  }
  const daysInMonth = (yr: number, m: number) => {
    if (m === 2) return (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0 ? 29 : 28
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  }
  let m = 1
  while (true) {
    const dim = daysInMonth(y, m)
    if (offset < dim) break
    offset -= dim
    m++
  }
  return new Date(y, m - 1, offset + 1)
}

// Convert a solar year/month/day to offset from 1900-01-01
function dateToOffset(year: number, month: number, day: number): number {
  let offset = 0
  for (let y = 1900; y < year; y++) {
    offset += (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
  }
  const daysInMonth = (yr: number, m: number) => {
    if (m === 2) return (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0 ? 29 : 28
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  }
  for (let m = 1; m < month; m++) {
    offset += daysInMonth(year, m)
  }
  offset += day - 1
  return offset
}

function getLunarYearMonths(info: number): number[] {
  const leapMonth = info & 0xf
  const months: number[] = []

  // Bits 4-15 encode months 1-12 (bit 15=month1, ..., bit 4=month12)
  for (let i = 0; i < 12; i++) {
    months.push((info & (0x8000 >> i)) ? 30 : 29)
  }

  if (leapMonth > 0 && leapMonth <= 12) {
    // Bit 16 encodes leap month length: 0=29, 1=30 days
    const leapDays = (info & 0x10000) ? 30 : 29
    months.splice(leapMonth, 0, leapDays)
  }

  return months
}

function buildMonthLabels(info: number): Array<{ month: number; isLeap: boolean }> {
  const leapMonth = info & 0xf
  const labels: Array<{ month: number; isLeap: boolean }> = []
  for (let m = 1; m <= 12; m++) {
    labels.push({ month: m, isLeap: false })
    if (m === leapMonth) labels.push({ month: m, isLeap: true })
  }
  return labels
}

// ── Public API ──

export interface LunarDate {
  year: number
  month: number
  day: number
  isLeap: boolean
}

/**
 * Convert a solar (Gregorian) date to a lunar date.
 */
export function solarToLunar(date: Date): LunarDate {
  const targetOffset = dateToOffset(date.getFullYear(), date.getMonth() + 1, date.getDate())

  // Find the lunar year
  let lunarYearIdx = 0
  while (lunarYearIdx + 1 < CNY_OFFSETS.length && CNY_OFFSETS[lunarYearIdx + 1] <= targetOffset) {
    lunarYearIdx++
  }

  const lunarYear = 1900 + lunarYearIdx
  let remaining = targetOffset - CNY_OFFSETS[lunarYearIdx]
  const info = LUNAR_YEAR_INFO[lunarYearIdx]
  const months = getLunarYearMonths(info)
  const labels = buildMonthLabels(info)

  let lunarMonth = 1
  let isLeap = false
  for (let i = 0; i < months.length; i++) {
    if (remaining < months[i]) {
      lunarMonth = labels[i].month
      isLeap = labels[i].isLeap
      break
    }
    remaining -= months[i]
  }

  return {
    year: lunarYear,
    month: lunarMonth,
    day: remaining + 1,
    isLeap,
  }
}

/**
 * Convert a lunar date to a solar (Gregorian) Date.
 */
export function lunarToSolar(lunarYear: number, lunarMonth: number, lunarDay: number, isLeap = false): Date {
  const idx = lunarYear - 1900
  let offset = CNY_OFFSETS[idx]

  const info = LUNAR_YEAR_INFO[idx]
  const months = getLunarYearMonths(info)
  const labels = buildMonthLabels(info)

  for (let i = 0; i < months.length; i++) {
    const label = labels[i]
    if (label.month < lunarMonth || (label.month === lunarMonth && !label.isLeap && isLeap)) {
      offset += months[i]
      continue
    }
    if (label.month === lunarMonth && label.isLeap === isLeap) {
      offset += lunarDay - 1
      break
    }
  }

  return offsetToDate(offset)
}

/**
 * Get the solar date of Lunar New Year (Spring Festival) for a given year.
 */
export function getLunarNewYear(year: number): Date {
  const idx = year - 1900
  return offsetToDate(CNY_OFFSETS[idx])
}

/**
 * Get the solar date of Dragon Boat Festival (Lunar May 5).
 */
export function getDragonBoat(year: number): Date {
  return lunarToSolar(year, 5, 5)
}

/**
 * Get the solar date of Mid-Autumn Festival (Lunar Aug 15).
 */
export function getMidAutumn(year: number): Date {
  return lunarToSolar(year, 8, 15)
}
