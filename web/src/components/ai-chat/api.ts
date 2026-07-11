/**
 * AI 助手 · API 层 + mock 先行（契约 §3：POST /api/ai/chat、POST /api/ai/confirm、会话 CRUD）。
 *
 * 降级口径：后端 /api/ai/* 未就绪（NetworkError 或 404）→ 内存 mock 顶住（demo=true）；
 * auth offline 模式由面板层按丹青 §1.4 呈现"离线不可用"提示（不落到本层）。
 * mock 演示覆盖：功能介绍 / navigate 卡 / 待办 list 卡 / 图表卡（bar/pie/line）/ 请假 form 卡 /
 * 发文 CODE form 卡 / confirm 全状态（普通/危险/过期）/ 多轮上下文（「再按部门」）。
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import type { AiCard, AiChatResponse, AiConfirmResponse, AiMessage, AiSession } from "./types"

export interface AiResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T | Promise<T>): Promise<AiResult<T>> {
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    // 后端整体未起（NetworkError）或 /api/ai 未实现（404）→ mock；真实 403/400 照抛
    if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) {
      return { data: await mock(), demo: true }
    }
    throw err
  }
}

/* ============================ mock 会话存储 ============================ */

let sessionSeq = 0
const now = () => new Date().toISOString().slice(0, 19)

interface MockSession extends AiSession {
  messages: AiMessage[]
  /** 多轮上下文：记录上一次统计话题（「再按部门分一下」演示） */
  lastTopic?: "stats" | null
}

const MOCK_SESSIONS: MockSession[] = []

function mockSession(id: string | undefined): MockSession {
  let s = MOCK_SESSIONS.find((x) => x.id === id)
  if (!s) {
    s = { id: `mock-${++sessionSeq}`, title: "新会话", updatedAt: now(), messages: [] }
    MOCK_SESSIONS.unshift(s)
  }
  return s
}

/* ============================ mock 应答脑（关键词驱动演示） ============================ */

const LEAVE_SCHEMA = [
  { id: "w1", type: "select", label: "请假类型", key: "leaveType", required: true, options: ["年假", "事假", "病假", "调休"], width: "full" as const },
  { id: "w2", type: "date", label: "开始日期", key: "startDate", required: true, width: "half" as const },
  { id: "w3", type: "date", label: "结束日期", key: "endDate", required: true, width: "half" as const },
  { id: "w4", type: "number", label: "请假天数", key: "days", required: true, width: "half" as const },
  { id: "w5", type: "textarea", label: "请假事由", key: "reason", required: true, width: "full" as const },
]

