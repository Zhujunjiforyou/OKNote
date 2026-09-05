import { useState, useEffect, useLayoutEffect, useId, useMemo, useRef } from 'react'
import { isImeComposing } from '@/lib/utils'

interface FontPickerProps {
  value: string
  fonts: string[]
  onChange: (family: string) => void
  label: string
  dark: boolean
  color: string
  surfaceColor: string
  borderColor: string
}

// Global and per-window settings share one keyboard/IME-aware combobox.
export function FontPicker({ value, fonts, onChange, label, dark, color, surfaceColor, borderColor }: FontPickerProps) {
  const [fontSearch, setFontSearch] = useState('')
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false)
  const [activeFontIndex, setActiveFontIndex] = useState(0)
  const fontListId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState({ above: false, maxHeight: 240 })

  useLayoutEffect(() => {
    if (!fontDropdownOpen) return
    const positionList = () => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const viewport = container.closest('main')?.getBoundingClientRect()
      const below = Math.max(0, Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight) - rect.bottom - 8)
      const above = Math.max(0, rect.top - Math.max(0, viewport?.top ?? 0) - 8)
      const openAbove = below < 240 && above > below
      const maxHeight = Math.min(240, openAbove ? above : below)
      setPlacement((current) => current.above === openAbove && current.maxHeight === maxHeight
        ? current : { above: openAbove, maxHeight })
    }
    positionList()
    window.addEventListener('resize', positionList)
    document.addEventListener('scroll', positionList, true)
    return () => {
      window.removeEventListener('resize', positionList)
      document.removeEventListener('scroll', positionList, true)
    }
  }, [fontDropdownOpen])

  const filteredFonts = useMemo(() => {
    if (!fontSearch) return fonts
    const q = fontSearch.toLowerCase()
    return fonts.filter((f) => f.toLowerCase().includes(q))
  }, [fonts, fontSearch])

  useEffect(() => {
    if (!fontDropdownOpen) return
    document.getElementById(`${fontListId}-${activeFontIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeFontIndex, fontDropdownOpen, fontListId])

  const applyFont = (fontName: string) => {
    onChange(fontName)
    setFontSearch('')
    setFontDropdownOpen(false)
  }

  const handleFontKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setFontDropdownOpen(false)
      setFontSearch('')
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setFontDropdownOpen(true)
      if (filteredFonts.length === 0) return
      setActiveFontIndex((current) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return filteredFonts.length - 1
        return event.key === 'ArrowDown'
          ? (current + 1) % filteredFonts.length
          : (current - 1 + filteredFonts.length) % filteredFonts.length
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = fontDropdownOpen ? filteredFonts[activeFontIndex] : undefined
      const fontName = selected || fontSearch.trim()
      if (fontName) applyFont(fontName)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        maxLength={120}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={fontListId}
        aria-activedescendant={fontDropdownOpen && filteredFonts[activeFontIndex] ? `${fontListId}-${activeFontIndex}` : undefined}
        aria-expanded={fontDropdownOpen}
        aria-label={label}
        value={fontDropdownOpen ? fontSearch : value}
        onChange={(e) => { setFontSearch(e.target.value); setActiveFontIndex(0); setFontDropdownOpen(true) }}
        onFocus={(event) => {
          const input = event.currentTarget
          setFontSearch('')
          setFontDropdownOpen(true)
          input.select()
        }}
        onBlur={() => { setFontDropdownOpen(false); setFontSearch('') }}
        onKeyDown={handleFontKeyDown}
        placeholder={`当前：${value || '默认字体'}；输入可搜索`}
        className="settings-input w-full rounded-lg border px-3 py-2 text-[12px] outline-none transition-colors"
        style={{ borderColor, color }}
      />
      {fontDropdownOpen && filteredFonts.length > 0 && (
        <div
          id={fontListId}
          className={`absolute left-0 right-0 z-30 overflow-auto overscroll-contain rounded-lg shadow-2xl ${placement.above ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          style={{ background: `${surfaceColor}fa`, maxHeight: placement.maxHeight }}
          role="listbox"
          aria-label="系统字体"
        >
          {filteredFonts.map((f, index) => (
            <button
              key={f}
              id={`${fontListId}-${index}`}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setActiveFontIndex(index)}
              onMouseDown={(event) => { event.preventDefault(); applyFont(f) }}
              className={`font-option min-h-8 w-full px-2.5 py-1.5 text-left text-[12px] leading-snug ${index === activeFontIndex ? (dark ? 'bg-white/8' : 'bg-black/8') : (dark ? 'hover:bg-white/5' : 'hover:bg-black/5')} transition-colors`}
              style={{ fontFamily: `"${f}", system-ui, sans-serif` }}
              title={f}
              role="option"
              aria-selected={f === value}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
