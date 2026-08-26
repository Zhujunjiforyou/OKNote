import { create } from 'zustand'

export interface PersistenceIssue {
  id: string
  title: string
  message: string
  retry?: () => void | Promise<void>
  createdAt: number
}

interface PersistenceStore {
  issue: PersistenceIssue | null
  report: (issue: Omit<PersistenceIssue, 'id' | 'createdAt'>) => void
  clear: () => void
}

export const usePersistenceStore = create<PersistenceStore>((set) => ({
  issue: null,
  report: (issue) => set({
    issue: {
      ...issue,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    },
  }),
  clear: () => set({ issue: null }),
}))

export function reportPersistenceIssue(
  title: string,
  message: string,
  retry?: () => void | Promise<void>,
) {
  usePersistenceStore.getState().report({ title, message, retry })
}
