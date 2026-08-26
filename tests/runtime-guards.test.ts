import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { hasRevisionConflict } = require('../electron/event-concurrency.cjs') as {
  hasRevisionConflict: (expected: unknown, current: number) => boolean
}
const { calendarMinimumForWorkArea, noteMinimumForWorkArea } = require('../electron/window-constraints.cjs') as {
  calendarMinimumForWorkArea: (workArea: { width: number; height: number }) => { width: number; height: number }
  noteMinimumForWorkArea: (workArea: { width: number; height: number }) => { width: number; height: number }
}

describe('event revision guard', () => {
  it('rejects a stale renderer revision and permits omitted compatibility revisions', () => {
    expect(hasRevisionConflict(41, 42)).toBe(true)
    expect(hasRevisionConflict(42, 42)).toBe(false)
    expect(hasRevisionConflict(undefined, 42)).toBe(false)
  })
})

describe('responsive native window constraints', () => {
  it('allows the calendar to reach its compact responsive layout', () => {
    expect(calendarMinimumForWorkArea({ width: 1920, height: 1080 })).toEqual({ width: 344, height: 284 })
    expect(calendarMinimumForWorkArea({ width: 330, height: 276 })).toEqual({ width: 320, height: 260 })
  })

  it('keeps compact notes smaller than calendar windows', () => {
    expect(noteMinimumForWorkArea({ width: 1920, height: 1080 })).toEqual({ width: 160, height: 170 })
  })
})

