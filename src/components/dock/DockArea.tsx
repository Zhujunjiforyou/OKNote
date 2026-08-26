import { ViewNotePanel } from './ViewNotePanel'
import { DockedNotesCarousel } from './DockedNotesCarousel'
import type { DockedNoteDraftKind } from './DockedNoteCard'

interface DockAreaProps {
  height: number
  onDraftChange?: (key: string, kind: DockedNoteDraftKind, dirty: boolean) => void
}

export function DockArea({ height, onDraftChange }: DockAreaProps) {
  return (
    <div
      data-dock-area
      className="relative z-[40] shrink-0 border-t flex flex-row overflow-hidden"
      style={{
        borderColor: 'var(--border, rgba(255,255,255,0.08))',
        height,
        backgroundColor: 'transparent',
      }}
    >
      <ViewNotePanel />
      <DockedNotesCarousel onDraftChange={onDraftChange} />
    </div>
  )
}
