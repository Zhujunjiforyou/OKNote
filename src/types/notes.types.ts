export interface Note {
  id: string
  title: string
  color: string
  items: NoteItem[]
  transparency: number
  fontFamily: string
  fontSize: number
  noteType: 'independent' | 'echo' | 'view' | 'daily'
  echoTagId?: string
  viewTagIds?: string[]
  dailyTodo?: {
    activeDate?: string
    lastResetDate?: string
  }
  isDocked?: boolean
  dockedOrder?: number
  isHidden?: boolean
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
  todoDate?: string
  completedAt?: string
}

export interface CountdownItem {
  id: string
  title: string
  targetDate: string // YYYY-MM-DD
  description: string
  createdAt: string
}
