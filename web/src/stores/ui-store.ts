import { create } from "zustand"

interface UiState {
  settingsOpen: boolean
  searchOpen: boolean
  /** 变更后内容区重新挂载，实现“刷新当前页” */
  refreshKey: number
  setSettingsOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void
  refreshPage: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  settingsOpen: false,
  searchOpen: false,
  refreshKey: 0,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  refreshPage: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
}))
