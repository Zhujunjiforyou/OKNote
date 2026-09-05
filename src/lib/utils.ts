import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CalendarEvent, EventRecurrence } from "@/types/calendar.types"
import type { Note } from "@/types/notes.types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusAdjacentInteractiveElement(origin: HTMLElement | null, backwards = false): void {
  if (!origin) return
  const candidates = [...document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  })
  const originIndex = candidates.indexOf(origin)
  const target = originIndex >= 0 ? candidates[originIndex + (backwards ? -1 : 1)] : null
  if (target) target.focus()
  else origin.focus()
}

let fallbackIdSequence = 0
export function generateId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  fallbackIdSequence += 1
  return `generated_${Date.now()}_${fallbackIdSequence}`
}

export const DEFAULT_NOTE_COLOR = '#2563EB'
export const APP_COLOR_PALETTE = [
  '#047857', '#0D9488', '#5EEAD4', '#06B6D4', '#38BDF8', '#2563EB',
  '#4F46E5', '#8B5CF6', '#C4B5FD', '#D946EF', '#BE185D', '#F9A8D4',
  '#F43F5E', '#DC2626', '#F97316', '#FDBA74', '#F59E0B', '#FDE047',
  '#A3E635', '#22C55E', '#84CC16', '#64748B', '#334155', '#92400E',
]
export const NOTE_COLOR_PALETTE = APP_COLOR_PALETTE
export const EVENT_COLOR_PALETTE = APP_COLOR_PALETTE
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function normalizeHexColor(value: unknown, fallback = DEFAULT_NOTE_COLOR): string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback
}

