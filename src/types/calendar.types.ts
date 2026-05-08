export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface EventRecurrence {
  freq: RecurrenceFrequency
  interval: number
  byWeekday?: number[] // 0-6, Sunday-Saturday
  byMonthDay?: number[]
  until?: string // YYYY-MM-DD
}

export interface EventReminder {
  enabled: boolean
  minutesBefore: number
  playSound?: boolean
}

export interface CalendarEvent {
  id: string
  title: string
  description: string
  startDate: string // YYYY-MM-DD
  endDate?: string
  startTime?: string // HH:mm
  endTime?: string
  isAllDay: boolean
  color: string
  tagId?: string
  recurrence?: EventRecurrence
  reminder?: EventReminder
  occurrenceKey?: string
  seriesId?: string
  occurrenceDate?: string
  createdAt: string
  updatedAt: string
}
