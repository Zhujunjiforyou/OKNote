import { lazy, Suspense, useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PersistenceNotice } from '@/components/PersistenceNotice'
import { UndoNotice } from '@/components/UndoNotice'
import { MotionConfig } from 'framer-motion'

const CalendarWindow = lazy(() => import('@/components/windows/CalendarWindow').then((module) => ({ default: module.CalendarWindow })))
const NoteWindow = lazy(() => import('@/components/windows/NoteWindow').then((module) => ({ default: module.NoteWindow })))
const SettingsWindow = lazy(() => import('@/components/windows/SettingsWindow').then((module) => ({ default: module.SettingsWindow })))

function WindowFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent text-xs text-slate-300/35 select-none">
      OKNote
    </div>
  )
}

function PreviewModeNotice() {
  if (window.electronAPI?.isElectron) return null
  return (
    <div className="fixed bottom-3 left-1/2 z-[100000] -translate-x-1/2 rounded-full border border-amber-300/30 bg-slate-950/95 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-xl" role="status">
      浏览器预览模式 · 修改不会写入本地文件
    </div>
  )
}

function ReducedMotionSync() {
  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => window.electronAPI?.setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return null
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [])

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
      <div className="h-screen w-screen flex items-center justify-center bg-[#08111f] select-none">
        <span className="text-xs text-muted-foreground/30">OKNote</span>
      </div>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={300}>
        <Suspense fallback={<WindowFallback />}>
          {renderWindow()}
        </Suspense>
        <PersistenceNotice />
        <UndoNotice />
        <PreviewModeNotice />
        <ReducedMotionSync />
      </TooltipProvider>
    </MotionConfig>
  )
}
