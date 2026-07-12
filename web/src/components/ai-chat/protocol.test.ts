/**
 * V2 协议层用例（批A）：SSE 增量解析器 / Part 白名单与降级 / 新旧适配 / 受控导航 / 错误码文案 / ULID。
 */
import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api"
import { FEATURE_REGISTRY, featureCodeFromPath, featureCodeOf, resolveFeature } from "./route-registry"
import {
  AI_ERROR_TEXT,
  cardsToParts,
  cardToPart,
  createSseParser,
  friendlyAiError,
  legacyModelsToChoices,
  mergePart,
  normalizeRisks,
  parseAiEvent,
  parseAiSummary,
  parsePredictChain,
  partToCard,
  reportResultToListPart,
  resolveFeaturePath,
  resolvePart,
  riskTone,
  ulid,
  type AiMessagePart,
  type SseFrame,
} from "./protocol"
import { CONFIRM_INITIAL, confirmReducer, type ConfirmCardState } from "./cards/confirm-machine"

/* ============================ SSE 解析器 ============================ */

function collect(chunks: string[]): SseFrame[] {
  const frames: SseFrame[] = []
  const parser = createSseParser((f) => frames.push(f))
  for (const c of chunks) parser.feed(c)
  parser.end()
  return frames
}

describe("SSE 增量解析器（fetch ReadableStream 消费）", () => {
  it("单 chunk 多事件：按空行分帧", () => {
    const frames = collect(['data: {"type":"message.started"}\n\ndata: {"type":"message.completed"}\n\n'])
    expect(frames.map((f) => f.data)).toEqual(['{"type":"message.started"}', '{"type":"message.completed"}'])
  })

  it("事件跨 chunk 任意断开（行中间/帧中间）都能拼回", () => {
    const frames = collect(["data: {\"ty", 'pe":"tool.started"', "}\n", "\nda", 'ta: {"type":"x"}\n\n'])
    expect(frames.length).toBe(2)
    expect(frames[0].data).toBe('{"type":"tool.started"}')
  })

  it("多条 data: 行拼接为多行 payload；event:/id: 字段解析；CRLF 兼容", () => {
    const frames = collect(['event: message.part.created\r\nid: 7\r\ndata: {"a":1,\r\ndata: "b":2}\r\n\r\n'])
    expect(frames[0].event).toBe("message.part.created")
    expect(frames[0].id).toBe("7")
    expect(frames[0].data).toBe('{"a":1,\n"b":2}')
  })

  it("注释行（keepalive）忽略；流结束残帧照常吐出", () => {
    const frames = collect([": keepalive\n", 'data: {"type":"message.completed"}'])
    expect(frames.length).toBe(1)
    expect(frames[0].data).toBe('{"type":"message.completed"}')
  })

  it("parseAiEvent：type 取 data JSON，缺省回退 event 名；坏 JSON 回 null", () => {
    expect(parseAiEvent({ data: '{"type":"tool.completed","sequence":8,"payload":{"toolCallId":"tc1"}}' })?.type).toBe("tool.completed")
    expect(parseAiEvent({ event: "message.started", data: '{"sessionId":"ses_1"}' })?.type).toBe("message.started")
    expect(parseAiEvent({ event: "message.started", data: '{"sessionId":"ses_1"}' })?.sessionId).toBe("ses_1")
    expect(parseAiEvent({ data: "{bad json" })).toBeNull()
    expect(parseAiEvent({ data: "  " })).toBeNull()
  })
})

/* ============================ Part 白名单与降级（§16.3） ============================ */

const part = (over: Partial<AiMessagePart>): AiMessagePart => ({
  partId: "pt_1",
  partType: "list",
  schemaVersion: 1,
  payload: {},
  sequenceNo: 1,
  ...over,
})

