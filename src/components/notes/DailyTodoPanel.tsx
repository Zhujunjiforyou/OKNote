import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RotateCcw } from 'lucide-react'
import type { Note } from '@/types/notes.types'
import { TodoItem } from '@/components/notes/TodoItem'
import { useNotesStore } from '@/stores/notes.store'
import { addDaysToDateKey, getLocalDateKey } from '@/lib/utils'

interface DailyTodoPanelProps {
  note: Note
  compact?: boolean
  panelBg: string
  panelBorder: string
  textColor: string
  mutedColor: string
  lightBg: boolean
}

function labelForDate(dateStr: string): string {
  const today = getLocalDateKey()
  if (dateStr === today) return '今天'
  const [, month = '', day = ''] = dateStr.split('-')
  return month && day ? `${Number(month)}月${Number(day)}日` : dateStr
}

function formatDisplayDate(dateStr: string): { year: string; monthDay: string; weekday: string } {
  const [year = '', month = '', day = ''] = dateStr.split('-')
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return {
    year,
    monthDay: month && day ? `${Number(month)}月${Number(day)}日` : dateStr,
    weekday: Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', { weekday: 'short' }) : '',
  }
}

function sortItems<T extends { sortOrder: number; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder)
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function DailyTodoPanel({ note, compact = false, panelBg, panelBorder, textColor, mutedColor, lightBg }: DailyTodoPanelProps) {
  const updateNote = useNotesStore((s) => s.updateNote)
  const addItem = useNotesStore((s) => s.addItem)
  const today = getLocalDateKey()
  const savedActiveDate = note.dailyTodo?.activeDate
  const [activeDate, setActiveDate] = useState(savedActiveDate || today)
  const [newTodo, setNewTodo] = useState('')
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState(activeDate)

  useEffect(() => {
    if (savedActiveDate && savedActiveDate !== activeDate) {
      setActiveDate(savedActiveDate)
    }
  }, [activeDate, savedActiveDate])

  useEffect(() => {
    if (note.noteType !== 'daily') return
    if (note.dailyTodo?.lastResetDate === today && note.dailyTodo?.activeDate) return
    updateNote({
      ...note,
      dailyTodo: {
        ...note.dailyTodo,
        activeDate: today,
        lastResetDate: today,
      },
      updatedAt: new Date().toISOString(),
    })
    setActiveDate(today)
  }, [note, today, updateNote])

  const dailyItems = useMemo(() => {
    return sortItems((note.items || []).filter((item) => item.todoDate === activeDate))
  }, [activeDate, note.items])

  const previousUnfinished = useMemo(() => {
    return (note.items || [])
      .filter((item) => item.todoDate && item.todoDate < today && !item.isCompleted)
      .sort((a, b) => (b.todoDate || '').localeCompare(a.todoDate || '') || a.sortOrder - b.sortOrder)
  }, [note.items, today])

  const switchDate = (dateStr: string) => {
    setActiveDate(dateStr)
    updateNote({
      ...note,
      dailyTodo: {
        ...note.dailyTodo,
        activeDate: dateStr,
        lastResetDate: note.dailyTodo?.lastResetDate || today,
      },
      updatedAt: new Date().toISOString(),
    })
  }

  const handleAddTodo = () => {
    const content = newTodo.trim()
    if (!content) return
    addItem(note.id, content, { todoDate: activeDate })
    setNewTodo('')
  }

  const latestUnfinishedDate = previousUnfinished[0]?.todoDate
  const completedCount = dailyItems.filter((item) => item.isCompleted).length
  const displayDate = formatDisplayDate(activeDate)

  const startEditDate = () => {
    setDateDraft(activeDate)
    setEditingDate(true)
  }

  const commitDateDraft = () => {
    const next = dateDraft.trim()
    if (isDateKey(next)) switchDate(next)
    else setDateDraft(activeDate)
    setEditingDate(false)
  }

  return (
    <>
      <div
        className={`daily-todo-panel relative flex-1 min-h-0 flex flex-col ${compact ? 'daily-todo-panel-compact overflow-y-auto overflow-x-hidden px-2 pb-0.5' : 'overflow-hidden px-3 py-1.5'}`}
        data-note-wheel-scroll
        onWheel={(event) => event.stopPropagation()}
      >
        <div
          className={`daily-date-switch flex items-stretch gap-1 rounded-md border ${compact ? 'daily-date-switch-compact mb-1 px-1 py-0.5' : 'mb-1.5 px-2 py-1.5'}`}
          style={{ backgroundColor: panelBg, borderColor: panelBorder, color: textColor }}
        >
          <button
            onClick={() => switchDate(addDaysToDateKey(activeDate, -1))}
            className={`daily-nav-button h-auto rounded-md flex items-center justify-center opacity-60 hover:opacity-90 ${compact ? 'w-6' : 'w-7'}`}
            title="前一天"
          >
            <ChevronLeft size={compact ? 12 : 14} />
          </button>
          {editingDate ? (
            <input
              value={dateDraft}
              onChange={(event) => setDateDraft(event.target.value)}
              onBlur={commitDateDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitDateDraft()
                if (event.key === 'Escape') {
                  setDateDraft(activeDate)
                  setEditingDate(false)
                }
              }}
              className={`daily-date-display min-w-0 flex-1 rounded-md text-center text-[0.82em] font-semibold outline-none ${compact ? 'daily-date-display-compact px-1 py-0.5' : 'px-2 py-1'}`}
              style={{ color: textColor }}
              placeholder="YYYY-MM-DD"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={startEditDate}
              className={`daily-date-display min-w-0 flex-1 rounded-md text-center ${compact ? 'daily-date-display-compact px-1 py-0.5' : 'px-2 py-1'}`}
              title="点击输入日期"
            >
              {compact ? (
                <span className="whitespace-nowrap text-[0.94em] font-semibold leading-none">
                  {displayDate.monthDay}
                </span>
              ) : (
                <span className="flex min-w-0 items-center justify-center gap-1.5">
                  <CalendarDays size={12} className="shrink-0 opacity-55" />
                  <span className="min-w-0 truncate">
                    <span className="mr-1 text-[0.62em] opacity-55">{displayDate.year}</span>
                    <span className="text-[0.98em] font-semibold">
                      {displayDate.monthDay}
                    </span>
                    <span className="ml-1 text-[0.66em] opacity-60">{displayDate.weekday}</span>
                  </span>
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => switchDate(addDaysToDateKey(activeDate, 1))}
            className={`daily-nav-button h-auto rounded-md flex items-center justify-center opacity-60 hover:opacity-90 ${compact ? 'w-6' : 'w-7'}`}
            title="后一天"
          >
            <ChevronRight size={compact ? 12 : 14} />
          </button>
          {activeDate !== today && (
            <button
              onClick={() => switchDate(today)}
              className={`daily-today-button rounded-md opacity-60 hover:opacity-90 ${compact ? 'flex w-6 items-center justify-center px-0' : 'px-1.5 text-[0.66em]'}`}
              title="回到今天"
            >
              {compact ? <RotateCcw size={11} /> : '今天'}
            </button>
          )}
        </div>

        <div className={`daily-progress-row flex items-center justify-between ${compact ? 'mb-1 px-0.5 text-[0.58em]' : 'mb-1.5 px-1 text-[0.62em]'}`} style={{ color: mutedColor }}>
          <span>{activeDate === today ? '今日进度' : '当日进度'}</span>
          <span>{completedCount}/{dailyItems.length}</span>
        </div>

        {activeDate === today && previousUnfinished.length > 0 && latestUnfinishedDate && (
          <button
            onClick={() => switchDate(latestUnfinishedDate)}
            className={`w-full rounded-md border text-left ${compact ? 'mb-1 px-2 py-0.5 text-[0.64em]' : 'mb-1.5 px-2.5 py-1.5 text-[0.72em]'}`}
            style={{ backgroundColor: panelBg, borderColor: panelBorder, color: mutedColor }}
          >
            历史未完成 {previousUnfinished.length} 项 · 最近 {labelForDate(latestUnfinishedDate)}
          </button>
        )}

        <div
          className={`daily-list flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${compact ? 'space-y-0.5' : 'space-y-1'}`}
          data-note-wheel-scroll
          onWheel={(event) => event.stopPropagation()}
        >
          {dailyItems.map((item) => (
            <TodoItem key={item.id} item={item} note={note} />
          ))}
          {dailyItems.length === 0 && (
            <div className={`${compact ? 'py-5 text-[0.68em]' : 'py-8 text-[0.78em]'} daily-empty text-center`} style={{ color: mutedColor }}>
              <div className="daily-empty-date mx-auto mb-2 flex items-center justify-center rounded-md border text-[0.82em]" style={{ borderColor: panelBorder }}>
                {displayDate.monthDay}
              </div>
              <div>{labelForDate(activeDate)}无待办</div>
            </div>
          )}
        </div>
      </div>

      <div className={`daily-composer-wrap relative shrink-0 ${compact ? 'px-2 py-1' : 'px-3 pb-2.5 pt-1'}`}>
        <div
          className={`daily-composer note-composer-control flex items-center gap-2 border rounded-md transition-colors ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'}`}
          style={{
            backgroundColor: panelBg,
            borderColor: panelBorder,
          }}
        >
          <button
            type="button"
            onClick={handleAddTodo}
            className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-opacity"
            style={{ opacity: 0.7, backgroundColor: lightBg ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.14)' }}
            title="添加"
          >
            <Plus size={12} />
          </button>
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTodo() }}
            placeholder={`${labelForDate(activeDate)}待办...`}
            className="flex-1 bg-transparent text-[0.82em] outline-none placeholder:opacity-70"
            style={{ color: textColor }}
          />
          {activeDate !== today && (
            <button
              type="button"
              onClick={() => switchDate(today)}
              className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center opacity-55 hover:opacity-85"
              title="回到今天"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      </div>
    </>
  )
}