export function hexToLuminance(hex: string): number {
  const safeHex = normalizeHexColor(hex)
  const toLinear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const r = toLinear(parseInt(safeHex.slice(1, 3), 16))
  const g = toLinear(parseInt(safeHex.slice(3, 5), 16))
  const b = toLinear(parseInt(safeHex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = hexToLuminance(first)
  const secondLuminance = hexToLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function ensureReadableTextColor(background: string, configured: string, minimumRatio = 4.5): string {
  const safeBackground = normalizeHexColor(background, '#1C1C1E')
  const safeConfigured = normalizeHexColor(configured, '#F5F5F7')
  if (contrastRatio(safeBackground, safeConfigured) >= minimumRatio) return safeConfigured
  return contrastRatio(safeBackground, '#111827') >= contrastRatio(safeBackground, '#f8fafc')
    ? '#111827'
    : '#f8fafc'
}

export function isLightColor(hex: string): boolean {
  // At ~0.179, black and white have equal WCAG contrast against the surface.
  return hexToLuminance(hex) > 0.179
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_SUPPORTED_DATE_KEY = '1900-01-01'
export const MAX_SUPPORTED_DATE_KEY = '2100-12-31'
const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_-]{1,160}$/

export function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER_RE.test(value)
}

export function isImeComposing(event: {
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}): boolean {
  return event.isComposing === true
    || event.nativeEvent?.isComposing === true
    || event.keyCode === 229
    || event.nativeEvent?.keyCode === 229
}

function isRealDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function getSupportedDateRange(rangeStart: string, rangeEnd: string): { start: string; end: string } | null {
  if (!isRealDateKey(rangeStart) || !isRealDateKey(rangeEnd) || rangeEnd < rangeStart) return null
  if (rangeStart > MAX_SUPPORTED_DATE_KEY || rangeEnd < MIN_SUPPORTED_DATE_KEY) return null
  return {
    start: rangeStart < MIN_SUPPORTED_DATE_KEY ? MIN_SUPPORTED_DATE_KEY : rangeStart,
    end: rangeEnd > MAX_SUPPORTED_DATE_KEY ? MAX_SUPPORTED_DATE_KEY : rangeEnd,
  }
}

export function isDateKey(value: unknown): value is string {
  return isRealDateKey(value) && value >= MIN_SUPPORTED_DATE_KEY && value <= MAX_SUPPORTED_DATE_KEY
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function dateKeyToUtcDay(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / DAY_MS)
}

function formatUtcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

export function addDaysToDateKey(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + days)
  return formatUtcDateKey(date)
}

export function diffDateKeys(startDate: string, endDate: string): number {
  return dateKeyToUtcDay(endDate) - dateKeyToUtcDay(startDate)
}

function getDateKeyWeekday(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getUTCDay()
}

function startOfWeekDateKey(dateStr: string): string {
  const weekday = getDateKeyWeekday(dateStr)
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday
  return addDaysToDateKey(dateStr, mondayOffset)
}

function monthDistance(startDate: string, endDate: string): number {
  const [startYear, startMonth] = startDate.split('-').map(Number)
  const [endYear, endMonth] = endDate.split('-').map(Number)
  return (endYear - startYear) * 12 + (endMonth - startMonth)
}

function yearDistance(startDate: string, endDate: string): number {
  return Number(endDate.slice(0, 4)) - Number(startDate.slice(0, 4))
}

function getEventDurationDays(event: CalendarEvent): number {
  if (!event.endDate || event.endDate === event.startDate) return 0
  return Math.max(0, diffDateKeys(event.startDate, event.endDate))
}

function eventRangeIntersects(startDate: string, endDate: string, rangeStart: string, rangeEnd: string): boolean {
  return endDate >= rangeStart && startDate <= rangeEnd
}

function recurrenceMatchesDate(event: CalendarEvent, dateStr: string): boolean {
  const recurrence = event.recurrence
  if (!recurrence || dateStr < event.startDate) return false
  if (recurrence.until && dateStr > recurrence.until) return false

  const interval = Math.max(1, Math.floor(recurrence.interval || 1))

  if (recurrence.freq === 'daily') {
    return diffDateKeys(event.startDate, dateStr) % interval === 0
  }

  if (recurrence.freq === 'weekly') {
    const weekdays = recurrence.byWeekday?.length
      ? recurrence.byWeekday
      : [getDateKeyWeekday(event.startDate)]
    if (!weekdays.includes(getDateKeyWeekday(dateStr))) return false
    const weeks = Math.floor(diffDateKeys(startOfWeekDateKey(event.startDate), startOfWeekDateKey(dateStr)) / 7)
    return weeks >= 0 && weeks % interval === 0
  }

  if (recurrence.freq === 'monthly') {
    const days = recurrence.byMonthDay?.length
      ? recurrence.byMonthDay
      : [Number(event.startDate.slice(8, 10))]
    if (!days.includes(Number(dateStr.slice(8, 10)))) return false
    const months = monthDistance(event.startDate, dateStr)
    return months >= 0 && months % interval === 0
  }

  const sameMonthDay = dateStr.slice(5) === event.startDate.slice(5)
  const years = yearDistance(event.startDate, dateStr)
  return sameMonthDay && years >= 0 && years % interval === 0
}

function dateKeyFromMonthIndex(monthIndex: number, day: number): string | null {
  const year = Math.floor(monthIndex / 12)
  const month = monthIndex % 12
  const candidate = `${year}-${pad2(month + 1)}-${pad2(day)}`
  return isDateKey(candidate) ? candidate : null
}

function recurringStartNear(event: CalendarEvent, pivotDate: string, direction: 'next' | 'previous'): string | null {
  const recurrence = event.recurrence
  if (!recurrence || !isDateKey(event.startDate) || !isDateKey(pivotDate)) return null
  const interval = Math.max(1, Math.floor(recurrence.interval || 1))
  const accepts = (candidate: string) => isDateKey(candidate)
    && candidate >= event.startDate
    && (!recurrence.until || candidate <= recurrence.until)
    && (direction === 'next' ? candidate >= pivotDate : candidate <= pivotDate)
    && recurrenceMatchesDate(event, candidate)

  if (recurrence.freq === 'daily') {
    // When the series has already ended, search backwards from its upper
    // bound instead of testing one post-`until` candidate and giving up.
    const candidatePivot = direction === 'previous' && recurrence.until && pivotDate > recurrence.until
      ? recurrence.until
      : pivotDate
    const difference = diffDateKeys(event.startDate, candidatePivot)
    if (direction === 'previous' && difference < 0) return null
    const occurrenceIndex = direction === 'next'
      ? Math.max(0, Math.ceil(difference / interval))
      : Math.floor(difference / interval)
    const candidate = addDaysToDateKey(event.startDate, occurrenceIndex * interval)
    return accepts(candidate) ? candidate : null
  }

  if (recurrence.freq === 'weekly') {
    const seriesWeek = startOfWeekDateKey(event.startDate)
    const pivotWeek = startOfWeekDateKey(pivotDate)
    const weeksFromStart = Math.floor(diffDateKeys(seriesWeek, pivotWeek) / 7)
    let activeWeek = Math.max(0, Math.floor(weeksFromStart / interval) * interval)
    if (direction === 'previous' && weeksFromStart < 0) return null
    const weekdays = [...new Set(recurrence.byWeekday?.length
      ? recurrence.byWeekday
      : [getDateKeyWeekday(event.startDate)])]
      .map((day) => day === 0 ? 6 : day - 1)
      .sort((a, b) => direction === 'next' ? a - b : b - a)
    for (let attempts = 0; attempts < 11000; attempts += 1) {
      if (activeWeek < 0) return null
      const activeWeekStart = addDaysToDateKey(seriesWeek, activeWeek * 7)
      for (const weekdayOffset of weekdays) {
        const candidate = addDaysToDateKey(activeWeekStart, weekdayOffset)
        if (accepts(candidate)) return candidate
      }
      activeWeek += direction === 'next' ? interval : -interval
      if (Number(activeWeekStart.slice(0, 4)) >= 2100 && direction === 'next') return null
    }
    return null
  }

  if (recurrence.freq === 'monthly') {
    const [startYear, startMonth] = event.startDate.split('-').map(Number)
    const [pivotYear, pivotMonth] = pivotDate.split('-').map(Number)
    const seriesMonth = startYear * 12 + startMonth - 1
    const pivotMonthIndex = pivotYear * 12 + pivotMonth - 1
    const monthsFromStart = pivotMonthIndex - seriesMonth
    if (direction === 'previous' && monthsFromStart < 0) return null
    let activeMonth = Math.max(0, Math.floor(monthsFromStart / interval) * interval)
    const days = [...new Set(recurrence.byMonthDay?.length
      ? recurrence.byMonthDay
      : [Number(event.startDate.slice(8, 10))])]
      .sort((a, b) => direction === 'next' ? a - b : b - a)
    for (let attempts = 0; attempts < 2500; attempts += 1) {
      if (activeMonth < 0) return null
      const monthIndex = seriesMonth + activeMonth
      if (Math.floor(monthIndex / 12) > 2100 || Math.floor(monthIndex / 12) < 1900) return null
      for (const day of days) {
        const candidate = dateKeyFromMonthIndex(monthIndex, day)
        if (candidate && accepts(candidate)) return candidate
      }
      activeMonth += direction === 'next' ? interval : -interval
    }
    return null
  }

  const startYear = Number(event.startDate.slice(0, 4))
  const pivotYear = Number(pivotDate.slice(0, 4))
  const yearsFromStart = pivotYear - startYear
  if (direction === 'previous' && yearsFromStart < 0) return null
  let activeYear = Math.max(0, Math.floor(yearsFromStart / interval) * interval)
  const monthDay = event.startDate.slice(5)
  for (let attempts = 0; attempts < 500; attempts += 1) {
    if (activeYear < 0) return null
    const candidate = `${startYear + activeYear}-${monthDay}`
    if (isDateKey(candidate) && accepts(candidate)) return candidate
    if (startYear + activeYear > 2100 && direction === 'next') return null
    activeYear += direction === 'next' ? interval : -interval
  }
  return null
}

export function getNearestRecurringOccurrence(event: CalendarEvent, pivotDate: string): CalendarEvent | null {
  if (!event.recurrence || !isDateKey(pivotDate)) return null
  const durationDays = getEventDurationDays(event)
  const previousStart = recurringStartNear(event, pivotDate, 'previous')
  const nextStart = recurringStartNear(event, pivotDate, 'next')
  const occurrenceStart = previousStart && addDaysToDateKey(previousStart, durationDays) >= pivotDate
    ? previousStart
    : (nextStart || previousStart)
  if (!occurrenceStart) return null
  const occurrenceEnd = addDaysToDateKey(occurrenceStart, durationDays)
  return {
    ...event,
    startDate: occurrenceStart,
    endDate: durationDays > 0 ? occurrenceEnd : undefined,
    seriesId: event.id,
    occurrenceDate: occurrenceStart,
    occurrenceKey: `${event.id}__${occurrenceStart}`,
  }
}

export function getEventInstanceRange(event: CalendarEvent, occurrenceDate?: string | null): Pick<CalendarEvent, 'startDate' | 'endDate'> {
  const startDate = event.recurrence && isDateKey(occurrenceDate) ? occurrenceDate : event.startDate
  const durationDays = getEventDurationDays(event)
  return {
    startDate,
    ...(durationDays > 0 ? { endDate: addDaysToDateKey(startDate, durationDays) } : {}),
  }
}

export function getTagViewEventInstances(events: CalendarEvent[], pivotDate: string): CalendarEvent[] {
  const visible: CalendarEvent[] = []
  for (const event of events) {
    if (!event.recurrence) {
      visible.push(event)
      continue
    }
    const occurrence = getNearestRecurringOccurrence(event, pivotDate)
    if (occurrence) visible.push(occurrence)
  }
  return visible
}

export function getEventInstanceKey(event: CalendarEvent): string {
  return event.occurrenceKey || event.id
}

export function compareCalendarEventStart(a: CalendarEvent, b: CalendarEvent): number {
  const dateCompare = a.startDate.localeCompare(b.startDate)
  if (dateCompare !== 0) return dateCompare
  const aMultiDay = !!(a.endDate && a.endDate !== a.startDate)
  const bMultiDay = !!(b.endDate && b.endDate !== b.startDate)
  if (aMultiDay !== bMultiDay) return aMultiDay ? -1 : 1
  const aTimed = !a.isAllDay && !!a.startTime
  const bTimed = !b.isAllDay && !!b.startTime
  if (aTimed !== bTimed) return aTimed ? 1 : -1
  if (aTimed && bTimed) {
    const timeCompare = (a.startTime || '').localeCompare(b.startTime || '')
    if (timeCompare !== 0) return timeCompare
  }
  const titleCompare = a.title.localeCompare(b.title, 'zh-CN')
  return titleCompare !== 0 ? titleCompare : getEventInstanceKey(a).localeCompare(getEventInstanceKey(b))
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function normalizeCalendarEvent(raw: unknown): CalendarEvent | null {
  if (!isRecord(raw) || !isSafeIdentifier(raw.id) || !isDateKey(raw.startDate)) return null
  const id = raw.id
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim().slice(0, 200)
    : '未命名事件'
  const startDate = raw.startDate
  const endDate = isDateKey(raw.endDate) && raw.endDate >= startDate ? raw.endDate : undefined
  const isAllDay = raw.isAllDay === true
  const startTime = !isAllDay && typeof raw.startTime === 'string' && TIME_RE.test(raw.startTime) ? raw.startTime : undefined
  const endTime = !isAllDay && typeof raw.endTime === 'string' && TIME_RE.test(raw.endTime) ? raw.endTime : undefined
  const recurrenceSource = isRecord(raw.recurrence) ? raw.recurrence : undefined
  const recurrenceFreq = recurrenceSource?.freq
  const recurrence: EventRecurrence | undefined = recurrenceSource
    && (recurrenceFreq === 'daily' || recurrenceFreq === 'weekly' || recurrenceFreq === 'monthly' || recurrenceFreq === 'yearly')
    ? {
        freq: recurrenceFreq,
        interval: clamp(Math.floor(Number(recurrenceSource.interval) || 1), 1, 99),
        ...(recurrenceFreq === 'weekly'
          ? { byWeekday: [...new Set((Array.isArray(recurrenceSource.byWeekday) ? recurrenceSource.byWeekday : [])
              .map(Number)
              .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] }
          : {}),
        ...(recurrenceFreq === 'monthly'
          ? { byMonthDay: [...new Set((Array.isArray(recurrenceSource.byMonthDay) ? recurrenceSource.byMonthDay : [])
              .map(Number)
              .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))] }
          : {}),
        ...(isDateKey(recurrenceSource.until) && recurrenceSource.until >= startDate ? { until: recurrenceSource.until } : {}),
      }
    : undefined
  const reminderSource = isRecord(raw.reminder) ? raw.reminder : null
  const reminder = reminderSource?.enabled === true && (isAllDay || !!startTime)
    ? {
        enabled: true,
        minutesBefore: clamp(Math.floor(Number(reminderSource.minutesBefore) || 0), 0, 365 * 24 * 60),
        playSound: reminderSource.playSound === true,
      }
    : undefined
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()

  return {
    id,
    title,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
    startDate,
    ...(endDate && endDate !== startDate ? { endDate } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    isAllDay,
    color: normalizeHexColor(raw.color),
    ...(isSafeIdentifier(raw.tagId) ? { tagId: raw.tagId } : {}),
    ...(recurrence ? { recurrence } : {}),
    ...(reminder ? { reminder } : {}),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
  }
}

export function normalizeCalendarEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map<string, CalendarEvent>()
  for (const event of raw.map(normalizeCalendarEvent).filter((item): item is CalendarEvent => !!item)) {
    const existing = byId.get(event.id)
    if (!existing || event.updatedAt >= existing.updatedAt) byId.set(event.id, event)
  }
  return [...byId.values()]
}

export function expandEventsInRange(events: CalendarEvent[], rangeStart: string, rangeEnd: string): CalendarEvent[] {
  const supportedRange = getSupportedDateRange(rangeStart, rangeEnd)
  if (!supportedRange) return []
  const { start: effectiveRangeStart, end: effectiveRangeEnd } = supportedRange

  const expanded: CalendarEvent[] = []
  for (const event of events) {
    if (!isDateKey(event.startDate)) continue
    const durationDays = getEventDurationDays(event)

    if (!event.recurrence) {
      const endDate = event.endDate || event.startDate
      if (eventRangeIntersects(event.startDate, endDate, effectiveRangeStart, effectiveRangeEnd)) {
        expanded.push(event)
      }
      continue
    }

    const rangeCandidate = addDaysToDateKey(effectiveRangeStart, -durationDays)
    const firstCandidate = event.startDate > rangeCandidate ? event.startDate : rangeCandidate
    const totalDays = Math.min(Math.max(0, diffDateKeys(firstCandidate, effectiveRangeEnd)) + 1, 3660)

    for (let i = 0; i < totalDays; i += 1) {
      const occurrenceStart = addDaysToDateKey(firstCandidate, i)
      if (!recurrenceMatchesDate(event, occurrenceStart)) continue
      const occurrenceEnd = addDaysToDateKey(occurrenceStart, durationDays)
      if (!eventRangeIntersects(occurrenceStart, occurrenceEnd, effectiveRangeStart, effectiveRangeEnd)) continue
      expanded.push({
        ...event,
        startDate: occurrenceStart,
        endDate: durationDays > 0 ? occurrenceEnd : undefined,
        seriesId: event.id,
        occurrenceDate: occurrenceStart,
        occurrenceKey: `${event.id}__${occurrenceStart}`,
      })
    }
  }
  return expanded
}

export function buildEventsByDate(events: CalendarEvent[], rangeStart: string, rangeEnd: string): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  const supportedRange = getSupportedDateRange(rangeStart, rangeEnd)
  if (!supportedRange) return map
  const expanded = expandEventsInRange(events, supportedRange.start, supportedRange.end)

  for (const event of expanded) {
    const endDate = event.endDate || event.startDate
    const start = event.startDate < supportedRange.start ? supportedRange.start : event.startDate
    const end = endDate > supportedRange.end ? supportedRange.end : endDate
    const days = Math.max(0, diffDateKeys(start, end))
    for (let i = 0; i <= days; i += 1) {
      const dateStr = addDaysToDateKey(start, i)
      const arr = map.get(dateStr) || []
      arr.push(event)
      map.set(dateStr, arr)
    }
  }

  return map
}

export interface CalendarTodoPreview {
  id: string
  noteId: string
  content: string
  sortOrder: number
}

export function buildDailyTodoItemsByDate(notes: Note[], rangeStart: string, rangeEnd: string): Map<string, CalendarTodoPreview[]> {
  const map = new Map<string, CalendarTodoPreview[]>()
  const supportedRange = getSupportedDateRange(rangeStart, rangeEnd)
  if (!supportedRange) return map

  for (const note of notes) {
    if (note.noteType !== 'daily') continue
    for (const item of note.items || []) {
      if (item.isCompleted || !isDateKey(item.todoDate)) continue
      if (item.todoDate < supportedRange.start || item.todoDate > supportedRange.end) continue
      const items = map.get(item.todoDate) || []
      items.push({
        id: item.id,
        noteId: note.id,
        content: item.content.trim() || '未命名待办',
        sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : items.length,
      })
      map.set(item.todoDate, items)
    }
  }

  for (const items of map.values()) {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  }
  return map
}

export function filterEventsByDate(events: CalendarEvent[], dateStr: string): CalendarEvent[] {
  return buildEventsByDate(events, dateStr, dateStr).get(dateStr) || []
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * Normalize a note loaded from disk to ensure all fields have valid values.
 * Handles malformed or incomplete data from older versions.
 */
export function normalizeNote(raw: unknown): Note {
  const n = (isRecord(raw) ? raw : {}) as Record<string, unknown>
  const id = typeof n.id === 'string' && n.id.trim() ? n.id : generateId()
  const ts = typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString()
  const noteType: Note['noteType'] =
    n.noteType === 'echo' || n.noteType === 'view' || n.noteType === 'daily'
      ? n.noteType
      : 'independent'
  const rawItems = Array.isArray(n.items) ? n.items : []
  const seenItemIds = new Set<string>()
  const safeItems = rawItems
    .filter(isRecord)
    .map((item) => {
      const candidate = typeof item.id === 'string' && item.id.trim() && item.id.length <= 200 ? item.id : ''
      const itemId = candidate && !seenItemIds.has(candidate) ? candidate : generateId()
      seenItemIds.add(itemId)
      return {
        id: itemId,
        noteId: id,
        content: typeof item.content === 'string' ? item.content : '',
        isCompleted: !!item.isCompleted,
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
        ...(isDateKey(item.todoDate) ? { todoDate: item.todoDate } : {}),
        ...(typeof item.completedAt === 'string' ? { completedAt: item.completedAt } : {}),
      }
    })
  const viewTagIds = Array.isArray(n.viewTagIds)
    ? n.viewTagIds.filter((tagId): tagId is string => typeof tagId === 'string')
    : (typeof n.echoTagId === 'string' ? [n.echoTagId] : undefined)
  const today = getLocalDateKey()
  const preserved = { ...n }
  delete preserved.revision
  delete preserved.transparency
  delete preserved.fontFamily
  delete preserved.fontSize
  delete preserved.isPinned
  delete preserved.isArchived

  return {
    ...(preserved as Partial<Note>),
    id,
    revision: Number.isInteger(n.revision) && Number(n.revision) >= 0 ? Number(n.revision) : 0,
    noteType,
    items: safeItems as Note['items'],
    ...(typeof n.echoTagId === 'string' ? { echoTagId: n.echoTagId } : { echoTagId: undefined }),
    viewTagIds,
    ...(noteType === 'daily'
      ? {
          dailyTodo: {
            activeDate: isDateKey((n.dailyTodo as Record<string, unknown> | undefined)?.activeDate)
              ? (n.dailyTodo as Record<string, string>).activeDate
              : today,
            lastResetDate: isDateKey((n.dailyTodo as Record<string, unknown> | undefined)?.lastResetDate)
              ? (n.dailyTodo as Record<string, string>).lastResetDate
              : today,
            completedEventOccurrences: Array.isArray((n.dailyTodo as Record<string, unknown> | undefined)?.completedEventOccurrences)
              ? [...new Set(((n.dailyTodo as Record<string, unknown>).completedEventOccurrences as unknown[])
                  .filter((key): key is string => typeof key === 'string' && key.length <= 320))].slice(-20000)
              : [],
          },
        }
      : { dailyTodo: undefined }),
    color: normalizeHexColor(n.color),
    isDocked: typeof n.isDocked === 'boolean' ? n.isDocked : noteType === 'view',
    dockedOrder: typeof n.dockedOrder === 'number' ? n.dockedOrder : undefined,
    isHidden: n.isHidden === true,
    title: typeof n.title === 'string' && n.title.trim() ? n.title : noteType === 'daily' ? '每日待办' : '新便签',
    createdAt: ts,
    updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : ts,
  }
}
