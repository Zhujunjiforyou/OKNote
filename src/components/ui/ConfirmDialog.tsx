import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDialogFocusTrap } from '@/hooks/useDialogFocusTrap'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useDialogFocusTrap(open)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCancel()
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [onCancel, open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onCancel()
          }}
        >
          <motion.div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-[360px] overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl shadow-black/35"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.16 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 pb-4 pt-5">
              <span
                className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  destructive ? 'bg-red-500/12 text-red-500' : 'bg-amber-500/12 text-amber-600'
                }`}
                aria-hidden="true"
              >
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0 select-text">
                <h2 id={titleId} className="text-sm font-semibold leading-6">{title}</h2>
                <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-secondary/30 px-4 py-3">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`min-h-9 rounded-lg px-3 text-xs font-semibold text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  destructive
                    ? 'bg-red-500/85 hover:bg-red-500 focus-visible:outline-red-300'
                    : 'bg-blue-500/85 hover:bg-blue-500 focus-visible:outline-blue-300'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