describe("Part 协议：白名单 + schemaVersion 降级", () => {
  it("白名单 partType v1 → ok（批B 增 plan）", () => {
    for (const t of ["text", "navigate", "form", "confirm", "list", "chart", "approval", "status", "error", "plan"]) {
      expect(resolvePart(part({ partType: t }))).toEqual({ status: "ok", type: t })
    }
  })

  it("未知 partType / 超版本 / 形状非法 → 降级（不空白不报错）", () => {
    expect(resolvePart(part({ partType: "iframe" }))).toEqual({ status: "degraded", reason: "unknown-type" })
    expect(resolvePart(part({ schemaVersion: 2 }))).toEqual({ status: "degraded", reason: "unsupported-version" })
    expect(resolvePart(null)).toEqual({ status: "degraded", reason: "malformed" })
    expect(resolvePart({ partType: "list" } as Partial<AiMessagePart>)).toEqual({ status: "degraded", reason: "malformed" })
  })

  it("批E 草稿卡 partType v1 → ok（flowDraft/templateDraft/formDraft）", () => {
    for (const t of ["flowDraft", "templateDraft", "formDraft"]) {
      expect(resolvePart(part({ partType: t, payload: { draftId: "d1", name: "x" } }))).toEqual({ status: "ok", type: t })
    }
    // 未知草稿仍降级
    expect(resolvePart(part({ partType: "bpmnDraft" }))).toEqual({ status: "degraded", reason: "unknown-type" })
  })
})

/* ============================ 批E：审批摘要 / 流程预测链归一 ============================ */

describe("riskTone / normalizeRisks / parseAiSummary（防白屏归一）", () => {
  it("riskTone 容忍英文枚举与中文", () => {
    expect(riskTone("HIGH")).toBe("high")
    expect(riskTone("偏高")).toBe("high") // 含"高"子串 → high
    expect(riskTone("高")).toBe("high")
    expect(riskTone("MEDIUM")).toBe("medium")
    expect(riskTone("中")).toBe("medium")
    expect(riskTone("普通")).toBe("low") // 无高/中关键字 → low
    expect(riskTone(undefined)).toBe("low")
  })

  it("normalizeRisks：string[] / 对象[] / 垃圾 → {level?,text}[]（空文案剔除）", () => {
    expect(normalizeRisks(["超期", { level: "HIGH", text: "金额高" }, { text: "" }, 42, null])).toEqual([
      { text: "超期" },
      { level: "HIGH", text: "金额高" },
    ])
    expect(normalizeRisks("boom")).toEqual([])
  })

  it("parseAiSummary：需有 summary 或 risks，否则 undefined", () => {
    expect(parseAiSummary({ summary: "三行摘要", risks: ["超期"] })).toEqual({ summary: "三行摘要", risks: [{ text: "超期" }] })
    expect(parseAiSummary({ summary: "", risks: [] })).toBeUndefined()
    expect(parseAiSummary(null)).toBeUndefined()
    expect(parseAiSummary("boom")).toBeUndefined()
  })
})

describe("parsePredictChain（流程预测链归一）", () => {
  it("对象[] / string[] → {stepName,assigneeName?}[]；空 → undefined", () => {
    expect(parsePredictChain([{ stepName: "签发", assigneeName: "王经理" }, { stepName: "归档" }])).toEqual([
      { stepName: "签发", assigneeName: "王经理" },
      { stepName: "归档" },
    ])
    expect(parsePredictChain(["用印", "归档"])).toEqual([{ stepName: "用印" }, { stepName: "归档" }])
    expect(parsePredictChain([])).toBeUndefined()
    expect(parsePredictChain("boom")).toBeUndefined()
  })
})

/* ============================ 新旧协议适配 ============================ */

