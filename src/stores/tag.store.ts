import { create } from 'zustand'
import type { EventTag } from '@/types/tag.types'

interface TagStore {
  tags: EventTag[]
  addTag: (tag: EventTag) => void
  updateTag: (tag: EventTag) => void
  deleteTag: (id: string) => void
  loadTags: (tags: EventTag[]) => void
  getTagById: (id: string) => EventTag | undefined
}

let tagSaveTimer: ReturnType<typeof setTimeout> | null = null
const saveTags = () => {
  if (window.electronAPI?.isElectron) {
    window.electronAPI.saveAppData('tags', useTagStore.getState().tags).then(() => {
      window.electronAPI!.notifyTagsChanged()
    })
  }
}
const debouncedSaveTags = () => {
  if (tagSaveTimer) clearTimeout(tagSaveTimer)
  tagSaveTimer = setTimeout(() => { saveTags(); tagSaveTimer = null }, 300)
}

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],

  addTag: (tag) => {
    set((s) => ({ tags: [...s.tags, tag] }))
    debouncedSaveTags()
  },
  updateTag: (tag) => {
    set((s) => ({ tags: s.tags.map((t) => (t.id === tag.id ? tag : t)) }))
    debouncedSaveTags()
  },
  deleteTag: (id) => {
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
    debouncedSaveTags()
    // Also notify main process to cascade-delete tag from events
    if (window.electronAPI?.isElectron) {
      window.electronAPI.deleteTag(id)
    }
  },
  loadTags: (tags) => set({ tags }),
  getTagById: (id) => get().tags.find((t) => t.id === id),
}))
