export interface Note {
  id: string
  revision?: number
  title: string
  color: string
  items: NoteItem[]
  noteType: 'independent' | 'echo' | 'view' | 'daily'
  echoTagId?: string
  viewTagIds?: string[]
  dailyTodo?: {
    activeDate?: string
    lastResetDate?: string
    completedEventOccurrences?: string[]
  }
  isDocked?: boolean
  dockedOrder?: number
  isHidden?: boolean
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
