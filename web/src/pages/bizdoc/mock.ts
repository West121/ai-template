/**
 * BizDoc · API 层 + mock 先行（契约 §3，前缀 /api/bizdoc/*；后端在 AI 助手之后开工，形状照文档）。
 * 降级：offline / NetworkError / 404（端点未实现）→ 内存 mock（demo=true）；真实 403/400 照抛。
 * mock 内置 2 个已发布演示定义（报销单=绑流程+编号+打印模板；车辆使用登记=纯台账）+ 若干单据。
 */
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { FormWidget } from "@/types/workflow"
import { emptyTemplate, type BdTemplate } from "@/components/bizdoc/model"

/* ============================ 类型（对齐 §2 表结构） ============================ */

export type BizDocDefStatus = "DRAFT" | "PUBLISHED" | "DISABLED"
export type BizDocStatus = "DRAFT" | "APPROVING" | "EFFECTIVE" | "REJECTED" | "VOID"

export interface ListConfig {
  columns: { field: string; label: string; width?: number }[]
  filters: { field: string; label: string; type: "text" | "select" | "dateRange" }[]
}

export interface BizDocDef {
  id: number
  code: string
  name: string
  category?: string
  icon?: string
  formType: "ONLINE" | "CODE"
  formCode: string
  numberRuleId?: number | null
  wfDefCode?: string | null
  listConfig: ListConfig
  defaultPrintTplId?: number | null
  status: BizDocDefStatus
  remark?: string
  /** 标题模板（缺省=定义名+创建人） */
  titleTpl?: string
  updatedAt?: string
  /** mock 便利字段：CODE 表单发起页（真实由后端/流程定义提供） */
  submitPath?: string
}

export interface BizDoc {
  id: number
  defId: number
  defCode: string
  docNo?: string | null
  title: string
  formData: Record<string, unknown>
  status: BizDocStatus
  processInstanceId?: string | null
  creatorName: string
  deptName?: string
  createdAt: string
  updatedAt?: string
  /** REJECTED 时的驳回原因（流程意见） */
  rejectReason?: string
}

export interface BizDocPrintTpl {
  id: number
  defId: number
  name: string
  paper: "A4" | "A5"
  landscape: boolean
  content: BdTemplate
  isDefault: boolean
}

/** GET /api/bizdoc/docs/{id}/print 响应（渲染在前端，契约 §3.2） */
export interface PrintData {
  tpl: BizDocPrintTpl
  /** form_data + 系统字段（docNo/title/creator/dept/date） */
  data: Record<string, unknown>
  /** 字段 key → label 映射 */
  fields: Record<string, string>
}

