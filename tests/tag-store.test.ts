import { beforeEach, describe, expect, it } from 'vitest'
import { useCalendarStore } from '../src/stores/calendar.store'
import { useTagStore } from '../src/stores/tag.store'

describe('tag filter reconciliation', () => {
  beforeEach(() => {
    useCalendarStore.setState({ viewNoteTagFilter: [] })
    useTagStore.setState({ tags: [], tagsLoadError: null })
  })

  it('removes deleted and otherwise missing tag ids from the view-note filter', () => {
    useCalendarStore.setState({ viewNoteTagFilter: ['keep', 'deleted'] })
    useTagStore.getState().loadTagsState({
      tags: [{ id: 'keep', name: '保留', color: '#2563EB', createdAt: '2026-08-30T00:00:00.000Z' }],
    })

    expect(useCalendarStore.getState().viewNoteTagFilter).toEqual(['keep'])
    useTagStore.getState().loadTagsState({ tags: [] })
    expect(useCalendarStore.getState().viewNoteTagFilter).toEqual([])
  })

  it('preserves the last known tag list while a damaged file is read-only', () => {
    useTagStore.getState().loadTags([{ id: 'keep', name: '保留', color: '#2563EB' }])
    useTagStore.getState().loadTagsState({ tags: [], loadError: '标签文件损坏' })

    expect(useTagStore.getState().tags.map((tag) => tag.id)).toEqual(['keep'])
    expect(useTagStore.getState().tagsLoadError).toBe('标签文件损坏')
  })

  it('shows validated backup tags while recovery is read-only', () => {
    useTagStore.getState().loadTags([{ id: 'stale', name: '旧标签', color: '#64748B' }])
    useTagStore.getState().loadTagsState({
      tags: [{ id: 'backup', name: '备份标签', color: '#2563EB' }],
      loadError: '主文件写回失败',
      readOnlyDataAvailable: true,
    })

    expect(useTagStore.getState().tags.map((tag) => tag.id)).toEqual(['backup'])
    expect(useTagStore.getState().tagsLoadError).toBe('主文件写回失败')
  })

  it('treats a malformed IPC response as read-only instead of an empty tag list', () => {
    useTagStore.getState().loadTags([{ id: 'keep', name: '保留', color: '#2563EB' }])
    useTagStore.getState().loadTagsState({})

    expect(useTagStore.getState().tags.map((tag) => tag.id)).toEqual(['keep'])
    expect(useTagStore.getState().tagsLoadError).toContain('只读')
  })
})
