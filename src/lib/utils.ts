import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CalendarEvent } from "@/types/calendar.types"
import type { Note } from "@/types/notes.types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return crypto.randomUUID()
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
  const r = parseInt(safeHex.slice(1, 3), 16)
  const g = parseInt(safeHex.slice(3, 5), 16)
  const b = parseInt(safeHex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export function isLightColor(hex: string): boolean {
  return hexToLuminance(hex) > 0.5
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_KEY_RE.test(value)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function dateKeyToUtcDay(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

function formatUtcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

export function addDaysToDateKey(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return formatUtcDateKey(date)
}

export function diffDateKeys(startDate: string, endDate: string): number {
  return dateKeyToUtcDay(endDate) - dateKeyToUtcDay(startDate)
}

function getDateKeyWeekday(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
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

export function getEventInstanceKey(event: CalendarEvent): string {
  return event.occurrenceKey || event.id
}

export function expandEventsInRange(events: CalendarEvent[], rangeStart: string, rangeEnd: string): CalendarEvent[] {
  if (!isDateKey(rangeStart) || !isDateKey(rangeEnd) || rangeEnd < rangeStart) return []

  const expanded: CalendarEvent[] = []
  for (const event of events) {
    if (!isDateKey(event.startDate)) continue
    const durationDays = getEventDurationDays(event)

    if (!event.recurrence) {
      const endDate = event.endDate || event.startDate
      if (eventRangeIntersects(event.startDate, endDate, rangeStart, rangeEnd)) {
        expanded.push(event)
      }
      continue
    }

    const rangeCandidate = addDaysToDateKey(rangeStart, -durationDays)
    const firstCandidate = event.startDate > rangeCandidate ? event.startDate : rangeCandidate
    const totalDays = Math.min(Math.max(0, diffDateKeys(firstCandidate, rangeEnd)) + 1, 3660)

    for (let i = 0; i < totalDays; i += 1) {
      const occurrenceStart = addDaysToDateKey(firstCandidate, i)
      if (!recurrenceMatchesDate(event, occurrenceStart)) continue
      const occurrenceEnd = addDaysToDateKey(occurrenceStart, durationDays)
      if (!eventRangeIntersects(occurrenceStart, occurrenceEnd, rangeStart, rangeEnd)) continue
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
  const expanded = expandEventsInRange(events, rangeStart, rangeEnd)

  for (const event of expanded) {
    const endDate = event.endDate || event.startDate
    const start = event.startDate < rangeStart ? rangeStart : event.startDate
    const end = endDate > rangeEnd ? rangeEnd : endDate
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
  const id = typeof n.id === 'string' && n.id.trim() ? n.id : crypto.randomUUID()
  const ts = typeof n.createdAt === 'string' ? n.createdAt : new Date().toISOString()
  const noteType: Note['noteType'] =
    n.noteType === 'echo' || n.noteType === 'view' || n.noteType === 'daily'
      ? n.noteType
      : 'independent'
  const rawItems = Array.isArray(n.items) ? n.items : []
  const safeItems = rawItems
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      noteId: typeof item.noteId === 'string' ? item.noteId : id,
      content: typeof item.content === 'string' ? item.content : '',
      isCompleted: !!item.isCompleted,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
      ...(isDateKey(item.todoDate) ? { todoDate: item.todoDate } : {}),
      ...(typeof item.completedAt === 'string' ? { completedAt: item.completedAt } : {}),
    }))
  const viewTagIds = Array.isArray(n.viewTagIds)
    ? n.viewTagIds.filter((tagId): tagId is string => typeof tagId === 'string')
    : (typeof n.echoTagId === 'string' ? [n.echoTagId] : undefined)
  const transparency = typeof n.transparency === 'number' && Number.isFinite(n.transparency)
    ? clamp(n.transparency, 0.35, 1)
    : 0.88
  const fontSize = typeof n.fontSize === 'number' && Number.isFinite(n.fontSize)
    ? clamp(n.fontSize, 10, 28)
    : 14
  const today = getLocalDateKey()

  return {
    ...(n as Partial<Note>),
    id,
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
          },
        }
      : { dailyTodo: undefined }),
    color: normalizeHexColor(n.color),
    transparency,
    fontFamily: typeof n.fontFamily === 'string' ? n.fontFamily : 'Microsoft YaHei',
    fontSize,
    isDocked: typeof n.isDocked === 'boolean' ? n.isDocked : noteType === 'view',
    dockedOrder: typeof n.dockedOrder === 'number' ? n.dockedOrder : undefined,
    isHidden: n.isHidden === true,
    isPinned: !!n.isPinned,
    isArchived: !!n.isArchived,
    title: typeof n.title === 'string' && n.title.trim() ? n.title : noteType === 'daily' ? '每日待办' : '新便签',
    createdAt: ts,
    updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : ts,
  }
}
