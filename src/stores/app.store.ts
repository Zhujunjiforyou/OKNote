import { create } from 'zustand'

interface AppStore {
  dataReady: boolean
  setDataReady: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  dataReady: false,
  setDataReady: () => set({ dataReady: true }),
}))
