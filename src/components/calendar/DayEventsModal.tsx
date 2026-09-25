import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useNotesStore } from '@/stores/notes.store'
import { buildDailyTodoItemsByDate, compareCalendarEventStart, filterEventsByDate, getEventInstanceKey, isEventCompleted, legacyCompletedEventKeys } from '@/lib/utils'
import { openTodoSource } from '@/lib/todo-navigation'
import { X } from '@/components/ui/icons'
import { motion, AnimatePresence } from 'framer-motion'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'
import { AgendaEventRow, AgendaTodoRow } from './AgendaRows'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface DayEventsModalProps {
  isOpen: boolean
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function DayEventsModal({ isOpen, onClose, onDirtyChange }: DayEventsModalProps) {
  const [drafts, setDrafts] = useState<Record<string, boolean>>({})
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null)
  const dirty = Object.values(drafts).some(Boolean)
  const onDraftChange = useCallback((id: string, value: boolean) => {
    setDrafts((current) => current[id] === value ? current : { ...current, [id]: value })
  }, [])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const leave = useCallback((action: () => void) => {
    if (dirty) setLeaveAction(() => action)
    else action()
  }, [dirty])
  const dialogRef = useDialogFocusTrap(isOpen)
  const currentDate = useCalendarStore((s) => s.currentDate)
  const events = useCalendarStore((s) => s.events)
  const notes = useNotesStore((s) => s.notes)
  const selectEvent = useCalendarStore((s) => s.selectEvent)

  useEffect(() => {
    if (!isOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) leave(onClose)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen, onClose, leave])

  const y = currentDate.getFullYear()
  const m = String(currentDate.getMonth() + 1).padStart(2, '0')
  const d = String(currentDate.getDate()).padStart(2, '0')
  const dateStr = `${y}-${m}-${d}`
  const completedKeys = useMemo(() => legacyCompletedEventKeys(notes), [notes])
  const dayEvents = useMemo(() => isOpen
    ? filterEventsByDate(events, dateStr).sort((a, b) => Number(isEventCompleted(a, completedKeys)) - Number(isEventCompleted(b, completedKeys)) || compareCalendarEventStart(a, b))
    : [], [events, dateStr, isOpen, completedKeys])
  const dayTodos = useMemo(() => isOpen
    ? buildDailyTodoItemsByDate(notes, dateStr, dateStr, true).get(dateStr) || []
    : [], [notes, dateStr, isOpen])

  return <><AnimatePresence>
    {isOpen && <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={() => leave(onClose)}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="day-agenda flex w-[440px] max-w-[calc(100vw-24px)] max-h-[85vh] flex-col overflow-hidden rounded-xl bg-background shadow-xl"
        role="dialog" aria-modal="true" aria-labelledby="day-events-title"
      >
        <div className="day-agenda-header flex shrink-0 items-start justify-between gap-3 border-b border-foreground/15">
          <h2 id="day-events-title" aria-label={`${y}年${m}月${d}日 日程`} className="min-w-0 text-[1.05em] font-semibold leading-snug"><span className="day-agenda-year">{y}年</span>{Number(m)}月{Number(d)}日 日程</h2>
          <button onClick={() => leave(onClose)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            aria-label="关闭当日日程"><X size={16} /></button>
        </div>

        <div className="day-agenda-body min-h-0 overflow-auto">
          {dayTodos.length === 0 && dayEvents.length === 0 && <p className="py-6 text-center text-[0.9em] text-muted-foreground">暂无待办或事件</p>}
          {dayTodos.length > 0 && <section aria-labelledby="day-todos-title">
            <h3 id="day-todos-title" className="day-agenda-section-title">待办 <span>{dayTodos.filter((item) => !item.isCompleted).length} 项未完成</span></h3>
            <ul className="divide-y divide-foreground/10">
              {dayTodos.map((todo) => <li key={`${todo.noteId}-${todo.id}`} className="day-agenda-row">
                <AgendaTodoRow todo={todo} onDraftChange={onDraftChange} onOpenSource={() => leave(() => { onClose(); void openTodoSource(todo) })} />
              </li>)}
            </ul>
          </section>}
          {dayEvents.length > 0 && <section aria-labelledby="day-event-list-title">
            <h3 id="day-event-list-title" className="day-agenda-section-title">事件 <span>{dayEvents.filter((event) => !isEventCompleted(event, completedKeys)).length} 项未完成</span></h3>
            <ul className="divide-y divide-foreground/10">
              {dayEvents.map((event) => <li key={getEventInstanceKey(event)} className="day-agenda-row">
                <AgendaEventRow event={event} completed={isEventCompleted(event, completedKeys)}
                  onOpen={() => leave(() => { selectEvent(event.seriesId || event.id, event.occurrenceDate || event.startDate); onClose() })} />
              </li>)}
            </ul>
          </section>}
        </div>
      </motion.div>
    </motion.div>}
  </AnimatePresence>
    {leaveAction && <ConfirmDialog open title="放弃未保存的输入？" description="这条待办还有未保存的内容或日期。" confirmLabel="放弃输入"
      onCancel={() => setLeaveAction(null)} onConfirm={() => { const action = leaveAction; setLeaveAction(null); setDrafts({}); action?.() }} />}
  </>
}
