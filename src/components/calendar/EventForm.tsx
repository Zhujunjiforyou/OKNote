import { useCallback, useEffect, useRef, useState } from 'react'
import { useCalendarStore } from '@/stores/calendar.store'
import { useTagStore } from '@/stores/tag.store'
import { CalendarEvent } from '@/types/calendar.types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Bell, Repeat, Trash2, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { EVENT_COLOR_PALETTE, generateId } from '@/lib/utils'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface EventFormProps {
  onClose: () => void
  initialMultiDay?: boolean
  onDirtyChange?: (dirty: boolean) => void
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
  const date = new Date(0)
  date.setHours(0, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  return date.getDay()
}

function monthDayFromDateKey(dateStr: string): number {
  return Math.min(31, Math.max(1, Number(dateStr.slice(8, 10)) || 1))
}

function openNativeTimePicker(input: HTMLInputElement) {
  try {
    input.showPicker?.()
  } catch {
    input.focus()
  }
}

function normalizeWeekdays(days: number[]): number[] {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b)
}

interface EventDraftFingerprint {
  title: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  isAllDay: boolean
  isMultiDay: boolean
  color: string
  description: string
  tagId: string | null
  recurrenceMode: RecurrenceMode
  recurrenceInterval: number
  recurrenceWeekdays: number[]
  recurrenceMonthDay: number
  recurrenceUntil: string
  reminderEnabled: boolean
  reminderMinutes: number
  reminderPlaySound: boolean
}

function fingerprintDraft(draft: EventDraftFingerprint): string {
  return JSON.stringify([
    draft.title,
    draft.startDate,
    draft.endDate,
    draft.startTime,
    draft.endTime,
    draft.isAllDay,
    draft.isMultiDay,
    draft.color,
    draft.description,
    draft.tagId,
    draft.recurrenceMode,
    draft.recurrenceInterval,
    normalizeWeekdays(draft.recurrenceWeekdays),
    draft.recurrenceMonthDay,
    draft.recurrenceUntil,
    draft.reminderEnabled,
    draft.reminderMinutes,
    draft.reminderPlaySound,
  ])
}