function mockReply(text: string, session: MockSession): AiMessage {
  const t = text.toLowerCase()
  const has = (...kws: string[]) => kws.some((k) => text.includes(k) || t.includes(k))
  const cards: AiCard[] = []
  let content: string

  if (has("待办", "todo", "要处理", "急")) {
    content = has("急")
      ? "按 **超时 48 小时未办、加急标记、催办** 打分排序，你现在最该处理这几件："
      : "这是你的待办列表（按到达时间倒序），点击行可直达办理页："
    cards.push({
      type: "list",
      title: has("急") ? "急事优先" : "我的待办",
      columns: [
        { key: "title", label: "标题" },
        { key: "node", label: "节点" },
        { key: "arrivedAt", label: "到达" },
      ],
      rows: [
        { title: "〔特急〕关于开展信息安全专项检查的通知 · 签发", node: "签发", arrivedAt: "2 天前", link: "/workflow/tasks" },
        { title: "张三的请假申请（3 天）", node: "部门主管审批", arrivedAt: "5 小时前", link: "/workflow/tasks" },
        { title: "采购申请 · 金额 ¥42,000", node: "总经理审批", arrivedAt: "昨天", link: "/workflow/tasks" },
      ],
      moreLink: "/workflow/tasks",
    })
    session.lastTopic = null
  } else if (has("统计", "报表", "图表", "审批量")) {
    content = "这是**本月审批量按流程**的统计（数据权限范围内）："
    cards.push({
      type: "chart",
      chartType: "bar",
      title: "本月审批量 · 按流程",
      categories: ["请假", "报销", "采购", "用章", "出差"],
      series: [
        { name: "已通过", data: [42, 31, 12, 20, 9] },
        { name: "进行中", data: [8, 12, 6, 3, 4] },
      ],
    })
    session.lastTopic = "stats"
  } else if (session.lastTopic === "stats" && has("部门", "再按", "换个维度")) {
    content = "好的，换成**按部门**的占比视角："
    cards.push({
      type: "chart",
      chartType: "pie",
      title: "本月审批量 · 按部门",
      series: [
        { name: "研发中心", data: [58], percent: 39.2 },
        { name: "市场部", data: [34], percent: 23.0 },
        { name: "人力资源部", data: [26], percent: 17.6 },
        { name: "财务部", data: [18], percent: 12.2 },
        { name: "综合办公室", data: [12], percent: 8.1 },
      ],
    })
  } else if (has("趋势", "走势", "折线")) {
    content = "近六个月的审批量趋势如下："
    cards.push({
      type: "chart",
      chartType: "line",
      title: "审批量趋势（近 6 月）",
      categories: ["2月", "3月", "4月", "5月", "6月", "7月"],
      series: [{ name: "审批量", data: [96, 120, 88, 132, 150, 141] }],
    })
    session.lastTopic = "stats"
  } else if (has("请假")) {
    content = "好的，帮你调出**请假申请**表单，填写后我直接为你发起流程："
    cards.push({
      type: "form",
      defCode: "leave_flow",
      defName: "请假申请",
      formType: "ONLINE",
      schema: LEAVE_SCHEMA,
    })
    session.lastTopic = null
  } else if (has("发文", "公文")) {
    content = "发文办理单是代码表单，需要在拟稿页填写（含红头版式预览）。点下面直接过去："
    cards.push({
      type: "form",
      defCode: "gw_send",
      defName: "发文办理单",
      formType: "CODE",
      submitPath: "/document/send?new=1",
    })
    session.lastTopic = null
  } else if (has("同意", "通过", "批准")) {
    content = "确认要**同意**这条审批吗？我不会直接操作，请你确认后才会执行："
    cards.push({
      type: "confirm",
      actionId: `act-${Date.now()}`,
      title: "同意审批任务",
      summary: "执行后该任务办结并流转到下一节点",
      params: [
        { label: "任务", value: "张三的请假申请（3 天）" },
        { label: "节点", value: "部门主管审批" },
        { label: "意见", value: "同意" },
      ],
    })
  } else if (has("驳回", "拒绝", "删除")) {
    content = "这是一个**不可逆的危险操作**，请再次确认："
    cards.push({
      type: "confirm",
      actionId: `act-danger-${Date.now()}`,
      title: has("删除") ? "删除日程「周会」" : "驳回审批任务",
      summary: "执行后不可恢复，请谨慎确认",
      params: [
        { label: "对象", value: has("删除") ? "周会（每周一 10:00）" : "采购申请 · ¥42,000" },
        { label: "操作", value: has("删除") ? "删除" : "驳回至发起人" },
      ],
      danger: true,
    })
  } else if (has("过期", "expired")) {
    content = "演示一个**已过期**的确认卡（待确认动作 10 分钟过期）："
    cards.push({
      type: "confirm",
      actionId: "act-expired-demo",
      title: "同意审批任务（演示过期）",
      params: [{ label: "任务", value: "旧的待确认动作" }],
    })
  } else if (has("导航", "打开", "去", "带我")) {
    content = "为你找到了对应功能："
    cards.push(
      { type: "navigate", path: "/workflow/tasks", title: "我的审批", desc: "待办 / 待阅 / 已办 / 我发起" },
      { type: "link", items: [
        { title: "发起申请", path: "/workflow/start" },
        { title: "流程监控", path: "/workflow/monitor" },
      ] },
    )
  } else if (has("功能", "能做什么", "会什么", "帮助", "你好", "hi", "hello")) {
    content =
      "你好！我是**星辰助手**，可以帮你：\n\n" +
      "- **查数据**：待办、公文、会议、考勤、假期余额（严格按你的数据权限）\n" +
      "- **办事情**：发起审批、同意/驳回任务（都会先出确认卡，你点确认才执行）\n" +
      "- **看报表**：审批量、公文、考勤出勤率等统计图表\n" +
      "- **找功能**：说出想做的事，我带你去对应页面\n\n试试下面的快捷入口："
    cards.push({
      type: "link",
      items: [
        { title: "查我的待办", path: "/workflow/tasks" },
        { title: "发起申请", path: "/workflow/start" },
        { title: "公文管理", path: "/document/send" },
        { title: "自动化编排", path: "/automation" },
      ],
    })
  } else {
    content =
      `收到：「${text}」。\n\n当前为**演示模式**（后端 /api/ai 未接入），我预置了这些演示：\n\n` +
      "1. 「你能做什么」— 功能介绍\n" +
      "2. 「查我的待办」/「我现在最急的事」— 列表卡\n" +
      "3. 「本月审批量统计」→ 再问「再按部门分一下」— 图表卡 + 多轮上下文\n" +
      "4. 「我要请假」— 表单卡；「我要发文」— CODE 表单跳转\n" +
      "5. 「同意这条审批」/「驳回它」/「演示过期」— 确认卡全状态\n" +
      "6. 「带我去审批中心」— 导航卡"
  }

  return { role: "ASSISTANT", content, cards: cards.length ? cards : undefined, createdAt: now() }
}

