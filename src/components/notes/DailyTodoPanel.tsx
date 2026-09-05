import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, Repeat2, RotateCcw } from 'lucide-react'
import type { Note } from '@/types/notes.types'
import { TodoItem } from '@/components/notes/TodoItem'
import { useNotesStore } from '@/stores/notes.store'
import { useCalendarStore } from '@/stores/calendar.store'
import type { CalendarEvent } from '@/types/calendar.types'
import {
  addDaysToDateKey,
  filterEventsByDate,
  getEventInstanceKey,
  isDateKey,
  isImeComposing,
  MAX_SUPPORTED_DATE_KEY,
  MIN_SUPPORTED_DATE_KEY,
  normalizeCalendarEvents,
  normalizeHexColor,
} from '@/lib/utils'
import { useCurrentDateKey } from '@/hooks/useCurrentDateKey'
import { reportPersistenceIssue } from '@/stores/persistence.store'

interface DailyTodoPanelProps {
  note: Note
  compact?: boolean
  panelBg: string
  panelBorder: string
  textColor: string
  mutedColor: string
  lightBg: boolean
  onDraftChange?: (key: string, kind: 'new-todo' | 'todo-edit' | 'date-edit', dirty: boolean) => void
}

function labelForDate(dateStr: string, today: string): string {
  if (dateStr === today) return '今天'
  const [, month = '', day = ''] = dateStr.split('-')
  return month && day ? `${Number(month)}月${Number(day)}日` : dateStr
}

function formatDisplayDate(dateStr: string): { year: string; monthDay: string; weekday: string } {
  const [year = '', month = '', day = ''] = dateStr.split('-')
  const date = new Date(0)
  date.setHours(0, 0, 0, 0)
  date.setFullYear(Number(year), Number(month) - 1, Number(day))
  return {
    year: year ? `${year}年` : '',
    monthDay: month && day ? `${Number(month)}月${Number(day)}日` : dateStr,
    weekday: Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', { weekday: 'short' }) : '',
  }
}

