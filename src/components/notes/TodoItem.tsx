import { memo, useCallback, useEffect, useState } from 'react'
import { NoteItem as NoteItemType } from '@/types/notes.types'
import { useNotesStore } from '@/stores/notes.store'
import { CalendarDays, Check, Trash2 } from '@/components/ui/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useUndoStore } from '@/stores/undo.store'
import { isDateKey, isImeComposing, isTodoOverdue } from '@/lib/utils'
import { useCurrentDateKey } from '@/hooks/useCurrentDateKey'

interface TodoItemProps {
  item: NoteItemType
  noteId: string
  noteColor: string
  onDraftChange?: (itemId: string, dirty: boolean) => void
  allowUnscheduled?: boolean
  showDate?: boolean
}

export const TodoItem = memo(function TodoItem({ item, noteId, noteColor, onDraftChange, allowUnscheduled = true, showDate = true }: TodoItemProps) {
  const toggleItem = useNotesStore((s) => s.toggleItem)
  const deleteItem = useNotesStore((s) => s.deleteItem)
  const restoreItem = useNotesStore((s) => s.restoreItem)
  const updateItemContent = useNotesStore((s) => s.updateItemContent)
  const updateItemDate = useNotesStore((s) => s.updateItemDate)
  const today = useCurrentDateKey()
  const overdue = isTodoOverdue(item, today)
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState(item.todoDate || '')
  const addUndo = useUndoStore((s) => s.add)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useCallback((input: HTMLInputElement | null) => {
    input?.focus()
    input?.select()
  }, [])
  const reduceMotion = useReducedMotion()
  const dirty = (editing && draft !== item.content) || (editingDate && dateDraft !== (item.todoDate || ''))

  useEffect(() => {
    onDraftChange?.(item.id, dirty)
  }, [dirty, item.id, onDraftChange])

  useEffect(() => () => onDraftChange?.(item.id, false), [item.id, onDraftChange])

  const startEdit = () => {
    if (item.isCompleted) return
    setDraft(item.content)
    setEditing(true)
  }
  const saveEdit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== item.content) {
      updateItemContent(noteId, item.id, trimmed)
    }
    setEditing(false)
  }
  const handleDelete = () => {
    const currentNote = useNotesStore.getState().notes.find((note) => note.id === noteId)
    const index = currentNote?.items.findIndex((entry) => entry.id === item.id) ?? -1
    const deleted = deleteItem(noteId, item.id)
    if (!deleted) return
    addUndo(`已删除“${deleted.content}”`, () => restoreItem(noteId, deleted, index))
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.15 }}
      className="note-todo-item group flex min-w-0 items-center gap-1 px-1 py-0.5"
      data-overdue={overdue || undefined}
    >
      {/* Checkbox - fixed size for consistent alignment */}
      <button
        onClick={() => toggleItem(noteId, item.id)}
        className={`todo-item-control flex shrink-0 items-center justify-center rounded-md border-2 transition-all ${
          item.isCompleted
            ? 'bg-primary border-primary'
            : 'border-muted-foreground/30 hover:border-primary/50'
        }`}
        aria-label={item.isCompleted ? `将“${item.content}”标记为未完成` : `完成“${item.content}”`}
        role="checkbox"
        aria-checked={item.isCompleted}
      >
        {item.isCompleted && <Check size={10} className="text-primary-foreground" />}
      </button>

      {/* Content - click to edit */}
      <div className="min-w-0 flex-1">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return
            if (e.key === 'Enter') saveEdit()
            if (e.key === 'Escape') setEditing(false)
          }}
          maxLength={2000}
          aria-label="编辑待办内容"
          className="w-full bg-white/5 rounded px-1 py-0 text-[0.95em] outline-none min-w-0"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          disabled={item.isCompleted}
          className={`w-full min-w-0 flex-1 cursor-default whitespace-pre-wrap break-words text-left text-[0.95em] leading-snug transition-colors ${
            item.isCompleted ? 'task-completed' : overdue ? 'task-overdue hover:cursor-text' : 'hover:cursor-text'
          }`}
          style={{
            textDecorationColor: item.isCompleted ? noteColor : undefined,
            textDecorationThickness: '1.5px',
          }}
          title={item.isCompleted ? undefined : '点击编辑'}
        >
          {item.content}
        </button>
      )}
      {showDate && item.todoDate && !editingDate && <button
        type="button"
        className={`flex max-w-full flex-wrap items-baseline gap-x-1 text-left text-[0.72em] leading-normal ${overdue ? 'task-overdue' : 'text-muted-foreground'}`}
        onClick={() => { setDateDraft(item.todoDate || ''); setEditingDate(true) }}
        aria-label={`更改“${item.content}”的日期，当前 ${item.todoDate}`}
      >
        <span className="max-w-full">{item.todoDate}</span>
        {overdue && <span className="whitespace-nowrap">· 已过期</span>}
      </button>}
      {editingDate && <div className="todo-date-editor mt-1 flex min-w-0 flex-wrap items-center gap-1">
        <input type="date" value={dateDraft} min="1900-01-01" max="2100-12-31"
          aria-label={`“${item.content}”的日历日期`}
          onChange={(e) => setDateDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setEditingDate(false)
            if (e.key === 'Enter' && isDateKey(dateDraft)) { updateItemDate(noteId, item.id, dateDraft); setEditingDate(false) }
          }}
          className="min-w-0 max-w-full rounded border border-border bg-background px-1 py-0.5 text-[0.8em]"
        />
        <button type="button" disabled={!isDateKey(dateDraft)} className="touch-target text-[0.75em] text-primary disabled:opacity-40"
          onClick={() => { updateItemDate(noteId, item.id, dateDraft); setEditingDate(false) }}>确定日期</button>
        {allowUnscheduled && item.todoDate && <button type="button" className="touch-target text-[0.75em] text-muted-foreground"
          onClick={() => { updateItemDate(noteId, item.id); setEditingDate(false) }}>移出日历</button>}
        <button type="button" className="touch-target text-[0.75em] text-muted-foreground" onClick={() => setEditingDate(false)}>取消</button>
      </div>}
      </div>

      <button type="button" className="todo-item-control flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        onClick={() => { setDateDraft(item.todoDate || today); setEditingDate(!editingDate) }}
        aria-label={`${item.todoDate ? '更改日期' : '安排到日历'}：${item.content}`}
        title={item.todoDate ? `日历日期：${item.todoDate}` : '安排到日历'}><CalendarDays size={13} /></button>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        className="todo-item-control flex shrink-0 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-destructive"
        aria-label={`删除“${item.content}”`}
      >
        <Trash2 size={12} />
      </button>
    </motion.div>
  )
})
