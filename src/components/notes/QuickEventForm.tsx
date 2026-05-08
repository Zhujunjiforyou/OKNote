import { useEffect, useState } from 'react'
import type { Note } from '@/types/notes.types'
import type { CalendarEvent } from '@/types/calendar.types'
import { X } from 'lucide-react'
import { useTagStore } from '@/stores/tag.store'
import { getLocalDateKey, hexToLuminance, normalizeHexColor } from '@/lib/utils'

interface QuickEventFormProps {
  note: Note
  onClose: () => void
  onSaved: () => void
}

export function QuickEventForm({ note, onClose, onSaved }: QuickEventFormProps) {
  const getTagById = useTagStore((s) => s.getTagById)
  const selectedTagIds = Array.isArray(note.viewTagIds) && note.viewTagIds.length > 0
    ? note.viewTagIds
    : (note.echoTagId ? [note.echoTagId] : [])
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => getLocalDateKey())
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [selectedTagId, setSelectedTagId] = useState(() => selectedTagIds[0] || '')
  const [isAllDay, setIsAllDay] = useState(false)
  const [isMultiDay, setIsMultiDay] = useState(false)
  const [error, setError] = useState('')
  const noteLuminance = hexToLuminance(normalizeHexColor(note.color))
  const textColor = (noteLuminance + 0.05) / 0.05 >= 1.05 / (noteLuminance + 0.05) ? '#111827' : '#f8fafc'
  const lightNote = textColor === '#111827'
  const panelBg = lightNote ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.42)'
  const inputBg = lightNote ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.24)'
  const borderColor = lightNote ? 'rgba(17,24,39,0.16)' : 'rgba(255,255,255,0.18)'
  const mutedColor = lightNote ? 'rgba(17,24,39,0.68)' : 'rgba(248,250,252,0.72)'

  useEffect(() => {
    if (!selectedTagIds.includes(selectedTagId)) {
      setSelectedTagId(selectedTagIds[0] || '')
    }
  }, [selectedTagIds.join('|'), selectedTagId])

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed) { setError('请输入标题'); return }
    if (!selectedTagId) { setError('请先选择监听标签'); return }
    if (isMultiDay && endDate && endDate < date) { setError('结束日期不能早于开始日期'); return }
    setError('')
    const selectedTag = getTagById(selectedTagId)

    const eventData: CalendarEvent = {
      id: crypto.randomUUID(),
      title: trimmed,
      description: '',
      startDate: date,
      endDate: isMultiDay ? (endDate || date) : undefined,
      startTime: isAllDay ? undefined : (startTime || undefined),
      endTime: undefined,
      isAllDay,
      color: selectedTag?.color || note.color,
      tagId: selectedTagId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (window.electronAPI?.isElectron) {
      try {
        const saved = await window.electronAPI.createEventFromEcho(eventData)
        if (!saved) {
          setError('保存失败')
          return
        }
        onSaved()
      } catch (e) {
        console.error('QuickEventForm save failed:', e)
        setError('保存失败')
      }
    }
  }

  return (
    <div className="relative px-3 pb-3 pt-1 shrink-0">
      <div className="rounded-lg border p-2.5 space-y-2" style={{ borderColor, backgroundColor: panelBg, color: textColor }}>
        <div className="flex items-center justify-between">
          <span className="text-[0.75em] font-semibold">新建事件</span>
          <button onClick={onClose} className="w-4 h-4 flex items-center justify-center opacity-55 hover:opacity-90">
            <X size={10} />
          </button>
        </div>

        {error && (
          <div className="text-[0.65em] text-red-400 bg-red-500/10 rounded px-2 py-0.5">{error}</div>
        )}

        <input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setError('') }}
          placeholder="事件标题"
          className="w-full rounded px-2 py-1 text-[0.82em] outline-none placeholder:opacity-55"
          style={{ backgroundColor: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
        />

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); if (!endDate) setEndDate(e.target.value) }}
            className="flex-1 rounded px-2 py-1 text-[0.72em] outline-none"
            style={{ backgroundColor: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
          />
          {!isAllDay && (
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-20 rounded px-2 py-1 text-[0.72em] outline-none"
              style={{ backgroundColor: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
            />
          )}
        </div>

        {isMultiDay && (
          <input
            type="date"
            value={endDate}
            min={date}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded px-2 py-1 text-[0.72em] outline-none"
            style={{ backgroundColor: inputBg, color: textColor, border: `1px solid ${borderColor}` }}
          />
        )}

        {selectedTagIds.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {selectedTagIds.map((tagId) => {
              const tag = getTagById(tagId)
              if (!tag) return null
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setSelectedTagId(tag.id)}
                  className={`rounded-full px-2 py-0.5 text-[0.65em] transition-opacity ${selectedTagId === tag.id ? 'opacity-90' : 'opacity-35 hover:opacity-70'}`}
                  style={{ backgroundColor: inputBg, border: `1px solid ${selectedTagId === tag.id ? tag.color : borderColor}`, color: textColor }}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[0.65em] cursor-pointer" style={{ color: mutedColor }}>
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="rounded accent-primary"
            />
            全天
          </label>
          <label className="flex items-center gap-1 text-[0.65em] cursor-pointer" style={{ color: mutedColor }}>
            <input
              type="checkbox"
              checked={isMultiDay}
              onChange={(e) => {
                setIsMultiDay(e.target.checked)
                if (e.target.checked && !endDate) setEndDate(date)
              }}
              className="rounded accent-primary"
            />
            跨日
          </label>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            className="px-3 py-1 text-[0.72em] rounded font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
