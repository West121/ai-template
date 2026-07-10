import { create } from "zustand"

/** 菜单徽标的动态数据源（如真实的待审批数量），按菜单 path 覆盖 menu.ts 里的静态 badge */
interface BadgeState {
  badges: Record<string, number | undefined>
  setBadge: (path: string, count: number | undefined) => void
  reset: () => void
}

export const useBadgeStore = create<BadgeState>()((set) => ({
  badges: {},
  setBadge: (path, count) => set((state) => ({ badges: { ...state.badges, [path]: count } })),
  reset: () => set({ badges: {} }),
}))