/* ============================ API ============================ */

/** 发消息（sessionId 空=新会话）。mock：0.6s 假延迟出打字态 */
export function sendChat(sessionId: string | undefined, message: string): Promise<AiResult<AiChatResponse>> {
  return withMock(
    () => api<AiChatResponse>("/api/ai/chat", { method: "POST", body: JSON.stringify({ sessionId, message }) }),
    async () => {
      await new Promise((r) => setTimeout(r, 600))
      const session = mockSession(sessionId)
      if (session.messages.length === 0) session.title = message.slice(0, 20)
      const userMsg: AiMessage = { role: "USER", content: message, createdAt: now() }
      const reply = mockReply(message, session)
      session.messages.push(userMsg, reply)
      session.updatedAt = now()
      return { sessionId: session.id, messages: [reply] }
    },
  )
}

/** 确认执行暂存动作（10min 过期）。mock：过期演示 actionId 返回 expired */
export function confirmAction(actionId: string): Promise<AiResult<AiConfirmResponse>> {
  return withMock(
    () => api<AiConfirmResponse>("/api/ai/confirm", { method: "POST", body: JSON.stringify({ actionId }) }),
    async () => {
      await new Promise((r) => setTimeout(r, 500))
      if (actionId.startsWith("act-expired")) {
        return { ok: false, expired: true }
      }
      return { ok: true, message: "已执行", resultLink: "/workflow/tasks?tab=done" }
    },
  )
}

export function fetchSessions(): Promise<AiResult<AiSession[]>> {
  return withMock(
    () => api<AiSession[]>("/api/ai/sessions"),
    () => MOCK_SESSIONS.map(({ messages: _m, lastTopic: _t, ...rest }) => rest),
  )
}

export function fetchSessionMessages(id: string): Promise<AiResult<AiMessage[]>> {
  return withMock(
    () => api<AiMessage[]>(`/api/ai/sessions/${encodeURIComponent(id)}/messages`),
    () => MOCK_SESSIONS.find((s) => s.id === id)?.messages ?? [],
  )
}

export function deleteSession(id: string): Promise<AiResult<void>> {
  return withMock(
    () => api<void>(`/api/ai/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    () => {
      const i = MOCK_SESSIONS.findIndex((s) => s.id === id)
      if (i >= 0) MOCK_SESSIONS.splice(i, 1)
    },
  )
}