export function EventForm({ onClose, initialMultiDay = false, onDirtyChange }: EventFormProps) {
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
  const [isSaving, setIsSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'discard' | 'delete' | null>(null)
  const dialogRef = useDialogFocusTrap(confirmAction === null)
  const baselineFingerprintRef = useRef('')
  const initializedRef = useRef(false)

  const tags = useTagStore((s) => s.tags)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (confirmAction !== null) dialog.setAttribute('inert', '')
    else dialog.removeAttribute('inert')
    return () => dialog.removeAttribute('inert')
  }, [confirmAction, dialogRef])

  useEffect(() => {
    const y = currentDate.getFullYear()
    const m = String(currentDate.getMonth() + 1).padStart(2, '0')
    const d = String(currentDate.getDate()).padStart(2, '0')
    const fallbackDate = `${y}-${m}-${d}`
    const eventDate = editingEvent?.startDate || fallbackDate
    const hasEnd = !!(editingEvent?.endDate && editingEvent.endDate !== editingEvent.startDate)
    const next: EventDraftFingerprint = {
      title: editingEvent?.title || '',
      startDate: eventDate,
      endDate: editingEvent?.endDate || eventDate,
      startTime: editingEvent?.startTime || '',
      endTime: editingEvent?.endTime || '',
      isAllDay: editingEvent?.isAllDay === true,
      isMultiDay: editingEvent ? hasEnd : initialMultiDay,
      color: editingEvent?.color || '#2563EB',
      description: editingEvent?.description || '',
      tagId: editingEvent?.tagId || null,
      recurrenceMode: editingEvent?.recurrence?.freq || 'none',
      recurrenceInterval: editingEvent?.recurrence?.interval || 1,
      recurrenceWeekdays: editingEvent?.recurrence?.byWeekday?.length
        ? editingEvent.recurrence.byWeekday
        : [weekdayFromDateKey(eventDate)],
      recurrenceMonthDay: editingEvent?.recurrence?.byMonthDay?.[0] || monthDayFromDateKey(eventDate),
      recurrenceUntil: editingEvent?.recurrence?.until || '',
      reminderEnabled: editingEvent?.reminder?.enabled === true,
      reminderMinutes: editingEvent?.reminder?.minutesBefore ?? 10,
      reminderPlaySound: editingEvent?.reminder?.playSound === true,
    }
    setTitle(next.title)
    setStartDate(next.startDate)
    setEndDate(next.endDate)
    setStartTime(next.startTime)
    setEndTime(next.endTime)
    setIsAllDay(next.isAllDay)
    setIsMultiDay(next.isMultiDay)
    setColor(next.color)
    setDescription(next.description)
    setTagId(next.tagId)
    setRecurrenceMode(next.recurrenceMode)
    setRecurrenceInterval(next.recurrenceInterval)
    setRecurrenceWeekdays(next.recurrenceWeekdays)
    setRecurrenceMonthDay(next.recurrenceMonthDay)
    setRecurrenceUntil(next.recurrenceUntil)
    setReminderEnabled(next.reminderEnabled)
    setReminderMinutes(next.reminderMinutes)
    setReminderPlaySound(next.reminderPlaySound)
    setError('')
    baselineFingerprintRef.current = fingerprintDraft(next)
    initializedRef.current = true
  // A live events refresh often replaces the event object with an equivalent
  // instance. Reinitialize only when the form switches to another event; a
  // date rollover or same-event refresh must never overwrite typed input.
  }, [editingEvent?.id, initialMultiDay])

  const currentFingerprint = fingerprintDraft({
    title,
    startDate,
    endDate,
    startTime,
    endTime,
    isAllDay,
    isMultiDay,
    color,
    description,
    tagId,
    recurrenceMode,
    recurrenceInterval,
    recurrenceWeekdays,
    recurrenceMonthDay,
    recurrenceUntil,
    reminderEnabled,
    reminderMinutes,
    reminderPlaySound,
  })
  const isDirty = initializedRef.current && currentFingerprint !== baselineFingerprintRef.current

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const requestClose = useCallback(() => {
    if (confirmAction || isSaving) return
    if (isDirty) {
      setConfirmAction('discard')
      return
    }
    onClose()
  }, [confirmAction, isDirty, isSaving, onClose])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmAction) requestClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [confirmAction, requestClose])

  const handleSave = async () => {
    if (isSaving) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) { setError('请输入事件标题'); return }
    if (trimmedTitle.length > 200) { setError('标题不能超过200个字符'); return }
    if (!startDate) { setError('请选择开始日期'); return }
    if (isMultiDay && endDate && endDate < startDate) { setError('结束日期不能早于开始日期'); return }
    const effectiveEndDate = isMultiDay ? (endDate || startDate) : startDate
    if (!isAllDay && endTime && !startTime) { setError('设置结束时间前，请先选择开始时间'); return }
    if (!isAllDay && startTime && endTime && effectiveEndDate === startDate && endTime < startTime) { setError('结束时间不能早于开始时间'); return }
    if (reminderEnabled && !isAllDay && !startTime) { setError('设置提醒前，请先选择开始时间'); return }
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

    setIsSaving(true)
    try {
      const result = editingEvent
        ? await updateEvent(eventData)
        : await addEvent(eventData)
      if (!result.ok) {
        setError(result.code === 'conflict'
          ? `${result.message || '事件已在其他窗口被修改。'} 当前表单草稿仍保留，请核对后再处理。`
          : `${result.message || '事件未能写入磁盘。'} 当前表单草稿仍保留。`)
        return
      }
      baselineFingerprintRef.current = currentFingerprint
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，当前表单草稿仍保留。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={requestClose}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-h-[calc(100vh-12px)] max-w-[calc(100vw-12px)] overflow-auto"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && title.trim()) { e.preventDefault(); void handleSave() } }}
        role="dialog"
        aria-modal={confirmAction === null ? 'true' : undefined}
        aria-hidden={confirmAction !== null ? 'true' : undefined}
        aria-labelledby="event-form-title"
        aria-busy={isSaving}
      >
        <Card className="border shadow-lg">
          <div className="h-1 rounded-t-xl" style={{ backgroundColor: color }} />
          <fieldset disabled={isSaving} className="contents">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-4">
              <h2 id="event-form-title" className="text-base font-semibold">
                {editingEvent ? (editingEvent.recurrence ? '编辑循环系列' : '编辑事件') : (isMultiDay ? '新建跨日事件' : '新建事件')}
              </h2>
              <button onClick={requestClose} className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label="关闭事件表单">
                <X size={15} />
              </button>
            </div>

            {editingEvent?.recurrence && (
              <p className="-mt-2 mb-3 text-xs leading-relaxed text-muted-foreground">
                此处修改或删除会作用于整个循环系列。
              </p>
            )}

            {error && (
              <div className="mb-3 px-3 py-2 rounded-md text-xs bg-destructive/10 text-destructive border border-destructive/20" role="alert">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {/* Title */}
              <input
                id="event-title"
                type="text"
                aria-label="事件标题"
                aria-required="true"
                value={title}
                maxLength={200}
                onChange={(e) => { setTitle(e.target.value); setError('') }}
                placeholder="事件标题"
                className="w-full bg-transparent text-sm border-b border-border pb-2 outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
                autoFocus
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleSave() } }}
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
                  <label htmlFor="event-start-date" className="text-xs text-muted-foreground w-10 shrink-0">开始</label>
                  <input
                    id="event-start-date"
                    type="date"
                    min="1900-01-01"
                    max="2100-12-31"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setError('') }}
                    className="flex-1 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                  {!isAllDay && (
                    <>
                      <label htmlFor="event-start-time" className="sr-only">开始时间</label>
                      <input
                        id="event-start-time"
                        type="time"
                        value={startTime}
                        onChange={(e) => { setStartTime(e.target.value); setError('') }}
                        onClick={(event) => openNativeTimePicker(event.currentTarget)}
                        className="event-time-input w-28 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                      />
                    </>
                  )}
                </div>
                {(isMultiDay || !isAllDay) && (
                  <div className="flex items-center gap-2">
                    <label htmlFor={isMultiDay ? 'event-end-date' : 'event-end-time'} className="text-xs text-muted-foreground w-10 shrink-0">结束</label>
                    {isMultiDay ? (
                      <input
                        id="event-end-date"
                        type="date"
                        min={startDate || '1900-01-01'}
                        max="2100-12-31"
                        value={endDate}
                        onChange={(e) => { setEndDate(e.target.value); setError('') }}
                        className="flex-1 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                      />
                    ) : (
                      <span className="flex-1 px-3 text-xs text-muted-foreground">同日</span>
                    )}
                    {!isAllDay && (
                      <>
                        <label htmlFor="event-end-time" className="sr-only">结束时间</label>
                        <input
                          id="event-end-time"
                          type="time"
                          value={endTime}
                          onChange={(e) => { setEndTime(e.target.value); setError('') }}
                          onClick={(event) => openNativeTimePicker(event.currentTarget)}
                          className="event-time-input w-28 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                        />
                      </>
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
                <label htmlFor="event-recurrence-mode" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Repeat size={13} />
                  循环方式
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                  <select
                    id="event-recurrence-mode"
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
                          aria-pressed={active}
                          aria-label={`每周${day.label}`}
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
                      id="event-recurrence-month-day"
                      type="number"
                      min={1}
                      max={31}
                      value={recurrenceMonthDay}
                      onChange={(e) => setRecurrenceMonthDay(Number(e.target.value) || 1)}
                      className="w-20 bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                      aria-label="每月循环日期"
                    />
                    <span className="text-xs text-muted-foreground">号</span>
                  </div>
                )}
                {recurrenceMode !== 'none' && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="event-recurrence-until" className="text-xs text-muted-foreground w-14 shrink-0">循环至</label>
                    <input
                      id="event-recurrence-until"
                      type="date"
                      value={recurrenceUntil}
                      min={startDate}
                      max="2100-12-31"
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
                      id="event-reminder-time"
                      value={reminderMinutes}
                      onChange={(e) => setReminderMinutes(Number(e.target.value))}
                      className="bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {REMINDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <label htmlFor="event-reminder-time" className="sr-only">提醒时间</label>
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
                {reminderEnabled && isAllDay && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">全天事件按当天 09:00 计算提醒时间。</p>
                )}
                {reminderEnabled && !isAllDay && !startTime && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">请先设置开始时间；未设置时不会创建提醒。</p>
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
                      className={`touch-target w-6 h-6 rounded-full border-2 transition-all ${
                        color === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{
                        backgroundColor: c,
                        boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.18), 0 0 0 1px rgba(255,255,255,0.20)',
                      }}
                      aria-label={`将事件颜色设为 ${c}`}
                    />
                  ))}
                </div>
              </div>

              {/* Tag selector */}
              <div>
                <label htmlFor="event-tag" className="block text-xs text-muted-foreground mb-1.5">分类标签</label>
                <select
                  id="event-tag"
                  value={tagId || ''}
                  onChange={(e) => {
                    const id = e.target.value || null
                    setTagId(id)
                    const tag = id ? tags.find((item) => item.id === id) : null
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
              <label htmlFor="event-description" className="block text-xs text-muted-foreground">事件描述</label>
              <textarea
                id="event-description"
                value={description}
                maxLength={2000}
                onChange={(e) => { setDescription(e.target.value); setError('') }}
                placeholder="添加描述..."
                rows={2}
                className="w-full bg-secondary rounded-md px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground"
              />
            </div>

            {/* Actions */}
            <div className="sticky bottom-0 z-10 -mx-5 mt-4 flex gap-2 border-t border-border bg-card px-5 py-3">
              {editingEvent && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirmAction('delete')}
                >
                  <Trash2 size={13} />
                  {editingEvent.recurrence ? '删除系列' : '删除'}
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={requestClose}>取消</Button>
              <Button size="sm" onClick={() => { void handleSave() }}>{isSaving ? '保存中…' : '保存'}</Button>
            </div>
          </CardContent>
          </fieldset>
        </Card>
      </motion.div>
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction === 'delete'
          ? (editingEvent?.recurrence ? '删除整个循环系列？' : '删除这个事件？')
          : '放弃未保存的修改？'}
        description={confirmAction === 'delete'
          ? (editingEvent?.recurrence
              ? `“${editingEvent.title || '未命名事件'}”的全部循环实例都会被删除，且无法撤销。`
              : `“${editingEvent?.title || title.trim() || '未命名事件'}”删除后无法撤销。`)
          : '当前草稿尚未保存，放弃后本次修改将不会保留。'}
        confirmLabel={confirmAction === 'delete' ? (editingEvent?.recurrence ? '删除整个系列' : '删除事件') : '放弃修改'}
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction === 'delete' && editingEvent) deleteEvent(editingEvent.id)
          setConfirmAction(null)
          onClose()
        }}
      />
    </motion.div>
  )
}
