import { useState } from 'react'
import { Check } from '@/components/ui/icons'
import { useCalendarStore } from '@/stores/calendar.store'
import type { CalendarEvent } from '@/types/calendar.types'

export function EventCompletionButton({ event, completed, occurrenceDate = event.occurrenceDate || event.startDate }: {
  event: CalendarEvent; completed: boolean; occurrenceDate?: string
}) {
  const setEventCompleted = useCalendarStore((s) => s.setEventCompleted)
  const [saving, setSaving] = useState(false)
  return <button
    type="button"
    role="checkbox"
    aria-checked={completed}
    aria-label={`${completed ? '恢复事件' : '完成事件'}：${event.title}`}
    title={event.recurrence ? (completed ? '恢复这一次事件' : '完成这一次事件') : undefined}
    disabled={saving}
    className={`event-completion-control flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors disabled:opacity-50 ${completed ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 hover:border-primary'}`}
    onClick={async (e) => {
      e.stopPropagation()
      setSaving(true)
      try { await setEventCompleted(event.seriesId || event.id, occurrenceDate, !completed) }
      finally { setSaving(false) }
    }}
  >{completed && <Check size={13} />}</button>
}
