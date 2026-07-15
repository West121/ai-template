/**
 * AI 对话「动作卡」结果 store（客户端，按 actionId / 卡片稳定 id 记终态）。
 *
 * 修「卡状态重挂复活」：确认/取消/存草稿等卡的可操作性原本靠**组件本地 state**，关闭/重开 AI 面板
 * → 组件重挂 → 本地 state 重置回可操作 → 卡"复活"（再确认会重复提交/失败）。改由本 store 记结果：
 * 卡 **mount 时先读**（有终态就渲染对应态，不复活）、**确认/取消/完成时写**。
 *
 * 范围：**同一 app 会话内重挂**（关面板重开）不复活——store 为模块级单例，随面板组件重挂而保留。
 * 整页刷新会清空本 store（内存态）；要刷新后也不复活，需后端在会话消息里带动作草稿真实状态
 * （PENDING/CONFIRMED/CANCELLED/EXPIRED）或提供 GET 动作状态端点——见汇报「对账点」。
 */
import { create } from "zustand"

/** 终态：done=已完成执行 / cancelled=已取消 / expired=已过期 / stale=状态已变化 / submitted=已提交待确认（manage-form） */
export type AiActionOutcomeStatus = "done" | "cancelled" | "expired" | "stale" | "submitted"

export interface AiActionOutcome {
  status: AiActionOutcomeStatus
  resultMessage?: string
  resultLink?: string
  error?: string
  /** 卡片特定的重挂恢复快照（如 manage-form 提交后要恢复的 confirm 卡对象） */
  snapshot?: unknown
}

interface AiActionOutcomesState {
  /** key = actionId（confirm/knowledge）/ draftId（草稿卡）/ partId（manage-form） */
  outcomes: Record<string, AiActionOutcome>
  record: (key: string, outcome: AiActionOutcome) => void
  clear: () => void
}

export const useAiActionOutcomes = create<AiActionOutcomesState>((set) => ({
  outcomes: {},
  record: (key, outcome) => set((s) => (key ? { outcomes: { ...s.outcomes, [key]: outcome } } : s)),
  clear: () => set({ outcomes: {} }),
}))

/** 非响应式读取（mount 初始化用；终态写一次即定，无需订阅重渲染）。 */
export function getAiActionOutcome(key: string): AiActionOutcome | undefined {
  return key ? useAiActionOutcomes.getState().outcomes[key] : undefined
}

/** 记录卡的终态（确认/取消/完成时调用）。 */
export function recordAiActionOutcome(key: string, outcome: AiActionOutcome): void {
  if (key) useAiActionOutcomes.getState().record(key, outcome)
}
