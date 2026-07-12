import { create } from "zustand"
import { persist } from "zustand/middleware"

/** 布局模式：vertical 侧边布局 / horizontal 顶部布局 / mixed 混合布局 */
export type LayoutMode = "vertical" | "horizontal" | "mixed"
export type ThemeMode = "light" | "dark" | "system"
/** 标签页风格：default 圆角卡片 / chrome 谷歌浏览器风格 */
export type TabStyle = "default" | "chrome"
/** 工作台风格：classic 经典（默认，保持现状）/ focus 清爽聚焦 */
export type DashboardStyle = "classic" | "focus"

export interface AppSettings {
  layout: LayoutMode
  themeMode: ThemeMode
  /** 主题色（hex） */
  primaryColor: string
  /** 圆角大小（rem） */
  radius: number
  sidebarCollapsed: boolean
  /** 侧边菜单手风琴模式（同级只展开一个） */
  accordionMenu: boolean
  showTabs: boolean
  tabStyle: TabStyle
  showBreadcrumb: boolean
  showFooter: boolean
  /** 页面内容最大宽度限制 */
  contentCompact: boolean
  grayscale: boolean
  colorWeak: boolean
  /** 工作台风格（经典 / 聚焦），持久化，默认经典保持现状 */
  dashboardStyle: DashboardStyle
}

export const DEFAULT_SETTINGS: AppSettings = {
  layout: "vertical",
  themeMode: "light",
  primaryColor: "#2563eb",
  radius: 0.5,
  sidebarCollapsed: false,
  accordionMenu: true,
  showTabs: true,
  tabStyle: "default",
  showBreadcrumb: true,
  showFooter: true,
  contentCompact: false,
  grayscale: false,
  colorWeak: false,
  dashboardStyle: "classic",
}

interface AppState extends AppSettings {
  updateSettings: (partial: Partial<AppSettings>) => void
  resetSettings: () => void
  toggleSidebar: () => void
  /** 工作台风格切换（经典 / 聚焦），持久化 */
  setDashboardStyle: (style: DashboardStyle) => void
  /** 系统·用户管理 左部门树宽度（可拖，持久化；不随主题 reset 清除） */
  sysDeptTreeWidth: number
  setSysDeptTreeWidth: (width: number) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      sysDeptTreeWidth: 240,
      updateSettings: (partial) => set(partial),
      resetSettings: () => set(DEFAULT_SETTINGS),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setDashboardStyle: (dashboardStyle) => set({ dashboardStyle }),
      setSysDeptTreeWidth: (width) => set({ sysDeptTreeWidth: width }),
    }),
    { name: "oa-app-settings" },
  ),
)
