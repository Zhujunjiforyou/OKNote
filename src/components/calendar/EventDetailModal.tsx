import { useEffect, useState } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { X, Pencil, Trash2, Clock, MapPin, Tag, Repeat, Bell } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { CalendarEvent } from '@/types/calendar.types'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getEventInstanceRange } from '@/lib/utils'

function recurrenceLabel(event: CalendarEvent): string {
  const recurrence = event.recurrence
  if (!recurrence) return ''
  const intervalText = recurrence.interval > 1 ? `每 ${recurrence.interval} ` : '每'
  if (recurrence.freq === 'daily') return `${intervalText}天`
  if (recurrence.freq === 'weekly') return `${intervalText}周`
  if (recurrence.freq === 'monthly') return `${intervalText}月`
  return `${intervalText}年`
}

function reminderLabel(minutes: number): string {
  if (minutes <= 0) return '准时提醒'
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天`
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时`
  return `提前 ${minutes} 分钟`
}

export function EventDetailModal() {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const selectedEventId = useCalendarStore((s) => s.selectedEventId)
  const selectedEventOccurrenceDate = useCalendarStore((s) => s.selectedEventOccurrenceDate)
  const events = useCalendarStore((s) => s.events)
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const deleteEvent = useCalendarStore((s) => s.deleteEvent)
  const openEventForm = useCalendarStore((s) => s.openEventForm)
  const tags = useTagStore((s) => s.tags)

  const event = events.find((e) => e.id === selectedEventId)
  const dialogRef = useDialogFocusTrap(!!event)
  const eventTag = event?.tagId ? tags.find((tag) => tag.id === event.tagId) : null
  const instanceRange = event ? getEventInstanceRange(event, selectedEventOccurrenceDate) : null
  const isRecurring = !!event?.recurrence

  useEffect(() => {
    if (!event) return
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => { if (keyboardEvent.key === 'Escape') selectEvent(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [event, selectEvent])

  return (
    <>
      <AnimatePresence>
        {event && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => selectEvent(null)}
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[380px] max-h-[80vh] overflow-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-detail-title"
          >
            <Card className="border shadow-lg">
              {/* Color bar */}
              <div className="h-1 rounded-t-xl" style={{ backgroundColor: event.color }} />

              <CardContent className="pt-5">
                <div className="flex items-start justify-between mb-4">
                  <h2 id="event-detail-title" className="text-base font-semibold pr-4">{event.title}</h2>
                  <button
                    onClick={() => selectEvent(null)}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors"
                    aria-label="关闭事件详情"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="space-y-3 text-sm">
                  {/* Tag */}
                  {eventTag && (
                    <div className="flex items-center gap-2" style={{ color: eventTag.color }}>
                      <Tag size={14} />
                      <span className="text-xs font-medium">{eventTag.name}</span>
                    </div>
                  )}

                  {/* Date/Time */}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock size={14} />
                    <span>
                      {instanceRange?.startDate}
                      {instanceRange?.endDate && ` 至 ${instanceRange.endDate}`}
                      {event.startTime && ` ${event.startTime}`}
                      {event.endTime && ` - ${event.endTime}`}
                      {event.isAllDay && ' (全天)'}
                    </span>
                  </div>

                  {event.recurrence && (
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <Repeat size={14} className="mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div>{recurrenceLabel(event)}循环{event.recurrence.until ? `，至 ${event.recurrence.until}` : ''}</div>
                        <p className="mt-0.5 text-[11px] leading-relaxed">
                          当前实例为 {instanceRange?.startDate}；编辑和删除会作用于整个循环系列。
                        </p>
                      </div>
                    </div>
                  )}

                  {event.reminder?.enabled && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Bell size={14} />
                      <span>{reminderLabel(event.reminder.minutesBefore)}{event.isAllDay ? '，当天 09:00' : ''}{event.reminder.playSound ? '，带提示音' : ''}</span>
                    </div>
                  )}

                  {/* Description */}
                  {event.description && (
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <MapPin size={14} className="mt-0.5 shrink-0" />
                      <span>{event.description}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-5 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5"
                    onClick={() => {
                      openEventForm(event)
                      selectEvent(null)
                    }}
                  >
                    <Pencil size={13} />
                    {isRecurring ? '编辑整个系列' : '编辑'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 size={13} />
                    {isRecurring ? '删除系列' : '删除'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={deleteConfirmOpen && !!event}
        title={isRecurring ? '删除整个循环系列？' : '删除这个事件？'}
        description={isRecurring
          ? `“${event?.title || '未命名事件'}”的全部循环实例都会被删除，且无法撤销。`
          : `“${event?.title || '未命名事件'}”删除后无法撤销。`}
        confirmLabel={isRecurring ? '删除整个系列' : '删除事件'}
        destructive
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          if (event) deleteEvent(event.id)
          setDeleteConfirmOpen(false)
          selectEvent(null)
        }}
      />
    </>
  )
}
