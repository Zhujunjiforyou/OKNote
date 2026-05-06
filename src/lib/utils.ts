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

const DEFAULT_NOTE_COLOR = '#6366f1'
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

export function filterEventsByDate(events: CalendarEvent[], dateStr: string): CalendarEvent[] {
  return events.filter((e) => {
    if (!e.endDate || e.endDate === e.startDate) return e.startDate === dateStr
    return dateStr >= e.startDate && dateStr <= e.endDate
  })
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
    n.noteType === 'echo' || n.noteType === 'view' ? n.noteType : 'independent'
  const rawItems = Array.isArray(n.items) ? n.items : []
  const safeItems = rawItems
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      noteId: typeof item.noteId === 'string' ? item.noteId : id,
      content: typeof item.content === 'string' ? item.content : '',
      isCompleted: !!item.isCompleted,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
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

  return {
    ...(n as Partial<Note>),
    id,
    noteType,
    items: safeItems as Note['items'],
    ...(typeof n.echoTagId === 'string' ? { echoTagId: n.echoTagId } : { echoTagId: undefined }),
    viewTagIds,
    color: normalizeHexColor(n.color),
    transparency,
    fontFamily: typeof n.fontFamily === 'string' ? n.fontFamily : 'Microsoft YaHei',
    fontSize,
    isDocked: typeof n.isDocked === 'boolean' ? n.isDocked : noteType === 'view',
    dockedOrder: typeof n.dockedOrder === 'number' ? n.dockedOrder : undefined,
    isHidden: n.isHidden === true,
    isPinned: !!n.isPinned,
    isArchived: !!n.isArchived,
    title: typeof n.title === 'string' && n.title.trim() ? n.title : '新便签',
    createdAt: ts,
    updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : ts,
  }
}
