/**
 * 单据模板独立化（bizdoc-design.md §11）：模板绑定到流程/表单，把一条数据渲染成可打印文档；
 * 不管台账/状态机。与业务单据（BIZDOC 绑定，§1-§10）两套并存。
 *
 * API `/api/bizdoc/tpls*`（磐石在做），mock 先行；纯函数 filterTpls / matchTplsForInstance 可单测。
 */
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import {
  buildSampleData,
  evalCalcDemo,
  isV2,
  type AnyBdTemplate,
  type BdPageSize,
  type BdTemplateV2,
} from "@/components/bizdoc/model-v2"
import type { DefField } from "./fields"

/* ============================ 类型（§11.1） ============================ */

export type TplBindType = "BIZDOC" | "FLOW" | "FORM"
export type TplStatus = "DRAFT" | "PUBLISHED"

export interface BizDocTpl {
  id: number
  /** 模板编码（唯一） */
  code: string
  name: string
  category?: string
  description?: string
  bindType: TplBindType
  /** FLOW→wf defCode；FORM→formCode；BIZDOC 时空（用 defId） */
  bindCode?: string | null
  defId?: number | null
  status: TplStatus
  /** 发布自增 */
  version: number
  paper: BdPageSize
  landscape: boolean
  content: AnyBdTemplate
  updatedAt?: string
}

export interface TplRenderData {
  tpl: BizDocTpl
  data: Record<string, unknown>
  fields: Record<string, string>
}

export interface TplResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<TplResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) {
      return { data: mock(), demo: true }
    }
    throw err
  }
}

/* ============================ 纯函数（列表筛选 / 实例匹配） ============================ */

export interface TplFilter {
  keyword?: string
  category?: string
  bindType?: TplBindType | ""
}

/** 卡片列表筛选：关键词命中 名称/编码；分类精确；绑定类型精确 */
export function filterTpls(list: BizDocTpl[], f: TplFilter): BizDocTpl[] {
  const kw = f.keyword?.trim().toLowerCase()
  return list.filter((t) => {
    if (kw && !t.name.toLowerCase().includes(kw) && !t.code.toLowerCase().includes(kw)) return false
    if (f.category && (t.category ?? "") !== f.category) return false
    if (f.bindType && t.bindType !== f.bindType) return false
    return true
  })
}

/** 实例可打印模板（§11.2 for-instance 口径）：已发布 + FLOW 绑定 defCode / FORM 绑定 formCode 匹配 */
export function matchTplsForInstance(list: BizDocTpl[], hint: { defCode?: string; formCode?: string }): BizDocTpl[] {
  return list.filter((t) => {
    if (t.status !== "PUBLISHED") return false
    if (t.bindType === "FLOW") return !!hint.defCode && t.bindCode === hint.defCode
    if (t.bindType === "FORM") return !!hint.formCode && t.bindCode === hint.formCode
    return false
  })
}

/* ============================ mock 数据 ============================ */

function demoTpl(over: {
  title: string
  cells: { label: string; value: string }[]
  reasonField?: { label: string; value: string }
}): BdTemplateV2 {
  return {
    schemaVersion: 2,
    page: {
      size: "A4",
      landscape: false,
      margin: [20, 20, 20, 20],
      fontFamily: "宋体",
      pageNumber: { show: true, position: "footer", align: "center", format: "第 {page} 页 / 共 {total} 页", fontSize: 9 },
    },
    blocks: [
      { id: "t1", type: "title", text: over.title, style: { fontSize: 18, bold: true, align: "center" } },
      {
        id: "t2",
        type: "docInfo",
        items: [
          { label: "发起人", value: "{{creatorName}}" },
          { label: "日期", value: "{{createdAt}}" },
        ],
        style: { fontSize: 10 },
      },
      { id: "t3", type: "infoTable", columnsPerRow: 2, cells: over.cells, style: { fontSize: 10.5, labelWidth: 28 } },
      ...(over.reasonField
        ? [{ id: "t4", type: "labelField" as const, label: over.reasonField.label, value: over.reasonField.value, style: { fontSize: 10.5, labelWidth: 28 } }]
        : []),
      { id: "t5", type: "spacer", h: 5 },
      {
        id: "t6",
        type: "approvalTable",
        steps: [
          { label: "审批人", value: "{{_approvals.0.assigneeName}}\n{{_approvals.0.opinion}}\n{{_approvals.0.time}}" },
          { label: "复核", value: "{{_approvals.1.assigneeName}}\n{{_approvals.1.opinion}}\n{{_approvals.1.time}}" },
        ],
        style: { fontSize: 10 },
      },
    ],
  }
}

