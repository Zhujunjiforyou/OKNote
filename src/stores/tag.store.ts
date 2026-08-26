import { create } from 'zustand'
import type { EventTag } from '@/types/tag.types'
import { reportPersistenceIssue } from '@/stores/persistence.store'

interface TagStore {
  tags: EventTag[]
  addTag: (tag: EventTag) => void
  updateTag: (tag: EventTag) => void
  deleteTag: (id: string) => void
  loadTags: (tags: unknown[]) => void
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

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],

  addTag: (tag) => {
    set((s) => ({ tags: [...s.tags, tag] }))
    if (window.electronAPI?.isElectron) {
      const persist = () => window.electronAPI!.saveTag(tag).then(async (saved) => {
        if (saved) {
          window.electronAPI!.notifyTagsChanged()
          return
        }
        const latest = await window.electronAPI!.getTags()
        get().loadTags(latest)
        reportPersistenceIssue('标签未保存', `“${tag.name}”未能写入磁盘。`, persist)
      }).catch((error) => {
        reportPersistenceIssue('标签未保存', error instanceof Error ? error.message : '主进程没有响应。', persist)
      })
      void persist()
    }
  },
  updateTag: (tag) => {
    set((s) => ({ tags: s.tags.map((t) => (t.id === tag.id ? tag : t)) }))
    if (window.electronAPI?.isElectron) {
      const persist = () => window.electronAPI!.saveTag(tag).then(async (saved) => {
        if (saved) {
          window.electronAPI!.notifyTagsChanged()
          return
        }
        get().loadTags(await window.electronAPI!.getTags())
        reportPersistenceIssue('标签未保存', `“${tag.name}”的修改未能写入磁盘。`, persist)
      }).catch((error) => reportPersistenceIssue('标签未保存', error instanceof Error ? error.message : '主进程没有响应。', persist))
      void persist()
    }
  },
  deleteTag: (id) => {
    if (window.electronAPI?.isElectron) {
      void window.electronAPI.deleteTag(id).then((result) => {
        if (result.ok) {
          set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
          window.electronAPI!.notifyTagsChanged()
        } else if (!result.canceled) {
          void window.electronAPI!.getTags().then((latest) => get().loadTags(latest))
          reportPersistenceIssue('标签未删除', result.message || '跨事件与便签的更新未能完整写入，已回滚磁盘数据。', () => get().deleteTag(id))
        }
      }).catch((error) => {
        void window.electronAPI!.getTags().then((latest) => get().loadTags(latest))
        reportPersistenceIssue('标签未删除', error instanceof Error ? error.message : '主进程没有响应。', () => get().deleteTag(id))
      })
      return
    }
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
  },
  loadTags: (tags) => set({ tags: normalizeTags(tags) }),
  getTagById: (id) => get().tags.find((t) => t.id === id),
}))
