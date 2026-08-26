import { useUndoStore } from '@/stores/undo.store'

export function UndoNotice() {
  const entries = useUndoStore((state) => state.entries)
  const dismiss = useUndoStore((state) => state.dismiss)
  const run = useUndoStore((state) => state.run)

  if (entries.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-2 z-[100010] flex flex-col items-center gap-1.5" aria-live="polite">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="pointer-events-auto flex max-w-full items-center gap-2 rounded-lg border border-white/15 bg-[#242426]/95 px-2.5 py-1.5 text-xs text-white shadow-lg"
          role="status"
        >
          <span className="min-w-0 truncate">{entry.message}</span>
          <button type="button" onClick={() => run(entry.id)} className="min-h-7 shrink-0 rounded px-2 font-medium text-blue-300 hover:bg-white/8">
            撤销
          </button>
          <button type="button" onClick={() => dismiss(entry.id)} className="min-h-7 shrink-0 rounded px-1.5 text-white/55 hover:bg-white/8 hover:text-white" aria-label="关闭撤销提示">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