let tplSeq = 300
const TPLS2: BizDocTpl[] = [
  {
    id: 201,
    code: "leave_print",
    name: "请假条",
    category: "人事",
    description: "请假审批通过后套打请假条",
    bindType: "FLOW",
    bindCode: "leave_flow",
    status: "PUBLISHED",
    version: 3,
    paper: "A4",
    landscape: false,
    content: demoTpl({
      title: "请 假 条",
      cells: [
        { label: "请假类型", value: "{{leaveType}}" },
        { label: "请假天数", value: "{{days}}" },
        { label: "开始日期", value: "{{startDate}}" },
        { label: "结束日期", value: "{{endDate}}" },
      ],
      reasonField: { label: "请假事由", value: "{{reason}}" },
    }),
    updatedAt: "2026-07-10T16:20:00",
  },
  {
    id: 202,
    code: "gw_send_sheet",
    name: "发文审批单",
    category: "公文",
    description: "发文流程办结套打审批单",
    bindType: "FLOW",
    bindCode: "gw_send",
    status: "PUBLISHED",
    version: 1,
    paper: "A4",
    landscape: false,
    content: demoTpl({
      title: "发文审批单",
      cells: [
        { label: "文件标题", value: "{{title}}" },
        { label: "文种", value: "{{docType}}" },
        { label: "缓急", value: "{{urgency}}" },
        { label: "密级", value: "{{secret}}" },
      ],
    }),
    updatedAt: "2026-07-11T09:10:00",
  },
  {
    id: 203,
    code: "expense_form_print",
    name: "报销申请打印",
    category: "财务",
    description: "绑定报销表单的通用打印模板",
    bindType: "FORM",
    bindCode: "expense_form",
    status: "DRAFT",
    version: 0,
    paper: "A4",
    landscape: false,
    content: demoTpl({
      title: "报销申请单",
      cells: [
        { label: "报销类型", value: "{{expenseType}}" },
        { label: "金额（元）", value: "{{amount}}" },
      ],
      reasonField: { label: "费用说明", value: "{{memo}}" },
    }),
    updatedAt: "2026-07-11T14:00:00",
  },
]

/** 绑定来源字段清单 mock（真实走 GET /tpls/{id}/fields 聚合端点） */
const BIND_FIELDS: Record<string, DefField[]> = {
  leave_flow: [
    { key: "leaveType", label: "请假类型", type: "select" },
    { key: "startDate", label: "开始日期", type: "date" },
    { key: "endDate", label: "结束日期", type: "date" },
    { key: "days", label: "请假天数", type: "number" },
    { key: "reason", label: "请假事由", type: "textarea" },
  ],
  gw_send: [
    { key: "title", label: "文件标题", type: "input" },
    { key: "docType", label: "文种", type: "select" },
    { key: "urgency", label: "缓急", type: "select" },
    { key: "secret", label: "密级", type: "select" },
    { key: "draftDept", label: "拟稿部门", type: "input" },
  ],
  expense_form: [
    { key: "expenseType", label: "报销类型", type: "select" },
    { key: "amount", label: "报销金额（元）", type: "number" },
    { key: "expenseDate", label: "发生日期", type: "date" },
    { key: "project", label: "费用归属项目", type: "input" },
    { key: "handler", label: "经办人", type: "user" },
    { key: "memo", label: "费用说明", type: "textarea" },
    // 端点同款子表形状（视觉对齐规范拾取器裁定）：subform 条目 + `子表key.列key` 列条目
    { key: "items", label: "费用明细", type: "subform" },
    { key: "items.name", label: "费用明细项", type: "input" },
    { key: "items.amount", label: "金额（元）", type: "number" },
    { key: "items.remark", label: "备注", type: "input" },
  ],
  vehicle_form: [
    { key: "plate", label: "车牌号", type: "input" },
    { key: "driver", label: "用车人", type: "input" },
    { key: "useDate", label: "用车日期", type: "date" },
    { key: "destination", label: "目的地", type: "input" },
  ],
}