describe("cards ↔ parts 适配（兼容读旧消息 / mock 升级）", () => {
  it("confirm 卡 → part（displayParams）→ 回卡片渲染形状", () => {
    const p = cardToPart(
      { type: "confirm", actionId: "act_1", title: "同意审批", summary: "s", params: [{ label: "任务", value: "T" }], danger: true },
      3,
    )
    expect(p.partType).toBe("confirm")
    expect(p.sequenceNo).toBe(3)
    expect((p.payload.displayParams as unknown[]).length).toBe(1)
    const back = partToCard(p)
    expect(back).toMatchObject({ type: "confirm", actionId: "act_1", title: "同意审批", danger: true })
    expect((back as { params?: unknown[] }).params?.length).toBe(1)
  })

  it("批E⑨⑩ confirm 卡 aiSummary/predictChain 往返（part 透传 → 卡归一）", () => {
    const p = cardToPart(
      {
        type: "confirm",
        actionId: "act_2",
        title: "同意审批",
        aiSummary: { summary: "请假 3 天，余额充足", risks: [{ level: "MEDIUM", text: "里程碑周重叠" }] },
        predictChain: [{ stepName: "HR 复核", assigneeName: "李经理" }, { stepName: "归档" }],
      },
      1,
    )
    expect((p.payload.predictChain as unknown[]).length).toBe(2)
    const back = partToCard(p) as { aiSummary?: { summary: string }; predictChain?: unknown[] }
    expect(back.aiSummary?.summary).toBe("请假 3 天，余额充足")
    expect(back.predictChain?.length).toBe(2)
  })

  it("flowDraft/templateDraft/formDraft 卡 → part 通用透传（partType=type，payload 保 draftId）", () => {
    const parts = cardsToParts([
      { type: "flowDraft", draftId: "fd1", name: "每周统计", triggerDesc: "CRON", nodes: [{ type: "notify", label: "通知" }] },
      { type: "templateDraft", draftId: "td1", name: "采购单模板", blocks: [{ type: "table", label: "明细" }] },
      { type: "formDraft", draftId: "frm1", name: "报修表", fields: [{ label: "设备", type: "text" }] },
    ])
    expect(parts.map((x) => x.partType)).toEqual(["flowDraft", "templateDraft", "formDraft"])
    expect(parts[0].payload.draftId).toBe("fd1")
    expect(resolvePart(parts[0])).toEqual({ status: "ok", type: "flowDraft" })
  })

  it("navigate part：v2 featureCode 经受控映射；path 过渡期直通；未知 featureCode → null（降级）", () => {
    expect(partToCard(part({ partType: "navigate", payload: { featureCode: "WF_MY_TODO", title: "待办" } }))).toMatchObject({
      type: "navigate",
      path: "/workflow/tasks",
    })
    expect(partToCard(part({ partType: "navigate", payload: { path: "/workflow/start", title: "发起" } }))).toMatchObject({
      path: "/workflow/start",
    })
    expect(partToCard(part({ partType: "navigate", payload: { featureCode: "HACKED_CODE", title: "x" } }))).toBeNull()
  })

  it("form 卡 prefill 往返透传（预填 initialValues；修表单卡字段全空缺陷）", () => {
    const p = cardToPart(
      { type: "form", defCode: "leave_flow", defName: "请假申请", formType: "ONLINE", schema: [], prefill: { leaveType: "年假", days: 10 } },
      2,
    )
    expect(p.partType).toBe("form")
    expect(p.payload.prefill).toEqual({ leaveType: "年假", days: 10 })
    const back = partToCard(p) as { type: string; prefill?: Record<string, unknown> }
    expect(back.type).toBe("form")
    expect(back.prefill).toEqual({ leaveType: "年假", days: 10 })
  })

  it("cardsToParts：link 卡拆成多个 navigate part；sequenceNo 递增", () => {
    const parts = cardsToParts([
      { type: "link", items: [{ title: "A", path: "/a" }, { title: "B", path: "/b" }] },
      { type: "navigate", path: "/c", title: "C" },
    ])
    expect(parts.map((x) => x.partType)).toEqual(["navigate", "navigate", "navigate"])
    expect(parts.map((x) => x.sequenceNo)).toEqual([1, 2, 3])
  })
})

/* ============================ 批B：Part 覆盖合并 / 档案回退映射 ============================ */

describe("mergePart（计划卡逐步打勾：同 partId 覆盖）", () => {
  const plan = (status: string) =>
    part({ partId: "pt_plan", partType: "plan", payload: { steps: [{ title: "步骤一", status }] }, sequenceNo: 1 })

  it("同 partId 覆盖（位置不变），不同 partId 追加", () => {
    const a = plan("pending")
    const b = part({ partId: "pt_other", partType: "text", payload: { text: "x" }, sequenceNo: 2 })
    let parts = mergePart([], a)
    parts = mergePart(parts, b)
    expect(parts.map((p) => p.partId)).toEqual(["pt_plan", "pt_other"])
    const updated = mergePart(parts, plan("done"))
    expect(updated.map((p) => p.partId)).toEqual(["pt_plan", "pt_other"])
    expect((updated[0].payload.steps as { status: string }[])[0].status).toBe("done")
  })
})

