import { useEffect, useState, useRef } from 'react'
import { Note, NoteItem as NoteItemType } from '@/types/notes.types'
import { useNotesStore } from '@/stores/notes.store'
import { Check, Trash2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useUndoStore } from '@/stores/undo.store'

interface TodoItemProps {
  item: NoteItemType
  note: Note
  onDraftChange?: (itemId: string, dirty: boolean) => void
}

export function TodoItem({ item, note, onDraftChange }: TodoItemProps) {
  const toggleItem = useNotesStore((s) => s.toggleItem)
  const deleteItem = useNotesStore((s) => s.deleteItem)
  const restoreItem = useNotesStore((s) => s.restoreItem)
  const updateItemContent = useNotesStore((s) => s.updateItemContent)
  const addUndo = useUndoStore((s) => s.add)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const reduceMotion = useReducedMotion()
  const dirty = editing && draft !== item.content

  useEffect(() => {
    onDraftChange?.(item.id, dirty)
  }, [dirty, item.id, onDraftChange])

  useEffect(() => () => onDraftChange?.(item.id, false), [item.id, onDraftChange])

  const startEdit = () => {
    if (item.isCompleted) return
    setDraft(item.content)
    setEditing(true)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
  }
  const saveEdit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== item.content) {
      updateItemContent(note.id, item.id, trimmed)
    }
    setEditing(false)
  }
  const handleDelete = () => {
    const index = note.items.findIndex((entry) => entry.id === item.id)
    const deleted = deleteItem(note.id, item.id)
    if (!deleted) return
    addUndo(`已删除“${deleted.content}”`, () => restoreItem(note.id, deleted, index))
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.15 }}
      className="note-todo-item group flex min-w-0 items-center gap-1.5 px-1 py-0.5"
    >
      {/* Checkbox - fixed size for consistent alignment */}
      <button
        onClick={() => toggleItem(note.id, item.id)}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
          item.isCompleted
            ? 'bg-primary border-primary'
            : 'border-muted-foreground/30 hover:border-primary/50'
        }`}
        aria-label={item.isCompleted ? `将“${item.content}”标记为未完成` : `完成“${item.content}”`}
      >
        {item.isCompleted && <Check size={10} className="text-primary-foreground" />}
      </button>

      {/* Content - click to edit */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit()
            if (e.key === 'Escape') setEditing(false)
          }}
          maxLength={2000}
          aria-label="编辑待办内容"
          className="flex-1 bg-white/5 rounded px-1 py-0 text-[0.95em] outline-none min-w-0"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          disabled={item.isCompleted}
          className={`min-w-0 flex-1 cursor-default break-all text-left text-[0.95em] leading-snug transition-colors ${
            item.isCompleted ? 'line-through opacity-45' : 'hover:cursor-text'
          }`}
          style={{
            textDecorationColor: item.isCompleted ? note.color : undefined,
            textDecorationThickness: '1.5px',
          }}
          title={item.isCompleted ? undefined : '点击编辑'}
        >
          {item.content}
        </button>
      )}

      {/* Delete button */}
      <button
        onClick={handleDelete}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-destructive"
        aria-label={`删除“${item.content}”`}
      >
        <Trash2 size={12} />
      </button>
    </motion.div>
  )
}
