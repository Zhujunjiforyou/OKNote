import { memo, type ReactNode } from 'react'
import type { CalendarEvent } from '@/types/calendar.types'
import type { CalendarTodoPreview } from '@/lib/utils'
import { useTagStore } from '@/stores/tag.store'
import { TodoItem } from '@/components/notes/TodoItem'
import { EventCompletionButton } from './EventCompletionButton'
import { openTodoSource } from '@/lib/todo-navigation'

export const AgendaEventRow = memo(function AgendaEventRow({ event, completed, onOpen, children }: {
  event: CalendarEvent; completed: boolean; onOpen: () => void; children?: ReactNode
}) {
  const tag = useTagStore((state) => state.tags.find((tag) => tag.id === event.tagId))
  return <div className="agenda-event-row daily-recurring-item">
    <EventCompletionButton event={event} completed={completed} />
    <button type="button" className="agenda-event-open view-event-item" onClick={onOpen} aria-label={`打开事件：${event.title}`}>
      <span className={`agenda-title ${completed ? 'task-completed' : ''}`}>{event.title}</span>
      <span className="agenda-meta">
        <span className="agenda-time">{event.isAllDay ? '全天' : `${event.startTime || '未设时间'}${event.endTime ? ' – ' + event.endTime : ''}`}</span>
        {tag && <span className="agenda-tag"><i style={{ backgroundColor:tag.color }} />{tag.name}</span>}
        {event.recurrence && <span>循环</span>}
        {event.endDate && event.endDate !== event.startDate && <span>{event.startDate} 至 {event.endDate}</span>}
        {children}
      </span>
    </button>
  </div>
})

export const AgendaTodoRow = memo(function AgendaTodoRow({ todo, onDraftChange, onOpenSource }: {
  todo: CalendarTodoPreview; onDraftChange?: (id: string, dirty: boolean) => void; onOpenSource?: () => void
}) {
  return <div className="agenda-todo-row view-todo-item">
    <TodoItem item={todo} noteId={todo.noteId} noteColor={todo.noteColor} showDate={false} allowUnscheduled={todo.noteType !== 'daily'} onDraftChange={onDraftChange} />
    {todo.noteType !== 'daily' && <button type="button" className="agenda-source" onClick={onOpenSource || (() => { void openTodoSource(todo) })}
      aria-label={`打开待办：${todo.content}`} title={`打开来源便签：${todo.noteTitle}`}>
      {todo.noteTitle || '未命名便签'}
    </button>}
  </div>
})