function sortItems<T extends { sortOrder: number; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function DailyTodoPanel({ note, compact = false, panelBg, panelBorder, textColor, mutedColor, lightBg, onDraftChange }: DailyTodoPanelProps) {
  const updateNote = useNotesStore((s) => s.updateNote)
  const addItem = useNotesStore((s) => s.addItem)
  const events = useCalendarStore((s) => s.events)
  const loadEvents = useCalendarStore((s) => s.loadEvents)
  const today = useCurrentDateKey()
  const configuredActiveDate = note.dailyTodo?.activeDate
  const savedActiveDate = isDateKey(configuredActiveDate) ? configuredActiveDate : undefined
  const [activeDate, setActiveDate] = useState(savedActiveDate || today)
  const [newTodo, setNewTodo] = useState('')
  const [itemDrafts, setItemDrafts] = useState<Record<string, true>>({})
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState(activeDate)
  const hasContentDrafts = newTodo.trim().length > 0 || Object.keys(itemDrafts).length > 0
  const dateDraftDirty = editingDate && dateDraft !== activeDate
  const hasLocalDrafts = hasContentDrafts || dateDraftDirty

  useEffect(() => {
    onDraftChange?.('daily-composer', 'new-todo', newTodo.trim().length > 0)
  }, [newTodo, onDraftChange])

  useEffect(() => () => onDraftChange?.('daily-composer', 'new-todo', false), [onDraftChange])

  useEffect(() => {
    onDraftChange?.('daily-date', 'date-edit', dateDraftDirty)
  }, [dateDraftDirty, onDraftChange])

  useEffect(() => () => onDraftChange?.('daily-date', 'date-edit', false), [onDraftChange])

  const handleItemDraftChange = useCallback((itemId: string, dirty: boolean) => {
    setItemDrafts((current) => {
      if (dirty && current[itemId]) return current
      if (!dirty && !current[itemId]) return current
      const next = { ...current }
      if (dirty) next[itemId] = true
      else delete next[itemId]
      return next
    })
    onDraftChange?.(`todo:${itemId}`, 'todo-edit', dirty)
  }, [onDraftChange])

  useEffect(() => {
    if (!hasLocalDrafts && savedActiveDate && savedActiveDate !== activeDate) {
      setActiveDate(savedActiveDate)
    }
  }, [activeDate, hasLocalDrafts, savedActiveDate])

  useEffect(() => {
    if (note.noteType !== 'daily') return
    if (note.dailyTodo?.lastResetDate === today && note.dailyTodo?.activeDate) return
    if (hasLocalDrafts) return
    const currentNote = useNotesStore.getState().notes.find((item) => item.id === note.id) || note
    updateNote({
      ...currentNote,
      dailyTodo: {
        ...currentNote.dailyTodo,
        activeDate: today,
        lastResetDate: today,
      },
      updatedAt: new Date().toISOString(),
    })
    setActiveDate(today)
  }, [hasLocalDrafts, note, today, updateNote])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    let cancelled = false
    const reloadEvents = () => {
      window.electronAPI!.getEventsState().then((data) => {
        if (data.loadError) reportPersistenceIssue('事件数据无法读取', data.loadError)
        if (!cancelled && Array.isArray(data.events)) loadEvents(normalizeCalendarEvents(data.events), data.revision)
      }).catch((error) => reportPersistenceIssue('事件读取失败', error instanceof Error ? error.message : '无法读取事件数据。', reloadEvents))
    }
    reloadEvents()
    const unsubscribe = window.electronAPI.onEventsChanged((data) => {
      if (Array.isArray(data?.events)) {
        loadEvents(normalizeCalendarEvents(data.events), Number(data.revision) || 0)
        return
      }
      reloadEvents()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [loadEvents])

  const dailyItems = useMemo(() => {
    return sortItems((note.items || []).filter((item) => item.todoDate === activeDate))
  }, [activeDate, note.items])

  const completedEventOccurrences = useMemo(
    () => new Set(note.dailyTodo?.completedEventOccurrences || []),
    [note.dailyTodo?.completedEventOccurrences],
  )

  const recurringEvents = useMemo(() => {
    return filterEventsByDate(events, activeDate)
      .filter((event) => event.recurrence)
      .sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1
        return (a.startTime || '').localeCompare(b.startTime || '') || a.title.localeCompare(b.title, 'zh-CN')
      })
  }, [activeDate, events])

  const previousUnfinished = useMemo(() => {
    return (note.items || [])
      .filter((item) => item.todoDate && item.todoDate < today && !item.isCompleted)
      .sort((a, b) => (b.todoDate || '').localeCompare(a.todoDate || '') || a.sortOrder - b.sortOrder)
  }, [note.items, today])

  const switchDate = useCallback(async (dateStr: string, options: { applyingDateDraft?: boolean } = {}) => {
    if (!isDateKey(dateStr)) return false
    if (dateStr === activeDate && !options.applyingDateDraft) return true
    const needsDiscardConfirmation = dateStr !== activeDate
      && (hasContentDrafts || (!options.applyingDateDraft && dateDraftDirty))
    if (needsDiscardConfirmation) {
      const confirmed = window.electronAPI?.isElectron
        ? await window.electronAPI.confirmWindowDraftAction('切换日期', note.id)
        : window.confirm('当前日期还有未保存的输入。放弃草稿并切换日期吗？')
      if (!confirmed) return false
      setNewTodo('')
      setItemDrafts({})
    }
    setActiveDate(dateStr)
    setDateDraft(dateStr)
    setEditingDate(false)
    const currentNote = useNotesStore.getState().notes.find((item) => item.id === note.id) || note
    updateNote({
      ...currentNote,
      dailyTodo: {
        ...currentNote.dailyTodo,
        activeDate: dateStr,
        lastResetDate: dateStr === today ? today : (currentNote.dailyTodo?.lastResetDate || today),
      },
      updatedAt: new Date().toISOString(),
    })
    return true
  }, [activeDate, dateDraftDirty, hasContentDrafts, note, today, updateNote])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onFocusNote((payload) => {
      if (payload?.noteId !== note.id || !payload.dateStr || !isDateKey(payload.dateStr)) return
      void switchDate(payload.dateStr)
    })
  }, [note.id, switchDate])

  const handleAddTodo = () => {
    const content = newTodo.trim()
    if (!content || !isDateKey(activeDate)) return
    addItem(note.id, content, { todoDate: activeDate })
    setNewTodo('')
  }

  const toggleRecurringEvent = (event: CalendarEvent) => {
    const occurrenceKey = getEventInstanceKey(event)
    const next = new Set(note.dailyTodo?.completedEventOccurrences || [])
    if (next.has(occurrenceKey)) next.delete(occurrenceKey)
    else next.add(occurrenceKey)
    updateNote({
      ...note,
      dailyTodo: {
        ...note.dailyTodo,
        activeDate,
        lastResetDate: note.dailyTodo?.lastResetDate || today,
        completedEventOccurrences: [...next].slice(-20000),
      },
      updatedAt: new Date().toISOString(),
    })
  }

  const latestUnfinishedDate = previousUnfinished[0]?.todoDate
  const recurringCompletedCount = recurringEvents.filter((event) => completedEventOccurrences.has(getEventInstanceKey(event))).length
  const completedCount = dailyItems.filter((item) => item.isCompleted).length + recurringCompletedCount
  const totalCount = dailyItems.length + recurringEvents.length
  const displayDate = formatDisplayDate(activeDate)
  const canGoPrevious = activeDate > MIN_SUPPORTED_DATE_KEY
  const canGoNext = activeDate < MAX_SUPPORTED_DATE_KEY

  const startEditDate = () => {
    setDateDraft(activeDate)
    setEditingDate(true)
  }

  const commitDateDraft = async () => {
    const next = dateDraft.trim()
    if (isDateKey(next)) {
      await switchDate(next, { applyingDateDraft: true })
      return
    }
    setDateDraft(activeDate)
    setEditingDate(false)
  }

  return (
    <>
      <div
        className={`daily-todo-panel relative flex-1 min-h-0 flex flex-col ${compact ? 'daily-todo-panel-compact overflow-y-auto overflow-x-hidden px-1.5 pb-0.5' : 'overflow-hidden px-2 py-1'}`}
        data-note-wheel-scroll
        onWheel={(event) => event.stopPropagation()}
      >
        <div
          className={`daily-date-switch flex items-stretch gap-1 rounded-md border ${compact ? 'daily-date-switch-compact mb-0.5 px-0.5 py-0.5' : 'mb-1 px-1 py-1'}`}
          style={{ backgroundColor: panelBg, borderColor: panelBorder, color: textColor }}
        >
          <button
            onClick={() => { void switchDate(addDaysToDateKey(activeDate, -1)) }}
            disabled={!canGoPrevious}
            className="touch-target daily-nav-button h-auto w-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
            title={canGoPrevious ? '前一天' : '已到支持范围下限（1900-01-01）'}
            aria-label={canGoPrevious ? '前一天' : '已到支持范围下限'}
          >
            <ChevronLeft size={compact ? 12 : 14} />
          </button>
          {editingDate ? (
            <input
              type="date"
              value={dateDraft}
              min={MIN_SUPPORTED_DATE_KEY}
              max={MAX_SUPPORTED_DATE_KEY}
              onChange={(event) => setDateDraft(event.target.value)}
              onBlur={() => { void commitDateDraft() }}
              onKeyDown={(event) => {
                if (isImeComposing(event)) return
                if (event.key === 'Enter') void commitDateDraft()
                if (event.key === 'Escape') {
                  setDateDraft(activeDate)
                  setEditingDate(false)
                }
              }}
              className={`daily-date-display min-w-0 flex-1 rounded-md text-center text-[0.82em] font-semibold outline-none ${compact ? 'daily-date-display-compact px-1 py-0.5' : 'px-2 py-1'}`}
              style={{ color: textColor }}
              placeholder="YYYY-MM-DD"
              aria-label="每日待办日期"
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
            onClick={() => { void switchDate(addDaysToDateKey(activeDate, 1)) }}
            disabled={!canGoNext}
            className="touch-target daily-nav-button h-auto w-6 rounded-md flex items-center justify-center opacity-60 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
            title={canGoNext ? '后一天' : '已到支持范围上限（2100-12-31）'}
            aria-label={canGoNext ? '后一天' : '已到支持范围上限'}
          >
            <ChevronRight size={compact ? 12 : 14} />
          </button>
          {activeDate !== today && (
            <button
              onClick={() => { void switchDate(today) }}
              className={`touch-target daily-today-button min-w-6 rounded-md opacity-60 hover:opacity-90 ${compact ? 'flex items-center justify-center px-0' : 'px-1 text-[0.72em]'}`}
              title="回到今天"
            >
              {compact ? <RotateCcw size={11} /> : '今天'}
            </button>
          )}
        </div>

        <div className={`daily-progress-row flex items-center justify-between ${compact ? 'mb-0.5 px-0.5 text-[0.58em]' : 'mb-1 px-0.5 text-[0.62em]'}`} style={{ color: mutedColor }}>
          <span>{activeDate === today ? '今日进度' : '当日进度'}</span>
          <span>{completedCount}/{totalCount}</span>
        </div>

        {activeDate === today && previousUnfinished.length > 0 && latestUnfinishedDate && (
          <button
            onClick={() => { void switchDate(latestUnfinishedDate) }}
            className={`w-full rounded-md border text-left ${compact ? 'mb-0.5 px-1.5 py-0.5 text-[0.64em]' : 'mb-1 px-2 py-1 text-[0.72em]'}`}
            style={{ backgroundColor: panelBg, borderColor: panelBorder, color: mutedColor }}
          >
            历史未完成 {previousUnfinished.length} 项 · 最近 {labelForDate(latestUnfinishedDate, today)}
          </button>
        )}

        <div
          className={`daily-list flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${compact ? 'space-y-0.5' : 'space-y-1'}`}
          data-note-wheel-scroll
          onWheel={(event) => event.stopPropagation()}
        >
          {recurringEvents.map((event) => {
            const occurrenceKey = getEventInstanceKey(event)
            const isCompleted = completedEventOccurrences.has(occurrenceKey)
            const eventColor = normalizeHexColor(event.color)
            return (
              <div
                key={occurrenceKey}
                className={`daily-recurring-item note-todo-item flex min-w-0 items-center gap-1.5 rounded-md border ${compact ? 'px-1 py-0.5' : 'px-1.5 py-1'}`}
                style={{ backgroundColor: panelBg, borderColor: panelBorder }}
              >
                <button
                  type="button"
                  onClick={() => toggleRecurringEvent(event)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-opacity hover:opacity-80"
                  style={{
                    borderColor: eventColor,
                    backgroundColor: isCompleted ? eventColor : 'transparent',
                  }}
                  aria-label={isCompleted ? `恢复循环待办：${event.title}` : `完成循环待办：${event.title}`}
                >
                  {isCompleted && <Check size={10} color="#fff" />}
                </button>
                <button
                  type="button"
                  onClick={() => window.electronAPI?.openEventEditor(event)}
                  className="min-w-0 flex-1 text-left"
                  title="打开循环事件"
                >
                  <span className={`block truncate text-[0.9em] leading-tight ${isCompleted ? 'line-through opacity-45' : ''}`}>
                    {event.title}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.62em] leading-tight" style={{ color: mutedColor }}>
                    <Repeat2 size={9} className="shrink-0" />
                    <span className="shrink-0">循环事件</span>
                    <span className="truncate">· {event.isAllDay ? '全天' : (event.startTime || '未设时间')}</span>
                  </span>
                </button>
              </div>
            )
          })}
          {dailyItems.map((item) => (
            <TodoItem key={item.id} item={item} note={note} onDraftChange={handleItemDraftChange} />
          ))}
          {totalCount === 0 && (
            <div className={`${compact ? 'py-5 text-[0.68em]' : 'py-8 text-[0.78em]'} daily-empty text-center`} style={{ color: mutedColor }}>
              <div className="daily-empty-date mx-auto mb-2 flex items-center justify-center rounded-md border text-[0.82em]" style={{ borderColor: panelBorder }}>
                {displayDate.monthDay}
              </div>
              <div>{labelForDate(activeDate, today)}无待办</div>
            </div>
          )}
        </div>
      </div>

      <div className={`daily-composer-wrap relative shrink-0 ${compact ? 'px-1.5 py-0.5' : 'px-2 pb-1.5 pt-0.5'}`}>
        <div
          className={`daily-composer note-composer-control flex items-center gap-1.5 border rounded-md transition-colors ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}
          style={{
            backgroundColor: panelBg,
            borderColor: panelBorder,
          }}
        >
          <button
            type="button"
            onClick={handleAddTodo}
            className="touch-target shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-opacity"
            style={{ opacity: 0.7, backgroundColor: lightBg ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.14)' }}
            title="添加"
          >
            <Plus size={12} />
          </button>
          <input
            type="text"
            value={newTodo}
            maxLength={2000}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => { if (!isImeComposing(e) && e.key === 'Enter') handleAddTodo() }}
            placeholder={`${labelForDate(activeDate, today)}待办...`}
            aria-label={`${labelForDate(activeDate, today)}待办内容`}
            className="flex-1 bg-transparent text-[0.82em] outline-none placeholder:opacity-70"
            style={{ color: textColor }}
          />
          {activeDate !== today && (
            <button
              type="button"
              onClick={() => { void switchDate(today) }}
              className="touch-target shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-55 hover:opacity-85"
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
