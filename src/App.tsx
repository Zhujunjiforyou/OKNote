import { TooltipProvider } from '@/components/ui/tooltip'
import { CalendarWindow } from '@/components/windows/CalendarWindow'
import { NoteWindow } from '@/components/windows/NoteWindow'
import { SettingsWindow } from '@/components/windows/SettingsWindow'

export default function App() {
  const hash = window.location.hash

  const renderWindow = () => {
    if (hash.startsWith('#/calendar')) return <CalendarWindow />
    if (hash.startsWith('#/note/')) {
      const rest = hash.replace('#/note/', '')
      const [noteId, flag] = rest.split('/')
      const isNew = flag === 'new'
      return <NoteWindow noteId={noteId} isNew={isNew} />
    }
    if (hash === '#/settings') return <SettingsWindow />
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0d0d10] select-none">
        <span className="text-xs text-muted-foreground/30">OKNote</span>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      {renderWindow()}
    </TooltipProvider>
  )
}
