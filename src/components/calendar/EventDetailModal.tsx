import { useCalendarStore } from '@/stores/calendar.store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { X, Pencil, Trash2, Clock, MapPin } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function EventDetailModal() {
  const selectedEventId = useCalendarStore((s) => s.selectedEventId)
  const events = useCalendarStore((s) => s.events)
  const selectEvent = useCalendarStore((s) => s.selectEvent)
  const deleteEvent = useCalendarStore((s) => s.deleteEvent)
  const openEventForm = useCalendarStore((s) => s.openEventForm)

  const event = events.find((e) => e.id === selectedEventId)

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => selectEvent(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[380px] max-h-[80vh] overflow-auto"
          >
            <Card className="border shadow-lg">
              {/* Color bar */}
              <div className="h-1 rounded-t-xl" style={{ backgroundColor: event.color }} />

              <CardContent className="pt-5">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-base font-semibold pr-4">{event.title}</h2>
                  <button
                    onClick={() => selectEvent(null)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="space-y-3 text-sm">
                  {/* Date/Time */}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock size={14} />
                    <span>
                      {event.startDate}
                      {event.startTime && ` ${event.startTime}`}
                      {event.endTime && ` - ${event.endTime}`}
                      {event.isAllDay && ' (全天)'}
                    </span>
                  </div>

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
                    编辑
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      deleteEvent(event.id)
                    }}
                  >
                    <Trash2 size={13} />
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
