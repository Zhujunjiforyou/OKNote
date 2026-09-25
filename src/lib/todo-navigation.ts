import type { CalendarTodoPreview } from '@/lib/utils'
import { reportPersistenceIssue } from '@/stores/persistence.store'

export async function openTodoSource(todo: CalendarTodoPreview) {
  if (!window.electronAPI) return
  if (todo.noteType === 'daily') {
    window.electronAPI.createNote({ noteType: 'daily', title: '每日待办', activeDate: todo.todoDate })
    return
  }
  try {
    const result = await window.electronAPI.showNote(todo.noteId)
    if (!result.ok) reportPersistenceIssue('便签未打开', result.message || '无法打开待办所在的便签。')
  } catch (error) {
    reportPersistenceIssue('便签未打开', error instanceof Error ? error.message : '请重试。')
  }
}
