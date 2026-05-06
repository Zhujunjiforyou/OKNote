import { useState, useEffect } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { CalendarEvent } from '@/types/calendar.types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Trash2, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { generateId } from '@/lib/utils'

interface EventFormProps {
  onClose: () => void
  initialMultiDay?: boolean
}

const COLORS = ['#F97316', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#EC4899', '#0EA5E9']

export function EventForm({ onClose, initialMultiDay = false }: EventFormProps) {
  const editingEvent = useCalendarStore((s) => s.editingEvent)
  const addEvent = useCalendarStore((s) => s.addEvent)
  const updateEvent = useCalendarStore((s) => s.updateEvent)
  const deleteEvent = useCalendarStore((s) => s.deleteEvent)
  const currentDate = useCalendarStore((s) => s.currentDate)

  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [isAllDay, setIsAllDay] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(initialMultiDay)
  const [color, setColor] = useState('#3B82F6')
  const [description, setDescription] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const tags = useTagStore((s) => s.tags)
  const getTagById = useTagStore((s) => s.getTagById)

  useEffect(() => {
    if (editingEvent) {
      setTitle(editingEvent.title)
      setStartDate(editingEvent.startDate)
      const hasEnd = !!(editingEvent.endDate && editingEvent.endDate !== editingEvent.startDate)
      setIsMultiDay(hasEnd)
      setEndDate(editingEvent.endDate || editingEvent.startDate)
      setStartTime(editingEvent.startTime || '')
      setEndTime(editingEvent.endTime || '')
      setIsAllDay(editingEvent.isAllDay)
      setColor(editingEvent.color)
      setDescription(editingEvent.description)
      setTagId(editingEvent.tagId || null)
    } else {
      const y = currentDate.getFullYear()
      const m = String(currentDate.getMonth() + 1).padStart(2, '0')
      const d = String(currentDate.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${d}`
      setStartDate(dateStr)
      setEndDate(dateStr)
    }
  }, [editingEvent, currentDate])

  const handleSave = () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) { setError('请输入事件标题'); return }
    if (trimmedTitle.length > 200) { setError('标题不能超过200个字符'); return }
    if (!startDate) { setError('请选择开始日期'); return }
    if (isMultiDay && endDate && endDate < startDate) { setError('结束日期不能早于开始日期'); return }
    if (description.length > 2000) { setError('描述不能超过2000个字符'); return }
    setError('')

    const eventData: CalendarEvent = {
      id: editingEvent?.id || generateId(),
      title: trimmedTitle,
      description,
      startDate,
      endDate: isMultiDay ? (endDate || startDate) : undefined,
      startTime: isAllDay ? undefined : (startTime || undefined),
      endTime: isAllDay ? undefined : (endTime || undefined),
      isAllDay,
      color,
      tagId: tagId || undefined,
      createdAt: editingEvent?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (editingEvent) {
      updateEvent(eventData)
    } else {
      addEvent(eventData)
    }
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-h-[85vh] overflow-auto"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && title.trim()) { e.preventDefault(); handleSave() } }}
      >
        <Card className="border shadow-lg">
          <div className="h-1 rounded-t-xl" style={{ backgroundColor: color }} />
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">
                {editingEvent ? '编辑事件' : (isMultiDay ? '新建跨日事件' : '新建事件')}
              </h2>
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                <X size={15} />
              </button>
            </div>

            {error && (
              <div className="mb-3 px-3 py-2 rounded-md text-xs bg-destructive/10 text-destructive border border-destructive/20">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setError('') }}
                placeholder="事件标题"
                className="w-full bg-transparent text-sm border-b border-border pb-2 outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
                autoFocus
              />

              {/* Multi-day toggle */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMultiDay}
                  onChange={(e) => setIsMultiDay(e.target.checked)}
                  className="rounded accent-primary"
                />
                <span>跨日事件</span>
              </label>

              {/* Date range */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-10 shrink-0">开始</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setError('') }}
                    className="flex-1 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                  {!isAllDay && (
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-28 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                  )}
                </div>
                {isMultiDay && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground w-10 shrink-0">结束</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => { setEndDate(e.target.value); setError('') }}
                      min={startDate}
                      className="flex-1 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                    {!isAllDay && (
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-28 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* All day toggle */}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  className="rounded accent-primary"
                />
                <span>全天</span>
              </label>

              {/* Color picker */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">标签颜色</p>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Tag selector */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">分类标签</p>
                <select
                  value={tagId || ''}
                  onChange={(e) => {
                    const id = e.target.value || null
                    setTagId(id)
                    const tag = id ? getTagById(id) : null
                    if (tag) setColor(tag.color)
                  }}
                  className="w-full bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">无标签</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setError('') }}
                placeholder="添加描述..."
                rows={2}
                className="w-full bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-5 pt-4 border-t border-border">
              {editingEvent && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    deleteEvent(editingEvent.id)
                    onClose()
                  }}
                >
                  <Trash2 size={13} />
                  删除
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
              <Button size="sm" onClick={handleSave}>保存</Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
