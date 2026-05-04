export interface Note {
  id: string
  title: string
  color: string
  items: NoteItem[]
  transparency: number
  fontFamily: string
  fontSize: number
  isPinned: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface NoteItem {
  id: string
  noteId: string
  content: string
  isCompleted: boolean
  sortOrder: number
  completedAt?: string
}

export interface CountdownItem {
  id: string
  title: string
  targetDate: string // YYYY-MM-DD
  description: string
  createdAt: string
}
