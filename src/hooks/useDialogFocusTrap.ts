import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocusTrap(active: boolean) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog || dialog.contains(document.activeElement)) return
      dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
    })
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hidden && element.getClientRects().length > 0)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', trapFocus)
      previousFocus?.focus()
    }
  }, [active])

  return dialogRef
}