export interface BdResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<BdResult<T>> {
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

/* ============================ mock 数据 ============================ */

const EXPENSE_SCHEMA: FormWidget[] = [
  { id: "f1", type: "select", label: "报销类型", key: "expenseType", required: true, options: ["差旅费", "办公用品", "招待费", "培训费"], width: "half" },
  { id: "f2", type: "number", label: "报销金额（元）", key: "amount", required: true, width: "half" },
  { id: "f3", type: "date", label: "发生日期", key: "expenseDate", required: true, width: "half" },
  { id: "f4", type: "input", label: "费用归属项目", key: "project", width: "half" },
  { id: "f5", type: "textarea", label: "费用说明", key: "memo", required: true, width: "full" },
]

const VEHICLE_SCHEMA: FormWidget[] = [
  { id: "v1", type: "input", label: "车牌号", key: "plate", required: true, width: "half" },
  { id: "v2", type: "input", label: "用车人", key: "driver", required: true, width: "half" },
  { id: "v3", type: "date", label: "用车日期", key: "useDate", required: true, width: "half" },
  { id: "v4", type: "input", label: "目的地", key: "destination", required: true, width: "half" },
  { id: "v5", type: "textarea", label: "事由", key: "reason", width: "full" },
]

/** 演示打印模板（批A 支持的 label/field/sysfield/line 元素） */
const EXPENSE_TPL: BdTemplate = {
  schemaVersion: 1,
  paper: "A4",
  landscape: false,
  margin: [10, 10, 10, 10],
  elements: [
    { id: "e1", type: "label", x: 55, y: 14, w: 100, h: 10, text: "费用报销单", style: { fontSize: 18, bold: true, align: "center" } },
    { id: "e2", type: "line", x: 15, y: 27, w: 180, h: 0 },
    { id: "e3", type: "sysfield", x: 15, y: 32, w: 80, h: 7, field: "docNo", label: "单号：", style: { fontSize: 10.5 } },
    { id: "e4", type: "sysfield", x: 140, y: 32, w: 55, h: 7, field: "date", label: "日期：", style: { fontSize: 10.5 } },
    { id: "e5", type: "sysfield", x: 15, y: 42, w: 80, h: 7, field: "creator", label: "报销人：", style: { fontSize: 10.5 } },
    { id: "e6", type: "sysfield", x: 140, y: 42, w: 55, h: 7, field: "dept", label: "部门：", style: { fontSize: 10.5 } },
    { id: "e7", type: "field", x: 15, y: 56, w: 80, h: 7, field: "expenseType", label: "报销类型：", style: { fontSize: 10.5 } },
    { id: "e8", type: "field", x: 140, y: 56, w: 55, h: 7, field: "amount", label: "金额（元）：", style: { fontSize: 10.5, bold: true } },
    { id: "e9", type: "field", x: 15, y: 66, w: 80, h: 7, field: "expenseDate", label: "发生日期：", style: { fontSize: 10.5 } },
    { id: "e10", type: "field", x: 140, y: 66, w: 55, h: 7, field: "project", label: "项目：", style: { fontSize: 10.5 } },
    { id: "e11", type: "field", x: 15, y: 78, w: 180, h: 22, field: "memo", label: "费用说明：", style: { fontSize: 10.5 } },
    { id: "e12", type: "line", x: 15, y: 108, w: 180, h: 0 },
    { id: "e13", type: "label", x: 15, y: 113, w: 60, h: 7, text: "审批人签字：", style: { fontSize: 10.5 } },
    { id: "e14", type: "label", x: 120, y: 113, w: 60, h: 7, text: "财务签字：", style: { fontSize: 10.5 } },
    { id: "e15", type: "rect", x: 15, y: 122, w: 85, h: 20 },
    { id: "e16", type: "rect", x: 110, y: 122, w: 85, h: 20 },
  ],
}

const DEFS: BizDocDef[] = [
  {
    id: 1,
    code: "expense",
    name: "费用报销单",
    category: "财务",
    icon: "receipt",
    formType: "ONLINE",
    formCode: "expense_form",
    numberRuleId: 1,
    wfDefCode: "expense_flow",
    listConfig: {
      columns: [
        { field: "expenseType", label: "报销类型" },
        { field: "amount", label: "金额（元）" },
        { field: "project", label: "项目" },
      ],
      filters: [
        { field: "expenseType", label: "报销类型", type: "select" },
        { field: "project", label: "项目", type: "text" },
      ],
    },
    defaultPrintTplId: 11,
    status: "PUBLISHED",
    remark: "绑审批流 + 自动编号 + 打印模板的完整示例",
    updatedAt: "2026-07-10T15:00:00",
  },
  {
    id: 2,
    code: "vehicle_use",
    name: "车辆使用登记",
    category: "行政",
    icon: "car",
    formType: "ONLINE",
    formCode: "vehicle_form",
    numberRuleId: null,
    wfDefCode: null,
    listConfig: {
      columns: [
        { field: "plate", label: "车牌号" },
        { field: "driver", label: "用车人" },
        { field: "destination", label: "目的地" },
      ],
      filters: [{ field: "plate", label: "车牌号", type: "text" }],
    },
    defaultPrintTplId: null,
    status: "PUBLISHED",
    remark: "纯台账（不绑流程，提交即生效）",
    updatedAt: "2026-07-09T10:00:00",
  },
  {
    id: 3,
    code: "asset_in",
    name: "资产入库单",
    category: "行政",
    formType: "ONLINE",
    formCode: "asset_form",
    numberRuleId: 1,
    wfDefCode: null,
    listConfig: { columns: [], filters: [] },
    status: "DRAFT",
    remark: "草稿中的定义（未发布，不出现在单据中心）",
    updatedAt: "2026-07-11T09:00:00",
  },
]

/** mock：定义 → 表单 widgets（真实走 /api/wf/form-defs/{code}/latest） */
const DEF_SCHEMAS: Record<string, FormWidget[]> = {
  expense_form: EXPENSE_SCHEMA,
  vehicle_form: VEHICLE_SCHEMA,
  asset_form: [],
}

const TPLS: BizDocPrintTpl[] = [
  { id: 11, defId: 1, name: "标准报销单（A4）", paper: "A4", landscape: false, content: EXPENSE_TPL, isDefault: true },
]

let docSeq = 100
const DOCS: BizDoc[] = [
  {
    id: 91, defId: 1, defCode: "expense", docNo: "BX〔2026〕0012", title: "费用报销单-王经理",
    formData: { expenseType: "差旅费", amount: 2380.5, expenseDate: "2026-07-05", project: "华东巡检", memo: "7月华东区客户巡检差旅：高铁往返+住宿 2 晚。" },
    status: "EFFECTIVE", processInstanceId: "pi-9001", creatorName: "王经理", deptName: "市场部", createdAt: "2026-07-06T10:00:00",
  },
  {
    id: 92, defId: 1, defCode: "expense", docNo: "BX〔2026〕0013", title: "费用报销单-李文",
    formData: { expenseType: "办公用品", amount: 468, expenseDate: "2026-07-08", project: "", memo: "打印纸与硒鼓补充。" },
    status: "APPROVING", processInstanceId: "pi-9002", creatorName: "李文", deptName: "综合办公室", createdAt: "2026-07-08T14:30:00",
  },
  {
    id: 93, defId: 1, defCode: "expense", docNo: null, title: "费用报销单-陈立",
    formData: { expenseType: "培训费", amount: 1500, expenseDate: "2026-07-09", memo: "架构培训报名费。" },
    status: "DRAFT", creatorName: "陈立", deptName: "研发中心", createdAt: "2026-07-09T09:10:00",
  },
  {
    id: 94, defId: 1, defCode: "expense", docNo: "BX〔2026〕0011", title: "费用报销单-赵敏",
    formData: { expenseType: "招待费", amount: 3200, expenseDate: "2026-07-02", memo: "客户答谢晚宴。" },
    status: "REJECTED", processInstanceId: "pi-9003", creatorName: "赵敏", deptName: "市场部", createdAt: "2026-07-03T11:00:00",
    rejectReason: "请附发票明细后重新提交。",
  },
  {
    id: 95, defId: 1, defCode: "expense", docNo: "BX〔2026〕0009", title: "费用报销单-孙丽",
    formData: { expenseType: "差旅费", amount: 980, expenseDate: "2026-06-20", memo: "重复提交，作废处理。" },
    status: "VOID", creatorName: "孙丽", deptName: "人力资源部", createdAt: "2026-06-21T16:00:00",
  },
  {
    id: 96, defId: 2, defCode: "vehicle_use", docNo: null, title: "车辆使用登记-张伟",
    formData: { plate: "沪A·D12345", driver: "张伟", useDate: "2026-07-10", destination: "浦东机场", reason: "接机" },
    status: "EFFECTIVE", creatorName: "张伟", deptName: "综合办公室", createdAt: "2026-07-10T08:00:00",
  },
]

let defSeq = 10

const slicePage = <T,>(list: T[], pageNum: number, pageSize: number): PageResult<T> => ({
  list: list.slice((pageNum - 1) * pageSize, (pageNum - 1) * pageSize + pageSize),
  total: list.length,
  pageNum,
  pageSize,
})

/* ============================ 定义管理 ============================ */

export function fetchDefs(keyword?: string): Promise<BdResult<BizDocDef[]>> {
  return withMock(
    async () => {
      const q = keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""
      const page = await api<PageResult<BizDocDef>>(`/api/bizdoc/defs?pageNum=1&pageSize=100${q}`)
      return page.list
    },
    () => (keyword ? DEFS.filter((d) => d.name.includes(keyword) || d.code.includes(keyword)) : [...DEFS]),
  )
}

export function fetchDef(code: string): Promise<BdResult<BizDocDef | null>> {
  return withMock(
    () => api<BizDocDef>(`/api/bizdoc/defs/${encodeURIComponent(code)}`),
    () => DEFS.find((d) => d.code === code) ?? null,
  )
}

export interface SaveDefPayload extends Omit<BizDocDef, "id" | "status" | "updatedAt"> {
  id?: number | null
}

export function saveDef(payload: SaveDefPayload): Promise<BdResult<BizDocDef>> {
  return withMock(
    () =>
      payload.id
        ? api<BizDocDef>(`/api/bizdoc/defs/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : api<BizDocDef>("/api/bizdoc/defs", { method: "POST", body: JSON.stringify(payload) }),
    () => {
      const existing = DEFS.find((d) => d.id === payload.id)
      if (existing) {
        Object.assign(existing, payload, { updatedAt: new Date().toISOString().slice(0, 19) })
        return { ...existing }
      }
      const def: BizDocDef = { ...payload, id: ++defSeq, status: "DRAFT", updatedAt: new Date().toISOString().slice(0, 19) }
      DEFS.unshift(def)
      return { ...def }
    },
  )
}

export function publishDef(id: number): Promise<BdResult<BizDocDef>> {
  return withMock(
    () => api<BizDocDef>(`/api/bizdoc/defs/${id}/publish`, { method: "POST" }),
    () => {
      const d = DEFS.find((x) => x.id === id)
      if (d) d.status = "PUBLISHED"
      return { ...(d as BizDocDef) }
    },
  )
}

export function disableDef(id: number): Promise<BdResult<BizDocDef>> {
  return withMock(
    () => api<BizDocDef>(`/api/bizdoc/defs/${id}/disable`, { method: "POST" }),
    () => {
      const d = DEFS.find((x) => x.id === id)
      if (d) d.status = "DISABLED"
      return { ...(d as BizDocDef) }
    },
  )
}

export function deleteDef(id: number): Promise<BdResult<void>> {
  return withMock(
    () => api<void>(`/api/bizdoc/defs/${id}`, { method: "DELETE" }),
    () => {
      const i = DEFS.findIndex((d) => d.id === id)
      if (i >= 0) DEFS.splice(i, 1)
    },
  )
}

/** 定义的表单 widgets（ONLINE：真实走 form-defs latest；mock 用内置 schema） */
export function fetchDefSchema(def: BizDocDef): Promise<BdResult<FormWidget[]>> {
  return withMock(
    async () => {
      const detail = await api<{ schemaJson?: unknown }>(`/api/wf/form-defs/${def.formCode}/latest`)
      try {
        const obj = typeof detail.schemaJson === "string" ? JSON.parse(detail.schemaJson) : detail.schemaJson
        return Array.isArray((obj as { widgets?: unknown })?.widgets) ? ((obj as { widgets: FormWidget[] }).widgets) : []
      } catch {
        return []
      }
    },
    () => DEF_SCHEMAS[def.formCode] ?? [],
  )
}

/** 编号规则下拉（复用公文 /api/office/doc/number/rules） */
export interface NumberRule {
  id: number
  name: string
  pattern?: string
}

export function fetchNumberRules(): Promise<BdResult<NumberRule[]>> {
  return withMock(
    () => api<NumberRule[]>("/api/office/doc/number/rules"),
    () => [
      { id: 1, name: "报销单号（BX〔年〕序号）", pattern: "BX〔{year}〕{seq}" },
      { id: 2, name: "综合办公室行文", pattern: "{org}〔{year}〕{seq}号" },
    ],
  )
}

/** 已发布审批流下拉（复用 wf process-defs） */
export interface WfDefOption {
  defCode: string
  name: string
}

export function fetchPublishedWfDefs(): Promise<BdResult<WfDefOption[]>> {
  return withMock(
    async () => {
      const page = await api<PageResult<{ defCode: string; name: string; status: string }>>(
        "/api/wf/process-defs?pageNum=1&pageSize=100",
      )
      return page.list.filter((d) => d.status === "PUBLISHED").map((d) => ({ defCode: d.defCode, name: d.name }))
    },
    () => [
      { defCode: "expense_flow", name: "费用报销审批" },
      { defCode: "leave_flow", name: "请假审批" },
    ],
  )
}

/* ============================ 运行时 ============================ */

export interface DocQuery {
  defCode: string
  keyword?: string
  status?: BizDocStatus
  /** list_config filters 动态条件（field → 值） */
  filters?: Record<string, string>
  pageNum: number
  pageSize: number
}

export function fetchDocPage(q: DocQuery): Promise<BdResult<PageResult<BizDoc>>> {
  return withMock(
    async () => {
      const p = new URLSearchParams({ defCode: q.defCode, pageNum: String(q.pageNum), pageSize: String(q.pageSize) })
      if (q.keyword) p.set("keyword", q.keyword)
      if (q.status) p.set("status", q.status)
      for (const [k, v] of Object.entries(q.filters ?? {})) {
        if (v) p.set(`f_${k}`, v)
      }
      return api<PageResult<BizDoc>>(`/api/bizdoc/docs?${p.toString()}`)
    },
    () => {
      const filtered = DOCS.filter((d) => {
        if (d.defCode !== q.defCode) return false
        if (q.status && d.status !== q.status) return false
        if (q.keyword && !d.title.includes(q.keyword) && !(d.docNo ?? "").includes(q.keyword)) return false
        for (const [k, v] of Object.entries(q.filters ?? {})) {
          if (v && !String(d.formData[k] ?? "").includes(v)) return false
        }
        return true
      })
      return slicePage(filtered, q.pageNum, q.pageSize)
    },
  )
}

export interface SaveDocPayload {
  id?: number | null
  defCode: string
  formData: Record<string, unknown>
}

export function saveDoc(payload: SaveDocPayload): Promise<BdResult<BizDoc>> {
  return withMock(
    () =>
      payload.id
        ? api<BizDoc>(`/api/bizdoc/docs/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : api<BizDoc>("/api/bizdoc/docs", { method: "POST", body: JSON.stringify(payload) }),
    () => {
      const user = useAuthStore.getState().user
      const existing = DOCS.find((d) => d.id === payload.id)
      if (existing) {
        existing.formData = payload.formData
        existing.updatedAt = new Date().toISOString().slice(0, 19)
        return { ...existing }
      }
      const def = DEFS.find((d) => d.code === payload.defCode)
      const doc: BizDoc = {
        id: ++docSeq,
        defId: def?.id ?? 0,
        defCode: payload.defCode,
        docNo: null,
        title: `${def?.name ?? payload.defCode}-${user?.name ?? "演示用户"}`,
        formData: payload.formData,
        status: "DRAFT",
        creatorName: user?.name ?? "演示用户",
        deptName: user?.dept ?? "演示部门",
        createdAt: new Date().toISOString().slice(0, 19),
      }
      DOCS.unshift(doc)
      return { ...doc }
    },
  )
}

/** 提交：无流程 → 占号+EFFECTIVE；有流程 → 占号+起流程+APPROVING（mock 按定义推演） */
export function submitDoc(id: number): Promise<BdResult<BizDoc>> {
  return withMock(
    () => api<BizDoc>(`/api/bizdoc/docs/${id}/submit`, { method: "POST" }),
    () => {
      const doc = DOCS.find((d) => d.id === id)
      if (!doc) throw new Error("单据不存在")
      const def = DEFS.find((d) => d.id === doc.defId)
      if (def?.numberRuleId != null && !doc.docNo) {
        doc.docNo = `BX〔2026〕${String(14 + DOCS.filter((x) => x.docNo).length).padStart(4, "0")}`
      }
      if (def?.wfDefCode) {
        doc.status = "APPROVING"
        doc.processInstanceId = `pi-mock-${id}`
      } else {
        doc.status = "EFFECTIVE"
      }
      doc.updatedAt = new Date().toISOString().slice(0, 19)
      return { ...doc }
    },
  )
}

export function voidDoc(id: number): Promise<BdResult<BizDoc>> {
  return withMock(
    () => api<BizDoc>(`/api/bizdoc/docs/${id}/void`, { method: "POST" }),
    () => {
      const doc = DOCS.find((d) => d.id === id)
      if (doc) {
        doc.status = "VOID"
        doc.updatedAt = new Date().toISOString().slice(0, 19)
      }
      return { ...(doc as BizDoc) }
    },
  )
}

export function deleteDoc(id: number): Promise<BdResult<void>> {
  return withMock(
    () => api<void>(`/api/bizdoc/docs/${id}`, { method: "DELETE" }),
    () => {
      const i = DOCS.findIndex((d) => d.id === id)
      if (i >= 0) DOCS.splice(i, 1)
    },
  )
}

/* ============================ 打印 ============================ */

export function fetchPrintData(docId: number, tplId?: number): Promise<BdResult<PrintData>> {
  return withMock(
    () => api<PrintData>(`/api/bizdoc/docs/${docId}/print${tplId != null ? `?tplId=${tplId}` : ""}`),
    () => {
      const doc = DOCS.find((d) => d.id === docId)
      if (!doc) throw new Error("单据不存在")
      const def = DEFS.find((d) => d.id === doc.defId)
      const tpl =
        TPLS.find((t) => (tplId != null ? t.id === tplId : t.defId === doc.defId && t.isDefault)) ??
        ({ id: 0, defId: doc.defId, name: "临时模板", paper: "A4", landscape: false, content: emptyTemplate(), isDefault: false } satisfies BizDocPrintTpl)
      const fields: Record<string, string> = {}
      for (const w of DEF_SCHEMAS[def?.formCode ?? ""] ?? []) fields[w.key ?? w.id] = w.label
      return {
        tpl,
        data: {
          ...doc.formData,
          docNo: doc.docNo ?? "",
          title: doc.title,
          creator: doc.creatorName,
          dept: doc.deptName ?? "",
          date: doc.createdAt.slice(0, 10),
          status: doc.status,
        },
        fields,
      }
    },
  )
}

/** 定义下的打印模板列表（批A：定义抽屉展示 + 打印选模板） */
export function fetchPrintTpls(defId: number): Promise<BdResult<BizDocPrintTpl[]>> {
  return withMock(
    () => api<BizDocPrintTpl[]>(`/api/bizdoc/defs/${defId}/print-tpls`),
    () => TPLS.filter((t) => t.defId === defId),
  )
}