describe('critical Electron workflow wiring', () => {
  const mainSource = readFileSync(join(process.cwd(), 'electron', 'main.cjs'), 'utf8')
  const preloadSource = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8')
  const jsonStoreSource = readFileSync(join(process.cwd(), 'electron', 'json-store.cjs'), 'utf8')
  const calendarWindowSource = readFileSync(join(process.cwd(), 'src', 'components', 'windows', 'CalendarWindow.tsx'), 'utf8')
  const settingsWindowSource = readFileSync(join(process.cwd(), 'src', 'components', 'windows', 'SettingsWindow.tsx'), 'utf8')
  const eventFormSource = readFileSync(join(process.cwd(), 'src', 'components', 'calendar', 'EventForm.tsx'), 'utf8')
  const eventDetailSource = readFileSync(join(process.cwd(), 'src', 'components', 'calendar', 'EventDetailModal.tsx'), 'utf8')
  const dayCellSource = readFileSync(join(process.cwd(), 'src', 'components', 'calendar', 'DayCell.tsx'), 'utf8')
  const echoEventListSource = readFileSync(join(process.cwd(), 'src', 'components', 'notes', 'EchoEventList.tsx'), 'utf8')
  const dockedCardSource = readFileSync(join(process.cwd(), 'src', 'components', 'dock', 'DockedNoteCard.tsx'), 'utf8')
  const dockedCarouselSource = readFileSync(join(process.cwd(), 'src', 'components', 'dock', 'DockedNotesCarousel.tsx'), 'utf8')
  const dailyTodoSource = readFileSync(join(process.cwd(), 'src', 'components', 'notes', 'DailyTodoPanel.tsx'), 'utf8')
  const todoItemSource = readFileSync(join(process.cwd(), 'src', 'components', 'notes', 'TodoItem.tsx'), 'utf8')
  const noteWindowSource = readFileSync(join(process.cwd(), 'src', 'components', 'windows', 'NoteWindow.tsx'), 'utf8')
  const notesStoreSource = readFileSync(join(process.cwd(), 'src', 'stores', 'notes.store.ts'), 'utf8')
  const tagStoreSource = readFileSync(join(process.cwd(), 'src', 'stores', 'tag.store.ts'), 'utf8')
  const readmeSource = readFileSync(join(process.cwd(), 'README.md'), 'utf8')
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    engines?: { node?: string }
    build: { directories: { output: string } }
  }

  it('keeps persistence local, plain and intentionally small', () => {
    expect(jsonStoreSource).toContain('writeFileAtomic')
    expect(jsonStoreSource).toContain('`${filePath}.bak`')
    expect(mainSource).toContain('copyMissingRecursive')
    expect(mainSource).toContain('if (fs.existsSync(destination)) return')
    for (const removedScope of [
      'safeStorage',
      'portable-backup',
      'export-portable-backup',
      'migration-conflict',
      'cleanup-legacy-migration-source',
      '.transactions',
      '.swap',
      'MAX_PLAINTEXT_JSON_BYTES',
      'rendererHasRole',
      '无权',
    ]) {
      expect(mainSource).not.toContain(removedScope)
      expect(preloadSource).not.toContain(removedScope)
    }
    expect(existsSync(join(process.cwd(), 'scripts', 'check-release-signing.cjs'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'scripts', 'verify-release-signature.cjs'))).toBe(false)
  })

  it('keeps committed notes in cache, rejects stale saves, and surfaces damaged business files', () => {
    expect(mainSource).toContain('saveNoteDataResult(noteId,safeData,{expectedRevision})')
    expect(mainSource).toContain('cache: noteCache')
    expect(mainSource).not.toContain('const saved = saveAppData(`${key}.json`,safeData)')
    expect(notesStoreSource).toContain('const noteSaveQueues = new Map')
    expect(notesStoreSource).toContain('while (state.pending)')
    expect(notesStoreSource).toContain("result.code === 'conflict'")
    expect(mainSource).toContain('if (reportFailure) reportDataReadFailure(fileName, e)')
    expect(mainSource).toContain('应用没有用空数据覆盖')
  })

  it('keeps event entries keyboard reachable and documents the real packaging runtime', () => {
    expect(dayCellSource).toContain('tabIndex={0}')
    expect(packageJson.engines?.node).toBe('>=22.12.0')
    expect(readmeSource).toContain('Node.js >= 22.12')
  })

  it('lets daily notes read recurring events without a renderer permission gate', () => {
    expect(mainSource).toContain("ipcMain.handle('get-events-state',()=>getEventsState())")
    expect(dailyTodoSource).toContain('getEventsState().then')
    expect(dailyTodoSource).toContain('.filter((event) => event.recurrence)')
  })

  it('retries failed event reads before reminder scanning and does not checkpoint an unreadable file', () => {
    expect(mainSource).toContain('loadEventsSnapshot(Boolean(eventsLoadError))')
    expect(mainSource).toMatch(/if \(eventsLoadError\) \{[\s\S]*?Reminder scan deferred[\s\S]*?return;/)
  })

  it('wires every interactive draft into close and destructive-action guards', () => {
    expect(preloadSource).toContain('set-window-draft-state')
    expect(mainSource).toContain('attachDraftCloseGuard(win)')
    expect(mainSource).toContain("confirmDiscardWindowDrafts(drag.win,'挂载')")
    expect(mainSource).toContain("confirmDiscardNoteDrafts([noteId],'移入回收站'")
    expect(mainSource).toContain("'todo-edit', 'date-edit', 'tag-form'")
    expect(dailyTodoSource).toContain("'daily-date', 'date-edit'")
    expect(todoItemSource).toContain('onDraftChange?.(item.id, dirty)')
    expect(settingsWindowSource).toContain("setWindowDraftState(tagFormDirty ? ['tag-form'] : [])")
    expect(settingsWindowSource).toContain("if (event.key !== 'Escape') return")
  })

  it('retains dock drafts across responsive and carousel unmount paths', () => {
    expect(calendarWindowSource).toContain('const renderDockArea = showDockArea || hasDockDrafts')
    expect(dockedCarouselSource).toContain('const mountedNotes = useMemo')
    expect(dockedCarouselSource).toContain('key={note.id}')
    expect(dockedCarouselSource).not.toContain('key={`${note.id}:${typographyLayoutTier}`}')
    expect(dailyTodoSource).toContain("confirmWindowDraftAction('切换日期', note.id)")
  })

  it('offers an eight-second undo for ordinary todo deletion', () => {
    const undoStoreSource = readFileSync(join(process.cwd(), 'src', 'stores', 'undo.store.ts'), 'utf8')
    expect(todoItemSource).toContain('addUndo(`已删除“${deleted.content}”`')
    expect(notesStoreSource).toContain('restoreItem: (noteId, item, index)')
    expect(undoStoreSource).toContain('durationMs = 8000')
  })

  it('refreshes tag-view labels and makes title editing discoverable', () => {
    expect(noteWindowSource).toContain('const tags = useTagStore((s) => s.tags)')
    expect(dockedCardSource).toContain('const tags = useTagStore((s) => s.tags)')
    expect(noteWindowSource).toContain('onClick={startEditTitle}')
    expect(dockedCardSource).toContain('onClick={startEditTitle}')
    expect(calendarWindowSource).toContain('标签视图便签')
    expect(tagStoreSource).toContain('notifyTagsChanged()')
  })

  it('distinguishes canceled actions from persistence failures and names edit fields', () => {
    expect(mainSource).toContain("{ok:false,canceled:true,message:'已取消，便签和草稿均保留'}")
    expect(mainSource).toContain("{ok:false,canceled:true,message:'已取消挂载，草稿仍保留'}")
    expect(mainSource).toContain("{ok:false,canceled:true,message:'已取消删除标签，便签和草稿均保留'}")
    expect(dockedCardSource).toContain('if (result.canceled) return')
    expect(noteWindowSource).toContain('if (result.canceled) return')
    expect(notesStoreSource).toContain('if (result.canceled) return')
    expect(tagStoreSource).toContain('else if (!result.canceled)')
    expect(dailyTodoSource).toContain('aria-label="每日待办日期"')
  })

  it('stops edge polling away from an edge and covers the reminder catch-up horizon', () => {
    expect(mainSource).toMatch(/if\(!nearEdge&&!isCalendarCollapsed\)\{[\s\S]*?stopEdgePolling\(\)/)
    expect(mainSource).toContain('Math.ceil(REMINDER_MAX_CATCH_UP_MS / DAY_MS) + 370')
  })

  it('keeps tiny-window event actions visible and isolates each build version', () => {
    expect(eventFormSource).toContain('sticky bottom-0')
    expect(eventFormSource).toContain('max-h-[calc(100vh-12px)]')
    expect(packageJson.build.directories.output).toBe('release/${version}')
  })

  it('keeps recurrence instances, time ranges, reminders, and tag history semantically explicit', () => {
    expect(dayCellSource).toContain('event.occurrenceDate || event.startDate')
    expect(eventDetailSource).toContain('编辑和删除会作用于整个循环系列')
    expect(eventDetailSource).toContain('编辑整个系列')
    expect(eventFormSource).toContain('(isMultiDay || !isAllDay)')
    expect(eventFormSource).toContain('设置提醒前，请先选择开始时间')
    expect(mainSource).toContain('if (reminder && (next.isAllDay || startTime))')
    expect(mainSource).not.toContain("event.startTime || '09:00'")
    expect(echoEventListSource).not.toContain('addDaysToDateKey(today, -90)')
  })

  it('verifies the exact --hidden login registration and exposes a result-returning IPC', () => {
    expect(mainSource).toContain("app.getLoginItemSettings({ path: process.execPath, args: desiredArgs })")
    expect(mainSource).toContain("ipcMain.handle('set-start-minimized'")
    expect(preloadSource).toContain("ipcRenderer.invoke('set-start-minimized'")
  })
})
