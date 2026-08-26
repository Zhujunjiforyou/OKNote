import { useEffect, type CSSProperties } from 'react'
import { Bell, CalendarClock, CheckCheck, X } from 'lucide-react'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'

export interface ReminderHistoryEntry {
  id: string
  eventId: string
  title: string
  startDate: string
  startTime?: string
  isAllDay: boolean
  firedAt: string
  read: boolean
  missed?: boolean
  scheduledFor?: string
}

interface ReminderCenterProps {
  open: boolean
  entries: ReminderHistoryEntry[]
  onClose: () => void
  onMarkAllRead: () => void
  onOpenEvent: (entry: ReminderHistoryEntry) => void
}

export function ReminderCenter({ open, entries, onClose, onMarkAllRead, onOpenEvent }: ReminderCenterProps) {
  const dialogRef = useDialogFocusTrap(open)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null
  const unread = entries.filter((entry) => !entry.read).length

  return (
    <div
      className="fixed inset-0 z-[11000] bg-black/45"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-center-title"
        className="reminder-center absolute inset-block-3 inset-inline-end-3 flex w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center gap-3 px-4">
          <Bell size={18} className="text-blue-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="reminder-center-title" className="text-sm font-semibold">提醒记录</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{unread > 0 ? `${unread} 条未读` : '最近 500 条提醒'}</p>
          </div>
          {unread > 0 && (
            <button type="button" onClick={onMarkAllRead} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
              <CheckCheck size={15} aria-hidden="true" />
              全部已读
            </button>
          )}
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400" aria-label="关闭提醒记录">
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {entries.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center text-muted-foreground">
              <CalendarClock size={24} aria-hidden="true" />
              <p className="mt-3 text-sm">还没有提醒记录</p>
              <p className="mt-1 text-xs leading-relaxed opacity-70">事件提醒触发后会保留在这里，不再因为弹窗关闭而消失。</p>
            </div>
          ) : (
            [...entries].reverse().map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenEvent(entry)}
                className={`reminder-history-row flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-400 ${entry.read ? 'text-muted-foreground' : 'bg-blue-500/10 text-foreground'}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${entry.read ? 'bg-slate-600' : 'bg-blue-400'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className="truncate">{entry.title}</span>
                    {entry.missed && <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">错过</span>}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {entry.startDate} · {entry.isAllDay ? '全天（09:00 提醒）' : (entry.startTime || '未设置开始时间')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