describe("legacyModelsToChoices（model-profiles 404 回退映射）", () => {
  it("凭据 → 统一条目：id 带 cred: 前缀、保留 legacyCredentialId/legacyModel/supportsVision", () => {
    const out = legacyModelsToChoices([{ credentialId: 2, name: "GPT-4o", model: "gpt-4o", supportsVision: true }])
    expect(out).toEqual([
      { id: "cred:2", name: "GPT-4o", description: "gpt-4o", supportsVision: true, legacyCredentialId: 2, legacyModel: "gpt-4o" },
    ])
  })
})

/* ============================ 受控导航（§10.2） ============================ */

describe("resolveFeaturePath", () => {
  it("已知 featureCode → 站内路径；参数占位替换并编码", () => {
    expect(resolveFeaturePath("WF_MY_TODO")).toBe("/workflow/tasks")
    expect(resolveFeaturePath("WF_INSTANCE_DETAIL", { instanceId: "pi 9/1" })).toBe("/workflow/instances/pi%209%2F1")
  })

  it("未知 code / 缺参 → null（渲染禁用态，不执行任意 URL）", () => {
    expect(resolveFeaturePath("EVIL")).toBeNull()
    expect(resolveFeaturePath("WF_INSTANCE_DETAIL", {})).toBeNull()
    expect(resolveFeaturePath(undefined)).toBeNull()
  })
})

/* ============================ 批C：FeatureRouteRegistry / 下钻转换 ============================ */

describe("FeatureRouteRegistry（menu.ts 生成全量 + 详情页 + 别名）", () => {
  it("featureCodeOf：path → 段大写下划线（与后端种子同约定）", () => {
    expect(featureCodeOf("/workflow/tasks")).toBe("WORKFLOW_TASKS")
    expect(featureCodeOf("/workflow/form-defs")).toBe("WORKFLOW_FORM_DEFS")
  })

  it("菜单叶子全量入表（外链/分组不入）；resolveFeature 规范码与别名都通", () => {
    expect(FEATURE_REGISTRY.WORKFLOW_TASKS?.path).toBe("/workflow/tasks")
    expect(FEATURE_REGISTRY.BIZDOC_TPLS?.path).toBe("/bizdoc/tpls")
    expect(FEATURE_REGISTRY.SYSTEM_ORG_DEPT?.path).toBe("/system/org/dept")
    // 外链（xxl-job）不注册
    expect(Object.values(FEATURE_REGISTRY).every((r) => r.path.startsWith("/"))).toBe(true)
    expect(resolveFeature("WORKFLOW_TASKS")).toBe("/workflow/tasks")
    expect(resolveFeature("WF_MY_TODO")).toBe("/workflow/tasks") // 批A 别名兼容
    expect(resolveFeature("WORKFLOW_INSTANCE_DETAIL", { instanceId: 9 })).toBe("/workflow/instances/9")
    expect(resolveFeature("WORKFLOW_INSTANCE_DETAIL", {})).toBeNull()
    expect(resolveFeature("EVIL_CODE")).toBeNull()
    // 批E 平台联动草稿卡去处（编排/模板设计器）
    expect(resolveFeature("AUTOMATION_DESIGNER", { code: "ai_x" })).toBe("/automation/ai_x/design")
    expect(resolveFeature("BIZDOC_TPL_DESIGNER", { tplId: "t9" })).toBe("/bizdoc/tpl/t/t9")
    expect(resolveFeature("AUTOMATION_DESIGNER", {})).toBeNull()
  })

  it("featureCodeFromPath 反查（pageContext）：精确 / 参数模板 / 最长前缀 / 未知 null", () => {
    expect(featureCodeFromPath("/workflow/tasks")).toBe("WORKFLOW_TASKS")
    expect(featureCodeFromPath("/workflow/instances/pi-9001")).toBe("WORKFLOW_INSTANCE_DETAIL")
    expect(featureCodeFromPath("/document/send/12")).toBe("DOCUMENT_SEND_DETAIL")
    expect(featureCodeFromPath("/bizdoc/run/expense")).toBe("BIZDOC_RUN")
    // 最长前缀回退：设计器子路由归属其列表页
    expect(featureCodeFromPath("/workflow/defs/leave/design")).toBe("WORKFLOW_DEFS")
    expect(featureCodeFromPath("/nowhere/at/all")).toBeNull()
  })
})

