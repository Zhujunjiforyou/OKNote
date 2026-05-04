import { useCalendarStore } from '@/stores/calendar.store'
import { filterEventsByDate } from '@/lib/utils'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface DayEventsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function DayEventsModal({ isOpen, onClose }: DayEventsModalProps) {
  const currentDate = useCalendarStore((s) => s.currentDate)
  const events = useCalendarStore((s) => s.events)
  const selectEvent = useCalendarStore((s) => s.selectEvent)

  const y = currentDate.getFullYear()
  const m = String(currentDate.getMonth() + 1).padStart(2, '0')
  const d = String(currentDate.getDate()).padStart(2, '0')
  const dateStr = `${y}-${m}-${d}`

  const dayEvents = filterEventsByDate(events, dateStr)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[380px] max-h-[75vh] overflow-auto"
          >
            <div className="bg-background/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <h2 className="text-sm font-semibold">{y}年{m}月{d}日 事件</h2>
                <button
                  onClick={onClose}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-3">
                {dayEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground/50 text-center py-6">暂无事件</p>
                ) : (
                  <div className="space-y-1.5">
                    {dayEvents.map((event) => (
                      <button
                        key={event.id}
                        onClick={() => {
                          selectEvent(event.id)
                          onClose()
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors flex items-center gap-3"
                      >
                        <div
                          className="w-1 h-8 rounded-full shrink-0"
                          style={{ backgroundColor: event.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{event.title}</div>
                          <div className="text-xs text-muted-foreground/60">
                            {event.isAllDay ? '全天' : `${event.startTime || ''} ${event.endTime ? ' - ' + event.endTime : ''}`}
                            {event.endDate && event.endDate !== event.startDate && (
                              <span> · {event.startDate} 至 {event.endDate}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
