import { ViewNotePanel } from './ViewNotePanel'
import { DockedNotesCarousel } from './DockedNotesCarousel'

interface DockAreaProps {
  height: number
}

export function DockArea({ height }: DockAreaProps) {
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
      <DockedNotesCarousel />
    </div>
  )
}
