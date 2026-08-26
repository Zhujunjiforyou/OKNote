// Chinese festival and official holiday data.
//
// Official multi-day breaks and make-up workdays are included only for years
// with a published State Council schedule. Other years show the festival day
// itself and deliberately do not guess adjacent days off.
//
// Sources:
// 2024 https://www.gov.cn/zhengce/content/202310/content_6911527.htm
// 2025 https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm
// 2026 https://www.gov.cn/zhengce/content/202511/content_7047090.htm

import { getDragonBoat, getLunarNewYear, getMidAutumn } from './lunar-calendar'

const HOLIDAY_MAP: Record<string, string> = {}
const WORKDAY_MAP: Record<string, string> = {}
const LABEL_SET = new Set<string>()

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function localDateKey(date: Date): string {
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addFestivalDay(value: string, name: string) {
  HOLIDAY_MAP[value] = HOLIDAY_MAP[value] && HOLIDAY_MAP[value] !== name
    ? `${HOLIDAY_MAP[value]} / ${name}`
    : name
  LABEL_SET.add(value)
}

function getQingmingDate(year: number): string {
  // Solar-term approximation used by the bundled lunar calendar range. The
  // constant is the Qingming term offset from 1900-01-06 02:05 UTC.
  const base = new Date(0)
  base.setUTCFullYear(1900, 0, 6)
  base.setUTCHours(2, 5, 0, 0)
  const instant = new Date(base.getTime() + 31_556_925_974.7 * (year - 1900) + 128_867 * 60_000)
  return dateKey(year, 4, instant.getUTCDate())
}

function addKnownFestivalDays(year: number) {
  addFestivalDay(dateKey(year, 1, 1), '元旦')
  addFestivalDay(localDateKey(getLunarNewYear(year)), '春节')
  if (year < 2024 || year > 2026) addFestivalDay(getQingmingDate(year), '清明节')
  addFestivalDay(dateKey(year, 5, 1), '劳动节')
  addFestivalDay(localDateKey(getDragonBoat(year)), '端午节')
  addFestivalDay(localDateKey(getMidAutumn(year)), '中秋节')
  addFestivalDay(dateKey(year, 10, 1), '国庆节')
}

for (let year = 1900; year <= 2100; year += 1) addKnownFestivalDays(year)

function setOfficialRange(start: string, end: string, name: string, labelDays: string[] = []) {
  const current = parseDateKey(start)
  const last = parseDateKey(end)
  while (current <= last) {
    HOLIDAY_MAP[localDateKey(current)] = name
    current.setDate(current.getDate() + 1)
  }
  labelDays.forEach((day) => LABEL_SET.add(day))
}

function setOfficialWorkdays(days: string[]) {
  days.forEach((day) => { WORKDAY_MAP[day] = '调休上班' })
}

// 2024 official schedule
setOfficialRange('2024-01-01', '2024-01-01', '元旦', ['2024-01-01'])
setOfficialRange('2024-02-10', '2024-02-17', '春节', ['2024-02-10', '2024-02-11', '2024-02-12'])
setOfficialRange('2024-04-04', '2024-04-06', '清明节', ['2024-04-04'])
setOfficialRange('2024-05-01', '2024-05-05', '劳动节', ['2024-05-01'])
setOfficialRange('2024-06-08', '2024-06-10', '端午节', ['2024-06-10'])
setOfficialRange('2024-09-15', '2024-09-17', '中秋节', ['2024-09-17'])
setOfficialRange('2024-10-01', '2024-10-07', '国庆节', ['2024-10-01', '2024-10-02', '2024-10-03'])
setOfficialWorkdays(['2024-02-04', '2024-02-18', '2024-04-07', '2024-04-28', '2024-05-11', '2024-09-14', '2024-09-29', '2024-10-12'])

// 2025 official schedule
setOfficialRange('2025-01-01', '2025-01-01', '元旦', ['2025-01-01'])
setOfficialRange('2025-01-28', '2025-02-04', '春节', ['2025-01-28', '2025-01-29', '2025-01-30'])
setOfficialRange('2025-04-04', '2025-04-06', '清明节', ['2025-04-04'])
setOfficialRange('2025-05-01', '2025-05-05', '劳动节', ['2025-05-01'])
setOfficialRange('2025-05-31', '2025-06-02', '端午节', ['2025-05-31'])
setOfficialRange('2025-10-01', '2025-10-08', '国庆节 / 中秋节', ['2025-10-01', '2025-10-02', '2025-10-03', '2025-10-06'])
setOfficialWorkdays(['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11'])

// 2026 official schedule (国办发明电〔2025〕7号)
setOfficialRange('2026-01-01', '2026-01-03', '元旦', ['2026-01-01'])
setOfficialRange('2026-02-15', '2026-02-23', '春节', ['2026-02-16', '2026-02-17', '2026-02-18'])
setOfficialRange('2026-04-04', '2026-04-06', '清明节', ['2026-04-04'])
setOfficialRange('2026-05-01', '2026-05-05', '劳动节', ['2026-05-01'])
setOfficialRange('2026-06-19', '2026-06-21', '端午节', ['2026-06-19'])
setOfficialRange('2026-09-25', '2026-09-27', '中秋节', ['2026-09-25'])
setOfficialRange('2026-10-01', '2026-10-07', '国庆节', ['2026-10-01', '2026-10-02', '2026-10-03'])
setOfficialWorkdays(['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'])

export function getHoliday(value: string): string | null {
  return HOLIDAY_MAP[value] || null
}

export function getAdjustedWorkday(value: string): string | null {
  return WORKDAY_MAP[value] || null
}

export function isHolidayLabelDay(value: string): boolean {
  return LABEL_SET.has(value)
}

export { HOLIDAY_MAP, WORKDAY_MAP }
