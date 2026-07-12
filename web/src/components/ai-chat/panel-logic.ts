/**
 * 面板纯逻辑（V2 批D）：斜杠命令目录/过滤 + 晨报「当日关闭」判定。纯函数，node 可测。
 */

/* ============================ 斜杠命令（亮点⑥） ============================ */

export interface SlashCommand {
  /** 命令（含斜杠，如 /待办） */
  cmd: string
  /** 说明 */
  desc: string
  /** 选中后发送的模板文案（action 型无） */
  message?: string
  /** 面板动作（无 message 时）：新会话 */
  action?: "new-session"
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/待办", desc: "查我的待办列表", message: "查我的待办" },
  { cmd: "/急事", desc: "最该先处理的事（急事排序）", message: "我现在最急的事" },
  { cmd: "/请假", desc: "发起请假申请（表单卡）", message: "我要请假" },
  { cmd: "/统计", desc: "本月审批量统计（图表可下钻）", message: "本月审批量统计" },
  { cmd: "/发文", desc: "去发文拟稿（CODE 表单）", message: "我要发文" },
  { cmd: "/计划", desc: "分步执行演示（计划卡）", message: "帮我做个统计计划" },
  { cmd: "/新会话", desc: "开启一个新会话", action: "new-session" },
]

/**
 * 斜杠过滤：输入以 "/" 开头才激活；按命令名/说明包含匹配（去掉斜杠比较）；
 * 只输入 "/" 时返回全量。非斜杠输入返回空（不弹面板）。
 */
export function filterSlashCommands(input: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  if (!input.startsWith("/")) return []
  const q = input.slice(1).trim().toLowerCase()
  if (!q) return commands
  return commands.filter((c) => c.cmd.slice(1).toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
}

/* ============================ 晨报当日关闭（亮点⑤） ============================ */

/** 本地日期 YYYY-MM-DD（晨报按自然日） */
export function todayStr(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 是否展示晨报：当日已关闭（dismissedDate === today）→ 不展示；
 * 未关过 / 关的是往日 → 展示（次日自动恢复）。
 */
export function shouldShowBriefing(dismissedDate: string | null | undefined, today: string): boolean {
  return dismissedDate !== today
}

/** localStorage 键：晨报「今日不再显示」记录的自然日 */
export const BRIEFING_DISMISS_KEY = "ai-briefing-dismissed"

/**
 * 打开面板时恢复哪个会话（纯，可测）：
 *  - 空列表 → null（新用户/无历史 → 空新会话·欢迎态）
 *  - lastId 仍在列表 → 它（精确恢复"上次的会话"）
 *  - 否则 → 最近一个 list[0]
 */
export function pickRestoreTarget(sessions: { id: string }[] | null | undefined, lastId: string | null): string | null {
  const list = Array.isArray(sessions) ? sessions : []
  if (list.length === 0) return null
  if (lastId && list.some((s) => s.id === lastId)) return lastId
  return list[0].id
}

/** 晨报计数汇总行文案（只列非零项）：如「今日 3 件急事 · 2 个会议 · 5 条待阅」；全 0 → 空串 */
export function briefingSummary(counts: { urgentCount?: number; meetingCount?: number; unreadCount?: number }): string {
  const parts: string[] = []
  if (counts.urgentCount) parts.push(`${counts.urgentCount} 件急事`)
  if (counts.meetingCount) parts.push(`${counts.meetingCount} 个会议`)
  if (counts.unreadCount) parts.push(`${counts.unreadCount} 条待阅`)
  return parts.length ? `今日 ${parts.join(" · ")}` : ""
}
