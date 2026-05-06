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
  createdAt: string
  updatedAt: string
}
