import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CalendarEvent } from "@/types/calendar.types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function hexToLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
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
