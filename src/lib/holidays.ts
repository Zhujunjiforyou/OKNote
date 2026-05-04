// Chinese statutory holidays
// - HOLIDAY_MAP: all holiday break days → used for diagonal stripe shading
// - LABEL_SET:   only the statutory dates → used for showing the holiday name text
//
// Statutory holidays per PRC law:
//   元旦: Jan 1 (1 day, break 1-3 days via weekend)
//   春节: Lunar New Year's Eve through 初六 (7 days, statutory: 除夕/初一/初二)
//   清明节: Qingming + adjacent weekend (3 days, statutory: 1 day)
//   劳动节: May 1-5 (5 days, statutory: May 1)
//   端午节: Lunar May 5 + adjacent weekend (3 days, statutory: 1 day)
//   中秋节: Lunar Aug 15 + adjacent weekend (3 days, statutory: 1 day)
//   国庆节: Oct 1-7 (7 days, statutory: Oct 1-3)

import { getLunarNewYear, getDragonBoat, getMidAutumn } from './lunar-calendar'

const HOLIDAY_MAP: Record<string, string> = {}
const LABEL_SET = new Set<string>()

function ds(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addRange(start: Date, end: Date, name: string, labelDates?: Date[]) {
  const cur = new Date(start)
  while (cur <= end) {
    const key = ds(cur)
    if (!HOLIDAY_MAP[key]) HOLIDAY_MAP[key] = name
    cur.setDate(cur.getDate() + 1)
  }
  if (labelDates) {
    for (const d of labelDates) LABEL_SET.add(ds(d))
  }
}

// 1-day holiday → 3-consecutive-day range (centered on nearest weekend)
function threeDayRange(date: Date): [Date, Date] {
  const dow = date.getDay()
  const start = new Date(date)
  if (dow === 1 || dow === 2) start.setDate(start.getDate() - 2)
  const end = new Date(start)
  end.setDate(start.getDate() + 2)
  return [start, end]
}

// Compute holidays for a single year
function computeYearHolidays(year: number) {
  // 元旦: 1 day, extend to weekend if Fri/Sat/Sun
  const ny = new Date(year, 0, 1)
  const nyDow = ny.getDay()
  if (nyDow === 5 || nyDow === 6 || nyDow === 0) {
    const [s, e] = threeDayRange(ny)
    addRange(s, e, '元旦', [ny])
  } else {
    addRange(ny, ny, '元旦', [ny])
  }

  // 春节: 除夕~初六 (7 days), label: 除夕/初一/初二
  const cny = getLunarNewYear(year)
  const chuxi = new Date(cny); chuxi.setDate(chuxi.getDate() - 1)
  const chuer = new Date(cny); chuer.setDate(chuer.getDate() + 1)
  const sfEnd = new Date(cny); sfEnd.setDate(sfEnd.getDate() + 5)
  addRange(chuxi, sfEnd, '春节', [chuxi, cny, chuer])

  // 清明节: 3 days, label: Apr 5
  const qm = new Date(year, 3, 5)
  const [qmS, qmE] = threeDayRange(qm)
  addRange(qmS, qmE, '清明节', [qm])

  // 劳动节: May 1-5, label: May 1
  addRange(new Date(year, 4, 1), new Date(year, 4, 5), '劳动节', [new Date(year, 4, 1)])

  // 端午节: 3 days, label: Lunar May 5
  const db = getDragonBoat(year)
  const [dbS, dbE] = threeDayRange(db)
  addRange(dbS, dbE, '端午节', [db])

  // 中秋节: 3 days, label: Lunar Aug 15
  const ma = getMidAutumn(year)
  const [maS, maE] = threeDayRange(ma)
  addRange(maS, maE, '中秋节', [ma])

  // 国庆节: Oct 1-7, label: Oct 1-3
  addRange(new Date(year, 9, 1), new Date(year, 9, 7), '国庆节',
    [new Date(year, 9, 1), new Date(year, 9, 2), new Date(year, 9, 3)])
}

for (let y = 1900; y <= 2100; y++) computeYearHolidays(y)

// ── Override with exact dates for 2024-2030 ──
function setRange(start: string, end: string, name: string, labelDays?: string[]) {
  const s = new Date(start), e = new Date(end), cur = new Date(s)
  while (cur <= e) { HOLIDAY_MAP[ds(cur)] = name; cur.setDate(cur.getDate() + 1) }
  if (labelDays) for (const d of labelDays) LABEL_SET.add(d)
}

// 2024
setRange('2024-01-01', '2024-01-01', '元旦', ['2024-01-01'])
setRange('2024-02-10', '2024-02-17', '春节', ['2024-02-09', '2024-02-10', '2024-02-11'])
setRange('2024-04-04', '2024-04-06', '清明节', ['2024-04-04'])
setRange('2024-05-01', '2024-05-05', '劳动节', ['2024-05-01'])
setRange('2024-06-08', '2024-06-10', '端午节', ['2024-06-10'])
setRange('2024-09-15', '2024-09-17', '中秋节', ['2024-09-17'])
setRange('2024-10-01', '2024-10-07', '国庆节', ['2024-10-01', '2024-10-02', '2024-10-03'])

// 2025
setRange('2025-01-01', '2025-01-01', '元旦', ['2025-01-01'])
setRange('2025-01-28', '2025-02-04', '春节', ['2025-01-28', '2025-01-29', '2025-01-30'])
setRange('2025-04-04', '2025-04-06', '清明节', ['2025-04-04'])
setRange('2025-05-01', '2025-05-05', '劳动节', ['2025-05-01'])
setRange('2025-05-31', '2025-06-02', '端午节', ['2025-05-31'])
setRange('2025-10-01', '2025-10-08', '国庆节', ['2025-10-01', '2025-10-02', '2025-10-03'])

// 2026
setRange('2026-01-01', '2026-01-03', '元旦', ['2026-01-01'])
setRange('2026-02-17', '2026-02-23', '春节', ['2026-02-16', '2026-02-17', '2026-02-18'])
setRange('2026-04-05', '2026-04-07', '清明节', ['2026-04-05'])
setRange('2026-05-01', '2026-05-05', '劳动节', ['2026-05-01'])
setRange('2026-06-19', '2026-06-21', '端午节', ['2026-06-19'])
setRange('2026-09-25', '2026-09-27', '中秋节', ['2026-09-25'])
setRange('2026-10-01', '2026-10-07', '国庆节', ['2026-10-01', '2026-10-02', '2026-10-03'])

// 2027
setRange('2027-01-01', '2027-01-03', '元旦', ['2027-01-01'])
setRange('2027-02-05', '2027-02-11', '春节', ['2027-02-05', '2027-02-06', '2027-02-07'])
setRange('2027-04-04', '2027-04-06', '清明节', ['2027-04-04'])
setRange('2027-05-01', '2027-05-05', '劳动节', ['2027-05-01'])
setRange('2027-06-08', '2027-06-10', '端午节', ['2027-06-09'])
setRange('2027-09-14', '2027-09-16', '中秋节', ['2027-09-15'])
setRange('2027-10-01', '2027-10-07', '国庆节', ['2027-10-01', '2027-10-02', '2027-10-03'])

// 2028
setRange('2028-01-01', '2028-01-03', '元旦', ['2028-01-01'])
setRange('2028-01-25', '2028-01-31', '春节', ['2028-01-25', '2028-01-26', '2028-01-27'])
setRange('2028-04-04', '2028-04-06', '清明节', ['2028-04-04'])
setRange('2028-04-29', '2028-05-03', '劳动节', ['2028-05-01'])
setRange('2028-05-28', '2028-05-30', '端午节', ['2028-05-28'])
setRange('2028-10-01', '2028-10-07', '国庆节', ['2028-10-01', '2028-10-02', '2028-10-03'])
setRange('2028-10-03', '2028-10-05', '中秋节', ['2028-10-03'])

// 2029
setRange('2029-01-01', '2029-01-01', '元旦', ['2029-01-01'])
setRange('2029-02-13', '2029-02-19', '春节', ['2029-02-12', '2029-02-13', '2029-02-14'])
setRange('2029-04-04', '2029-04-06', '清明节', ['2029-04-04'])
setRange('2029-04-29', '2029-05-03', '劳动节', ['2029-05-01'])
setRange('2029-06-16', '2029-06-18', '端午节', ['2029-06-16'])
setRange('2029-09-22', '2029-09-24', '中秋节', ['2029-09-22'])
setRange('2029-10-01', '2029-10-07', '国庆节', ['2029-10-01', '2029-10-02', '2029-10-03'])

// 2030
setRange('2030-01-01', '2030-01-03', '元旦', ['2030-01-01'])
setRange('2030-02-02', '2030-02-08', '春节', ['2030-02-02', '2030-02-03', '2030-02-04'])
setRange('2030-04-04', '2030-04-06', '清明节', ['2030-04-04'])
setRange('2030-05-01', '2030-05-05', '劳动节', ['2030-05-01'])
setRange('2030-06-05', '2030-06-07', '端午节', ['2030-06-05'])
setRange('2030-09-11', '2030-09-13', '中秋节', ['2030-09-12'])
setRange('2030-10-01', '2030-10-07', '国庆节', ['2030-10-01', '2030-10-02', '2030-10-03'])

export function getHoliday(dateStr: string): string | null {
  return HOLIDAY_MAP[dateStr] || null
}

export function isHolidayLabelDay(dateStr: string): boolean {
  return LABEL_SET.has(dateStr)
}

export { HOLIDAY_MAP }
