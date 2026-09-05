import { create } from 'zustand'
import type { EventTag } from '@/types/tag.types'
import { reportPersistenceIssue } from '@/stores/persistence.store'
import { useCalendarStore } from '@/stores/calendar.store'

interface TagStore {
  tags: EventTag[]
  tagsLoadError: string | null
  addTag: (tag: EventTag) => void
  updateTag: (tag: EventTag) => void
  deleteTag: (id: string) => void
  loadTags: (tags: unknown[]) => void
  loadTagsState: (state: unknown) => void
  getTagById: (id: string) => EventTag | undefined
}

const normalizeTags = (raw: unknown[]): EventTag[] => {
  const seen = new Set<string>()
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const tag = value as Record<string, unknown>
    const id = typeof tag.id === 'string' ? tag.id.trim() : ''
    const name = typeof tag.name === 'string' ? tag.name.trim().slice(0, 50) : ''
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || !name || seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      name,
      color: typeof tag.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(tag.color) ? tag.color : '#2563EB',
      createdAt: typeof tag.createdAt === 'string' ? tag.createdAt : new Date().toISOString(),
    }]
  })
}

function reconcileViewNoteTagFilter(tags: EventTag[]) {
  const validIds = new Set(tags.map((tag) => tag.id))
  useCalendarStore.setState((state) => ({
    viewNoteTagFilter: state.viewNoteTagFilter.filter((id) => validIds.has(id)),
  }))
}

function parseTagsState(value: unknown): { tags?: EventTag[]; loadError?: string } {
  if (Array.isArray(value)) return { tags: normalizeTags(value) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { loadError: '标签数据响应无效，标签已切换为只读。' }
  const state = value as Record<string, unknown>
  const tags = Array.isArray(state.tags) ? normalizeTags(state.tags) : undefined
  if (typeof state.loadError === 'string' && state.loadError.trim()) {
    return {
      ...(state.readOnlyDataAvailable === true && tags ? { tags } : {}),
      loadError: state.loadError.trim(),
    }
  }
  if (!tags) return { loadError: '标签数据响应缺少列表，标签已切换为只读。' }
  return { tags }
}

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],
  tagsLoadError: null,

  addTag: (tag) => {
    if (get().tagsLoadError) {
      reportPersistenceIssue('标签当前为只读', get().tagsLoadError || '请先恢复标签文件后再新增。')
      return
    }
    const previousTags = get().tags
    set((s) => ({ tags: [...s.tags, tag] }))
    if (window.electronAPI?.isElectron) {
      const persist = () => window.electronAPI!.saveTag(tag).then(async (result) => {
        if (result.ok) {
          window.electronAPI!.notifyTagsChanged()
          return
        }
        if (result.loadError) {
          reconcileViewNoteTagFilter(previousTags)
          set({ tags: previousTags, tagsLoadError: result.loadError })
        } else {
          get().loadTagsState(await window.electronAPI!.getTags())
        }
        reportPersistenceIssue('标签未保存', result.message || `“${tag.name}”未能写入磁盘。`, result.loadError ? undefined : persist)
      }).catch((error) => {
        reportPersistenceIssue('标签未保存', error instanceof Error ? error.message : '主进程没有响应。', persist)
      })
      void persist()
    }
  },
  updateTag: (tag) => {
    if (get().tagsLoadError) {
      reportPersistenceIssue('标签当前为只读', get().tagsLoadError || '请先恢复标签文件后再编辑。')
      return
    }
    const previousTags = get().tags
    set((s) => ({ tags: s.tags.map((t) => (t.id === tag.id ? tag : t)) }))
    if (window.electronAPI?.isElectron) {
      const persist = () => window.electronAPI!.saveTag(tag).then(async (result) => {
        if (result.ok) {
          window.electronAPI!.notifyTagsChanged()
          return
        }
        if (result.loadError) {
          reconcileViewNoteTagFilter(previousTags)
          set({ tags: previousTags, tagsLoadError: result.loadError })
        } else {
          get().loadTagsState(await window.electronAPI!.getTags())
        }
        reportPersistenceIssue('标签未保存', result.message || `“${tag.name}”的修改未能写入磁盘。`, result.loadError ? undefined : persist)
      }).catch((error) => reportPersistenceIssue('标签未保存', error instanceof Error ? error.message : '主进程没有响应。', persist))
      void persist()
    }
  },
  deleteTag: (id) => {
    if (get().tagsLoadError) {
      reportPersistenceIssue('标签当前为只读', get().tagsLoadError || '请先恢复标签文件后再删除。')
      return
    }
    if (window.electronAPI?.isElectron) {
      void window.electronAPI.deleteTag(id).then((result) => {
        if (result.ok) {
          set((s) => {
            const tags = s.tags.filter((t) => t.id !== id)
            reconcileViewNoteTagFilter(tags)
            return { tags }
          })
          window.electronAPI!.notifyTagsChanged()
        } else if (!result.canceled) {
          void window.electronAPI!.getTags().then((latest) => get().loadTagsState(latest))
          reportPersistenceIssue('标签未删除', result.message || '跨事件与便签的更新未能完整写入，已回滚磁盘数据。', result.loadError ? undefined : () => get().deleteTag(id))
        }
      }).catch((error) => {
        void window.electronAPI!.getTags().then((latest) => get().loadTagsState(latest))
        reportPersistenceIssue('标签未删除', error instanceof Error ? error.message : '主进程没有响应。', () => get().deleteTag(id))
      })
      return
    }
    set((s) => {
      const tags = s.tags.filter((t) => t.id !== id)
      reconcileViewNoteTagFilter(tags)
      return { tags }
    })
  },
  loadTags: (raw) => {
    const tags = normalizeTags(raw)
    reconcileViewNoteTagFilter(tags)
    set({ tags, tagsLoadError: null })
  },
  loadTagsState: (raw) => {
    const state = parseTagsState(raw)
    if (state.loadError) {
      if (state.tags) {
        reconcileViewNoteTagFilter(state.tags)
        set({ tags: state.tags, tagsLoadError: state.loadError })
      } else {
        set({ tagsLoadError: state.loadError })
      }
      return
    }
    const tags = state.tags || []
    reconcileViewNoteTagFilter(tags)
    set({ tags, tagsLoadError: null })
  },
  getTagById: (id) => get().tags.find((t) => t.id === id),
}))