/* ============================ API ============================ */

export function fetchTpls(): Promise<TplResult<BizDocTpl[]>> {
  return withMock(
    async () => {
      const page = await api<PageResult<BizDocTpl>>("/api/bizdoc/tpls?pageNum=1&pageSize=200")
      return page.list
    },
    () => [...TPLS2],
  )
}

export function fetchTpl(id: number): Promise<TplResult<BizDocTpl | null>> {
  return withMock(
    () => api<BizDocTpl>(`/api/bizdoc/tpls/${id}`),
    () => TPLS2.find((t) => t.id === id) ?? null,
  )
}

export interface CreateTplPayload {
  name: string
  code: string
  bindType: "FLOW" | "FORM"
  bindCode: string
  category?: string
  description?: string
}

export function createTpl(payload: CreateTplPayload): Promise<TplResult<BizDocTpl>> {
  return withMock(
    () => api<BizDocTpl>("/api/bizdoc/tpls", { method: "POST", body: JSON.stringify(payload) }),
    () => {
      const tpl: BizDocTpl = {
        id: ++tplSeq,
        ...payload,
        status: "DRAFT",
        version: 0,
        paper: "A4",
        landscape: false,
        content: {
          schemaVersion: 2,
          page: {
            size: "A4",
            landscape: false,
            margin: [20, 20, 20, 20],
            fontFamily: "宋体",
            pageNumber: { show: true, position: "footer", align: "center", format: "第 {page} 页 / 共 {total} 页", fontSize: 9 },
          },
          blocks: [],
        },
        updatedAt: new Date().toISOString().slice(0, 19),
      }
      TPLS2.unshift(tpl)
      return { ...tpl }
    },
  )
}

