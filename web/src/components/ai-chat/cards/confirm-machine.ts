/**
 * confirm 卡片状态机（V2 §7.2 适配）：
 * idle → submitting（确认请求中）→ executing（服务端 EXECUTING 过渡态）→ done | 失败分支；
 * 失败分支：expired（410/AI_ACTION_EXPIRED）/ stale（AI_ACTION_STALE，状态已变化需重新查询，终态）
 * / 回 idle（可重试，带 error 文案）。cancelled 为用户取消终态。
 * 纯函数 reducer（node 可测）；卡片组件用 useReducer 驱动。
 */

export type ConfirmState = "idle" | "submitting" | "executing" | "done" | "cancelled" | "expired" | "stale"

export type ConfirmEvent =
  | { type: "CONFIRM" }
  | { type: "EXECUTING" }
  | { type: "SUCCESS"; message?: string; resultLink?: string }
  | { type: "FAILURE"; expired?: boolean; stale?: boolean; error?: string }
  | { type: "CANCEL" }

export interface ConfirmCardState {
  state: ConfirmState
  /** done 态的结果文案 / 链接 */
  resultMessage?: string
  resultLink?: string
  /** idle 态的上次失败提示（可重试）；stale 态的说明文案 */
  error?: string
}

export const CONFIRM_INITIAL: ConfirmCardState = { state: "idle" }

/**
 * 状态转移：
 *  - idle --CONFIRM--> submitting；idle --CANCEL--> cancelled
 *  - submitting --EXECUTING--> executing（服务端已受理，执行中）
 *  - submitting/executing --SUCCESS--> done
 *  - submitting/executing --FAILURE--> expired（过期）| stale（状态已变化，终态）| idle（可重试）
 *  - done/cancelled/expired/stale 为终态（任何事件不再迁移）
 */
export function confirmReducer(s: ConfirmCardState, e: ConfirmEvent): ConfirmCardState {
  switch (s.state) {
    case "idle":
      if (e.type === "CONFIRM") return { state: "submitting" }
      if (e.type === "CANCEL") return { state: "cancelled" }
      return s
    case "submitting":
    case "executing":
      if (e.type === "EXECUTING") return s.state === "submitting" ? { state: "executing" } : s
      if (e.type === "SUCCESS") return { state: "done", resultMessage: e.message, resultLink: e.resultLink }
      if (e.type === "FAILURE") {
        if (e.expired) return { state: "expired" }
        if (e.stale) return { state: "stale", error: e.error ?? "该对象状态已经变化，请重新查询后再操作。" }
        return { state: "idle", error: e.error ?? "执行失败，请重试" }
      }
      return s
    default:
      // done / cancelled / expired / stale 终态
      return s
  }
}
