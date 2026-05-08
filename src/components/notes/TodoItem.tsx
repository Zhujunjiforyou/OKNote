import { useState, useRef } from 'react'
import { Note, NoteItem as NoteItemType } from '@/types/notes.types'
import { useNotesStore } from '@/stores/notes.store'
import { Check, Trash2 } from 'lucide-react'
import { motion } from 'framer-motion'

interface TodoItemProps {
  item: NoteItemType
  note: Note
}

export function TodoItem({ item, note }: TodoItemProps) {
  const toggleItem = useNotesStore((s) => s.toggleItem)
  const deleteItem = useNotesStore((s) => s.deleteItem)
  const updateItemContent = useNotesStore((s) => s.updateItemContent)
  const [isHovered, setIsHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="note-todo-item flex items-center gap-2 group py-1 px-1.5 min-w-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Checkbox - fixed size for consistent alignment */}
      <button
        onClick={() => toggleItem(note.id, item.id)}
        className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
          item.isCompleted
            ? 'bg-primary border-primary'
            : 'border-muted-foreground/30 hover:border-primary/50'
        }`}
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
          className="flex-1 bg-white/5 rounded px-1 py-0 text-[0.95em] outline-none min-w-0"
        />
      ) : (
        <span
          onClick={startEdit}
          className={`text-[0.95em] flex-1 leading-relaxed break-all min-w-0 cursor-default transition-colors ${
            item.isCompleted ? 'line-through opacity-45' : 'hover:cursor-text'
          }`}
          style={{
            textDecorationColor: item.isCompleted ? note.color : undefined,
            textDecorationThickness: '1.5px',
          }}
          title={item.isCompleted ? undefined : '点击编辑'}
        >
          {item.content}
        </span>
      )}

      {/* Delete button */}
      {isHovered && (
        <button
          onClick={() => deleteItem(note.id, item.id)}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-muted-foreground/40 hover:text-destructive transition-colors"
        >
          <Trash2 size={12} />
        </button>
      )}
    </motion.div>
  )
}
