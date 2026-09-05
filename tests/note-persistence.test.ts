import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { commitNoteSnapshot } = require('../electron/note-persistence.cjs') as {
  commitNoteSnapshot: (options: {
    noteId: string
    existing?: Record<string, unknown> | null
    snapshot: Record<string, unknown>
    expectedRevision?: number
    write: (note: Record<string, unknown>) => boolean
    cache?: Map<string, Record<string, unknown>>
    now?: () => string
  }) => { ok: boolean; code?: string; note?: Record<string, unknown> }
}

describe('note persistence revisions', () => {
  it('updates disk and the live cache with the same committed snapshot', () => {
    const cache = new Map<string, Record<string, unknown>>()
    let disk: Record<string, unknown> = { id: 'note-1', title: '旧标题', items: [], revision: 0 }

    const result = commitNoteSnapshot({
      noteId: 'note-1',
      existing: disk,
      snapshot: { title: '新标题', items: [{ id: 'todo-1', content: '新待办' }], revision: 0 },
      expectedRevision: 0,
      write: (note) => { disk = note; return true },
      cache,
      now: () => '2026-08-25T10:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(disk).toMatchObject({ title: '新标题', revision: 1 })
    expect(cache.get('note-1')).toEqual(disk)
  })

  it('rejects a stale renderer without overwriting the first committed edit', () => {
    const cache = new Map<string, Record<string, unknown>>()
    let disk: Record<string, unknown> = { id: 'note-1', title: '原始', items: [], revision: 0 }
    let writes = 0
    const write = (note: Record<string, unknown>) => { writes += 1; disk = note; return true }

    const first = commitNoteSnapshot({
      noteId: 'note-1', existing: disk, snapshot: { title: '窗口 A' }, expectedRevision: 0, write, cache,
    })
    const second = commitNoteSnapshot({
      noteId: 'note-1', existing: cache.get('note-1'), snapshot: { title: '窗口 B' }, expectedRevision: 0, write, cache,
    })

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: false, code: 'conflict' })
    expect(writes).toBe(1)
    expect(disk.title).toBe('窗口 A')
    expect(cache.get('note-1')?.title).toBe('窗口 A')
  })

  it('does not advance the cache or visible revision when the disk write fails', () => {
    const existing: Record<string, unknown> = { id: 'note-1', title: '已持久化', items: [], revision: 3 }
    const cache = new Map<string, Record<string, unknown>>([['note-1', existing]])
    const result = commitNoteSnapshot({
      noteId: 'note-1',
      existing,
      snapshot: { ...existing, title: '不应显示' },
      expectedRevision: 3,
      write: () => false,
      cache,
    })

    expect(result).toMatchObject({ ok: false, code: 'save_failed' })
    expect(cache.get('note-1')).toEqual(existing)
  })

  it('lets a renderer edit immediately after a dock transition broadcasts the committed revision', () => {
    const cache = new Map<string, Record<string, unknown>>()
    let disk: Record<string, unknown> = { id: 'note-1', title: '挂载前', items: [], revision: 5 }
    const write = (note: Record<string, unknown>) => { disk = note; return true }

    const docked = commitNoteSnapshot({
      noteId: 'note-1',
      existing: disk,
      snapshot: { ...disk, isDocked: true },
      write,
      cache,
    })
    expect(docked).toMatchObject({ ok: true, note: { revision: 6, isDocked: true } })

    const immediateEdit = commitNoteSnapshot({
      noteId: 'note-1',
      existing: cache.get('note-1'),
      snapshot: { ...docked.note, title: '挂载后立即编辑' },
      expectedRevision: Number(docked.note?.revision),
      write,
      cache,
    })

    expect(immediateEdit).toMatchObject({ ok: true, note: { title: '挂载后立即编辑', revision: 7 } })
    expect(disk).toEqual(immediateEdit.note)
  })
})
