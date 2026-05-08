import { useState, useEffect } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { CalendarEvent } from '@/types/calendar.types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Bell, Repeat, Trash2, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { EVENT_COLOR_PALETTE, generateId } from '@/lib/utils'

interface EventFormProps {
  onClose: () => void
  initialMultiDay?: boolean
}

type RecurrenceMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

const WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
]

const REMINDER_OPTIONS = [
  { value: 0, label: '准时' },
  { value: 5, label: '提前 5 分钟' },
  { value: 10, label: '提前 10 分钟' },
  { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' },
  { value: 1440, label: '提前 1 天' },
]

function recurrenceUnitLabel(mode: RecurrenceMode): string {
  if (mode === 'daily') return '天'
  if (mode === 'weekly') return '周'
  if (mode === 'monthly') return '月'
  if (mode === 'yearly') return '年'
  return ''
}

function weekdayFromDateKey(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
}

function monthDayFromDateKey(dateStr: string): number {
  return Math.min(31, Math.max(1, Number(dateStr.slice(8, 10)) || 1))
}

function normalizeWeekdays(days: number[]): number[] {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b)
}

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
  const [color, setColor] = useState('#2563EB')
  const [description, setDescription] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>('none')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([])
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState(1)
  const [recurrenceUntil, setRecurrenceUntil] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderMinutes, setReminderMinutes] = useState(10)
  const [reminderPlaySound, setReminderPlaySound] = useState(false)
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
      setRecurrenceMode(editingEvent.recurrence?.freq || 'none')
      setRecurrenceInterval(editingEvent.recurrence?.interval || 1)
      setRecurrenceWeekdays(editingEvent.recurrence?.byWeekday?.length
        ? editingEvent.recurrence.byWeekday
        : [weekdayFromDateKey(editingEvent.startDate)])
      setRecurrenceMonthDay(editingEvent.recurrence?.byMonthDay?.[0] || monthDayFromDateKey(editingEvent.startDate))
      setRecurrenceUntil(editingEvent.recurrence?.until || '')
      setReminderEnabled(editingEvent.reminder?.enabled === true)
      setReminderMinutes(editingEvent.reminder?.minutesBefore ?? 10)
      setReminderPlaySound(editingEvent.reminder?.playSound === true)
    } else {
      const y = currentDate.getFullYear()
      const m = String(currentDate.getMonth() + 1).padStart(2, '0')
      const d = String(currentDate.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${d}`
      setStartDate(dateStr)
      setEndDate(dateStr)
      setRecurrenceMode('none')
      setRecurrenceInterval(1)
      setRecurrenceWeekdays([weekdayFromDateKey(dateStr)])
      setRecurrenceMonthDay(monthDayFromDateKey(dateStr))
      setRecurrenceUntil('')
      setReminderEnabled(false)
      setReminderMinutes(10)
      setReminderPlaySound(false)
    }
  }, [editingEvent, currentDate])

  const handleSave = () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) { setError('请输入事件标题'); return }
    if (trimmedTitle.length > 200) { setError('标题不能超过200个字符'); return }
    if (!startDate) { setError('请选择开始日期'); return }
    if (isMultiDay && endDate && endDate < startDate) { setError('结束日期不能早于开始日期'); return }
    if (recurrenceMode !== 'none' && recurrenceUntil && recurrenceUntil < startDate) { setError('循环结束日期不能早于开始日期'); return }
    const safeWeekdays = normalizeWeekdays(recurrenceWeekdays)
    if (recurrenceMode === 'weekly' && safeWeekdays.length === 0) { setError('请选择每周循环的星期'); return }
    if (description.length > 2000) { setError('描述不能超过2000个字符'); return }
    setError('')

    const safeInterval = Math.max(1, Math.min(99, Math.floor(recurrenceInterval || 1)))
    const recurrence: CalendarEvent['recurrence'] = recurrenceMode === 'none'
      ? undefined
      : {
          freq: recurrenceMode,
          interval: safeInterval,
          ...(recurrenceMode === 'weekly' ? { byWeekday: safeWeekdays } : {}),
          ...(recurrenceMode === 'monthly' ? { byMonthDay: [Math.min(31, Math.max(1, recurrenceMonthDay))] } : {}),
          ...(recurrenceUntil ? { until: recurrenceUntil } : {}),
        }

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
      recurrence,
      reminder: reminderEnabled
        ? { enabled: true, minutesBefore: Number(reminderMinutes) || 0, playSound: reminderPlaySound }
        : undefined,
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

              {/* Recurrence */}
              <div className="rounded-lg border border-border/70 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Repeat size={13} />
                  循环
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                  <select
                    value={recurrenceMode}
                    onChange={(e) => {
                      const mode = e.target.value as RecurrenceMode
                      setRecurrenceMode(mode)
                      if (mode === 'weekly') setRecurrenceWeekdays((prev) => prev.length ? prev : [weekdayFromDateKey(startDate)])
                      if (mode === 'monthly') setRecurrenceMonthDay(monthDayFromDateKey(startDate))
                    }}
                    className="bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="none">不循环</option>
                    <option value="daily">按天循环</option>
                    <option value="weekly">按周循环</option>
                    <option value="monthly">按月循环</option>
                    <option value="yearly">按年循环</option>
                  </select>
                  {recurrenceMode !== 'none' && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>每</span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={recurrenceInterval}
                        onChange={(e) => setRecurrenceInterval(Number(e.target.value) || 1)}
                        className="w-14 bg-secondary rounded-md px-2 py-2 text-center text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                        aria-label="循环间隔"
                      />
                      <span>{recurrenceUnitLabel(recurrenceMode)}一次</span>
                    </div>
                  )}
                </div>
                {recurrenceMode === 'weekly' && (
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAY_OPTIONS.map((day) => {
                      const active = recurrenceWeekdays.includes(day.value)
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => setRecurrenceWeekdays((prev) => active ? prev.filter((value) => value !== day.value) : [...prev, day.value])}
                          className={`h-7 w-7 rounded-md text-xs transition-colors ${active ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                )}
                {recurrenceMode === 'monthly' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">每月</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={recurrenceMonthDay}
                      onChange={(e) => setRecurrenceMonthDay(Number(e.target.value) || 1)}
                      className="w-20 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">号</span>
                  </div>
                )}
                {recurrenceMode !== 'none' && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground w-14 shrink-0">结束</label>
                    <input
                      type="date"
                      value={recurrenceUntil}
                      min={startDate}
                      onChange={(e) => setRecurrenceUntil(e.target.value)}
                      className="flex-1 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
              </div>

              {/* Reminder */}
              <div className="rounded-lg border border-border/70 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reminderEnabled}
                    onChange={(e) => setReminderEnabled(e.target.checked)}
                    className="rounded accent-primary"
                  />
                  <Bell size={13} className="text-muted-foreground" />
                  <span>提醒</span>
                </label>
                {reminderEnabled && (
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                    <select
                      value={reminderMinutes}
                      onChange={(e) => setReminderMinutes(Number(e.target.value))}
                      className="bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {REMINDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminderPlaySound}
                        onChange={(e) => setReminderPlaySound(e.target.checked)}
                        className="rounded accent-primary"
                      />
                      提示音
                    </label>
                  </div>
                )}
              </div>

              {/* Color picker */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">标签颜色</p>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{
                        backgroundColor: c,
                        boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.20)',
                      }}
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
