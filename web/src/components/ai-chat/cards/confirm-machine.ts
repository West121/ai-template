/**
 * confirm 卡片状态机（丹青 §3.2）：idle → submitting → done | idle(失败可重试) / cancelled / expired。
 * 纯函数 reducer（node 可测）；卡片组件用 useReducer 驱动。
 */

export type ConfirmState = "idle" | "submitting" | "done" | "cancelled" | "expired"

export type ConfirmEvent =
  | { type: "CONFIRM" }
  | { type: "SUCCESS"; message?: string; resultLink?: string }
  | { type: "FAILURE"; expired?: boolean }
  | { type: "CANCEL" }

export interface ConfirmCardState {
  state: ConfirmState
  /** done 态的结果文案 / 链接 */
  resultMessage?: string
  resultLink?: string
  /** idle 态的上次失败提示（可重试） */
  error?: string
}

export const CONFIRM_INITIAL: ConfirmCardState = { state: "idle" }

/**
 * 状态转移：
 *  - idle --CONFIRM--> submitting；idle --CANCEL--> cancelled
 *  - submitting --SUCCESS--> done；--FAILURE(expired)--> expired；--FAILURE--> idle(带 error 可重试)
 *  - done/cancelled/expired 为终态（任何事件不再迁移）
 */
export function confirmReducer(s: ConfirmCardState, e: ConfirmEvent): ConfirmCardState {
  switch (s.state) {
    case "idle":
      if (e.type === "CONFIRM") return { state: "submitting" }
      if (e.type === "CANCEL") return { state: "cancelled" }
      return s
    case "submitting":
      if (e.type === "SUCCESS") return { state: "done", resultMessage: e.message, resultLink: e.resultLink }
      if (e.type === "FAILURE") {
        return e.expired ? { state: "expired" } : { state: "idle", error: "执行失败，请重试" }
      }
      return s
    default:
      // done / cancelled / expired 终态
      return s
  }
}