export function saveTpl(id: number, patch: { name?: string; content?: AnyBdTemplate; paper?: BdPageSize; landscape?: boolean; category?: string; description?: string }): Promise<TplResult<BizDocTpl>> {
  return withMock(
    () => api<BizDocTpl>(`/api/bizdoc/tpls/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    () => {
      const t = TPLS2.find((x) => x.id === id)
      if (!t) throw new Error("模板不存在")
      Object.assign(t, patch, { updatedAt: new Date().toISOString().slice(0, 19) })
      return { ...t }
    },
  )
}

export function publishTpl(id: number): Promise<TplResult<BizDocTpl>> {
  return withMock(
    () => api<BizDocTpl>(`/api/bizdoc/tpls/${id}/publish`, { method: "POST" }),
    () => {
      const t = TPLS2.find((x) => x.id === id)
      if (!t) throw new Error("模板不存在")
      t.status = "PUBLISHED"
      t.version += 1
      t.updatedAt = new Date().toISOString().slice(0, 19)
      return { ...t }
    },
  )
}

export function deleteTpl(id: number): Promise<TplResult<void>> {
  return withMock(
    () => api<void>(`/api/bizdoc/tpls/${id}`, { method: "DELETE" }),
    () => {
      const i = TPLS2.findIndex((x) => x.id === id)
      if (i >= 0) TPLS2.splice(i, 1)
    },
  )
}

/**
 * 真实 /tpls/{id}/fields 响应形状归一：后端返回 `{bindType,bindCode,fields:[...],groups:[{label,fields}]}`
 * 对象（groups=FLOW 的 _approvals 伪字段组），mock 是裸数组——曾因把对象当数组 `.map` 崩掉
 * 模板设计器整页白屏。两种形状都收敛为 DefField[]，非法形状回 []。
 */
export function normalizeTplFields(raw: unknown): DefField[] {
  if (Array.isArray(raw)) return raw as DefField[]
  if (raw && typeof raw === "object") {
    const r = raw as { fields?: unknown; groups?: unknown }
    const base = Array.isArray(r.fields) ? (r.fields as DefField[]) : []
    const groups = Array.isArray(r.groups) ? r.groups : []
    const grouped = groups.flatMap((g) =>
      g && typeof g === "object" && Array.isArray((g as { fields?: unknown }).fields)
        ? ((g as { fields: DefField[] }).fields)
        : [],
    )
    return [...base, ...grouped]
  }
  return []
}

/** 编辑器字段树（§11.2 聚合端点：FLOW→绑定表单统一清单+_approvals；FORM→统一清单） */
export function fetchTplFields(tpl: Pick<BizDocTpl, "id" | "bindCode">): Promise<TplResult<DefField[]>> {
  return withMock(
    () => api<unknown>(`/api/bizdoc/tpls/${tpl.id}/fields`).then(normalizeTplFields),
    () => BIND_FIELDS[tpl.bindCode ?? ""] ?? [],
  )
}

/** 实例可打印模板列表（§11.2）；hint 供 mock 匹配（真实端点后端按实例算） */
export function fetchTplsForInstance(instanceId: string | number, hint: { defCode?: string; formCode?: string }): Promise<TplResult<BizDocTpl[]>> {
  return withMock(
    () => api<BizDocTpl[]>(`/api/bizdoc/tpls/for-instance/${instanceId}`),
    () => matchTplsForInstance(TPLS2, hint),
  )
}

/** 渲染数据（§11.2：FLOW/FORM 绑定=实例 formData + _approvals + 系统字段） */
export function fetchTplRenderData(tplId: number, instanceId: string | number): Promise<TplResult<TplRenderData>> {
  return withMock(
    () => api<TplRenderData>(`/api/bizdoc/tpls/${tplId}/render-data?instanceId=${encodeURIComponent(String(instanceId))}`),
    () => {
      const tpl = TPLS2.find((t) => t.id === tplId)
      if (!tpl) throw new Error("模板不存在")
      const fieldList = BIND_FIELDS[tpl.bindCode ?? ""] ?? []
      const fields = Object.fromEntries(fieldList.map((f) => [f.key, f.label]))
      // 离线演示：按模板 token + 字段清单生成样例数据（含 _approvals 样例）
      const data = isV2(tpl.content) ? buildSampleData(tpl.content, fields) : {}
      data.title = "演示实例"
      // §12：含 calc 的模板 → 演示求值并入（真实由后端 render-data 求值）
      if (isV2(tpl.content)) Object.assign(data, evalCalcDemo(tpl.content.calc, data))
      return { tpl: { ...tpl }, data, fields }
    },
  )
}

/** 新建弹窗的绑定编码下拉（FLOW=已发布流程；FORM=已发布在线表单） */
export function fetchBindOptions(bindType: "FLOW" | "FORM"): Promise<TplResult<{ code: string; name: string }[]>> {
  return withMock(
    async () => {
      if (bindType === "FLOW") {
        const page = await api<PageResult<{ defCode: string; name: string; status: string }>>("/api/wf/process-defs?pageNum=1&pageSize=100")
        return page.list.filter((d) => d.status === "PUBLISHED").map((d) => ({ code: d.defCode, name: d.name }))
      }
      const page = await api<PageResult<{ code: string; name: string; status: string }>>("/api/wf/form-defs?pageNum=1&pageSize=100")
      return page.list.filter((f) => f.status === "PUBLISHED").map((f) => ({ code: f.code, name: f.name }))
    },
    () =>
      bindType === "FLOW"
        ? [
            { code: "leave_flow", name: "请假审批" },
            { code: "expense_flow", name: "费用报销审批" },
            { code: "gw_send", name: "发文办理" },
            { code: "gw_recv", name: "收文办理" },
          ]
        : [
            { code: "expense_form", name: "费用报销表单" },
            { code: "vehicle_form", name: "车辆登记表单" },
          ],
  )
}