describe("reportResultToListPart（下钻结果 → 新 list 卡）", () => {
  it("字段透传（title/columns/rows/datasetId/page/moreFeatureCode），partType=list v1", () => {
    const partOut = reportResultToListPart(
      {
        title: "「请假」审批明细",
        columns: [{ key: "title", label: "标题" }],
        rows: [{ title: "张三的申请" }],
        datasetId: "ds_x",
        page: { current: 1, size: 20, total: 42 },
        moreFeatureCode: "WORKFLOW_MONITOR",
      },
      7,
    )
    expect(partOut.partType).toBe("list")
    expect(partOut.schemaVersion).toBe(1)
    expect(partOut.sequenceNo).toBe(7)
    expect(partOut.payload.title).toBe("「请假」审批明细")
    expect(partOut.payload.datasetId).toBe("ds_x")
    expect((partOut.payload.page as { total: number }).total).toBe(42)
    expect(resolvePart(partOut)).toEqual({ status: "ok", type: "list" })
  })
})

/* ============================ 错误码文案（§22） ============================ */

describe("friendlyAiError", () => {
  it("识别 §22 错误码（message 内嵌码）→ 文案", () => {
    expect(friendlyAiError(new ApiError(400, "AI_ACTION_STALE"))).toBe(AI_ERROR_TEXT.AI_ACTION_STALE)
    expect(friendlyAiError(new Error("AI_SESSION_BUSY: session locked"))).toBe(AI_ERROR_TEXT.AI_SESSION_BUSY)
  })

  it("HTTP 语义兜底：409 → 忙；410 → 过期；普通 message 原样", () => {
    expect(friendlyAiError(new ApiError(409, "Conflict"))).toBe(AI_ERROR_TEXT.AI_SESSION_BUSY)
    expect(friendlyAiError(new ApiError(410, "Gone"))).toBe(AI_ERROR_TEXT.AI_ACTION_EXPIRED)
    expect(friendlyAiError(new Error("自定义文案"))).toBe("自定义文案")
    expect(friendlyAiError(undefined, "兜底")).toBe("兜底")
  })
})

/* ============================ ULID ============================ */

describe("ulid", () => {
  it("26 位 Crockford Base32；同毫秒不同随机；时间前缀可排序", () => {
    const a = ulid(1700000000000)
    const b = ulid(1700000000000)
    const c = ulid(1800000000000)
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a.slice(0, 10)).toBe(b.slice(0, 10))
    expect(a).not.toBe(b)
    expect(c.slice(0, 10) > a.slice(0, 10)).toBe(true)
  })
})

/* ============================ 确认状态机（V2 §7.2：EXECUTING/STALE） ============================ */

describe("confirm 状态机 V2 增量", () => {
  const step = (s: ConfirmCardState, ...events: Parameters<typeof confirmReducer>[1][]) => events.reduce(confirmReducer, s)

  it("submitting → EXECUTING → SUCCESS：执行中过渡态", () => {
    const executing = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "EXECUTING" })
    expect(executing.state).toBe("executing")
    expect(step(executing, { type: "SUCCESS", message: "已通过" }).state).toBe("done")
  })

  it("AI_ACTION_STALE → stale 终态（状态已变化请重新查询，不可重试）", () => {
    const stale = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "FAILURE", stale: true, error: "该对象状态已经变化" })
    expect(stale.state).toBe("stale")
    expect(confirmReducer(stale, { type: "CONFIRM" }).state).toBe("stale")
  })

  it("executing 中 FAILURE(expired) → expired；CANCEL 无效", () => {
    const executing = step(CONFIRM_INITIAL, { type: "CONFIRM" }, { type: "EXECUTING" })
    expect(confirmReducer(executing, { type: "CANCEL" }).state).toBe("executing")
    expect(confirmReducer(executing, { type: "FAILURE", expired: true }).state).toBe("expired")
  })
})
