import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface TabItem {
  /** 即路由路径 */
  key: string
  title: string
  /** 固定标签不可关闭，排在最前 */
  pinned: boolean
}

export const HOME_TAB: TabItem = { key: "/dashboard", title: "工作台", pinned: true }

interface TabsState {
  tabs: TabItem[]
  addTab: (tab: Omit<TabItem, "pinned">) => void
  closeTab: (key: string) => void
  closeOthers: (key: string) => void
  closeLeft: (key: string) => void
  closeRight: (key: string) => void
  closeAll: () => void
  togglePin: (key: string) => void
}

/** 固定标签排前面 */
function sortTabs(tabs: TabItem[]): TabItem[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set) => ({
      tabs: [HOME_TAB],
      addTab: (tab) =>
        set((state) => {
          if (state.tabs.some((t) => t.key === tab.key)) return state
          return { tabs: sortTabs([...state.tabs, { ...tab, pinned: false }]) }
        }),
      closeTab: (key) =>
        set((state) => ({ tabs: state.tabs.filter((t) => t.key !== key || t.pinned) })),
      closeOthers: (key) =>
        set((state) => ({ tabs: state.tabs.filter((t) => t.key === key || t.pinned) })),
      closeLeft: (key) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => t.key === key)
          return { tabs: state.tabs.filter((t, i) => i >= index || t.pinned) }
        }),
      closeRight: (key) =>
        set((state) => {
          const index = state.tabs.findIndex((t) => t.key === key)
          return { tabs: state.tabs.filter((t, i) => i <= index || t.pinned) }
        }),
      closeAll: () => set((state) => ({ tabs: state.tabs.filter((t) => t.pinned) })),
      togglePin: (key) =>
        set((state) => ({
          tabs: sortTabs(
            state.tabs.map((t) => (t.key === key ? { ...t, pinned: !t.pinned } : t)),
          ),
        })),
    }),
    { name: "oa-tabs" },
  ),
)
