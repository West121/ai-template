/**
 * BizDoc · API 层 + mock 先行（契约 §3，前缀 /api/bizdoc/*；后端在 AI 助手之后开工，形状照文档）。
 * 降级：offline / NetworkError / 404（端点未实现）→ 内存 mock（demo=true）；真实 403/400 照抛。
 * §10：单据字段为定义私有 formSchema（INLINE 主路径），演示定义均内嵌 schema；另留一条 CODE 存量形态。
 */
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { FormWidget } from "@/types/workflow"
import type { BdTemplate } from "@/components/bizdoc/model"
import { emptyTemplateV2, evalCalcDemo, isV2, type AnyBdTemplate, type BdTemplateV2 } from "@/components/bizdoc/model-v2"

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
  /**
   * §10 语义：INLINE=内置字段设计（默认/主路径，schema 存 formSchema）｜CODE=高级绑手写表单
   * ｜ONLINE=存量兼容读（外部在线表单引用，编辑器提供「转为内置设计」）
   */
  formType: "INLINE" | "CODE" | "ONLINE"
  /** CODE/存量 ONLINE 的表单标识；INLINE 留空 */
  formCode: string
  /** INLINE 私有表单 schema（widgets 与在线表单同构，FormRenderer/设计器零改动复用；磐石 §10 加列） */
  formSchema?: FormWidget[] | null
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
  paper: "A4" | "A5" | "Letter"
  landscape: boolean
  /** v2（§9 文档流块级，新建默认）或 v1（自由定位，兼容读） */
  content: AnyBdTemplate
  isDefault: boolean
}

/** GET /api/bizdoc/docs/{id}/print 响应（渲染在前端，契约 §3.2 + §9.3 _approvals） */
export interface PrintData {
  tpl: BizDocPrintTpl
  /** form_data + 系统字段（docNo/title/creatorName/deptName/createdAt/status）+ _approvals（§9.3，磐石在补） */
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
  // user 关联字段：打印数据里值为 {id,name,username} 对象（显示属性 {{handler.name}} 演示）
  { id: "f6", type: "user", label: "经办人", key: "handler", width: "half" },
  { id: "f5", type: "textarea", label: "费用说明", key: "memo", required: true, width: "full" },
]

const VEHICLE_SCHEMA: FormWidget[] = [
  { id: "v1", type: "input", label: "车牌号", key: "plate", required: true, width: "half" },
  { id: "v2", type: "input", label: "用车人", key: "driver", required: true, width: "half" },
  { id: "v3", type: "date", label: "用车日期", key: "useDate", required: true, width: "half" },
  { id: "v4", type: "input", label: "目的地", key: "destination", required: true, width: "half" },
  { id: "v5", type: "textarea", label: "事由", key: "reason", width: "full" },
]

/** 演示打印模板 v2（§9 文档流：页眉页脚/标题/单据信息/智能表格/标签字段/明细/审批区/分栏签章+二维码） */
const EXPENSE_TPL_V2: BdTemplateV2 = {
  schemaVersion: 2,
  page: {
    size: "A4",
    landscape: false,
    margin: [18, 18, 18, 18],
    fontFamily: "宋体",
    pageNumber: { show: true, position: "footer", align: "center", format: "第 {page} 页 / 共 {total} 页", fontSize: 9, color: "#9ca3af" },
    header: { text: "涵韬科技 · 财务单据", align: "left", fontSize: 8.5 },
    footer: { text: "编号 {{docNo}}", align: "right", fontSize: 8.5 },
  },
  // §12 计算配置演示：聚合（明细合计/大写）+ 计算字段（含税，引用聚合名）
  calc: {
    aggregates: [
      { name: "total_amount", label: "合计金额", source: "items", field: "amount", fn: "SUM", format: "number", scale: 2 },
      { name: "total_cn", label: "合计大写", source: "items", field: "amount", fn: "SUM", format: "chinese", scale: 2 },
    ],
    computed: [{ name: "amount_with_tax", label: "含税合计", expr: "round(total_amount * 1.06, 2)", format: "number", scale: 2 }],
  },
  blocks: [
    { id: "b1", type: "title", text: "费用报销单", style: { fontSize: 18, bold: true, align: "center" } },
    {
      id: "b2",
      type: "docInfo",
      items: [
        { label: "单据编号", value: "{{docNo}}" },
        { label: "日期", value: "{{createdAt}}" },
      ],
      style: { fontSize: 10 },
    },
    {
      id: "b3",
      type: "infoTable",
      columnsPerRow: 2,
      cells: [
        { label: "报销人", value: "{{creatorName}}" },
        { label: "所属部门", value: "{{deptName}}" },
        { label: "报销类型", value: "{{expenseType}}" },
        { label: "报销金额（元）", value: "{{amount}}" },
        { label: "发生日期", value: "{{expenseDate}}" },
        { label: "费用归属项目", value: "{{project}}" },
        { label: "经办人", value: "{{handler.name}}（{{handler.username}}）" },
      ],
      style: { fontSize: 10.5, labelWidth: 30 },
    },
    { id: "b4", type: "labelField", label: "费用说明", value: "{{memo}}", style: { fontSize: 10.5, labelWidth: 30 } },
    {
      id: "b5",
      type: "detailTable",
      field: "items",
      columns: [
        { field: "name", label: "费用明细", w: 70 },
        { field: "amount", label: "金额（元）", w: 35 },
        { field: "remark", label: "备注" },
      ],
      showIndex: true,
      style: { fontSize: 10.5 },
    },
    { id: "b6", type: "labelField", label: "合计（大写）", value: "{{total_cn}}（含税 {{amount_with_tax}} 元）", style: { fontSize: 10.5, labelWidth: 30 } },
    { id: "b6s", type: "spacer", h: 4 },
    {
      id: "b7",
      type: "approvalTable",
      steps: [
        { label: "部门审批", value: "{{_approvals.0.assigneeName}}\n{{_approvals.0.opinion}}\n{{_approvals.0.time}}" },
        { label: "财务复核", value: "{{_approvals.1.assigneeName}}\n{{_approvals.1.opinion}}\n{{_approvals.1.time}}" },
      ],
      style: { fontSize: 10 },
    },
    { id: "b8", type: "spacer", h: 6 },
    {
      id: "b9",
      type: "row",
      children: [
        [{ id: "b9a", type: "signature", label: "财务签章", align: "left" }],
        [{ id: "b9b", type: "qrcode", value: "{{docNo}}", size: 20, align: "right" }],
      ],
    },
    { id: "b10", type: "divider" },
    { id: "b11", type: "text", content: "说明：本单据由涵韬 OA 生成，编号 {{docNo}}，验真请扫描右上二维码。", style: { fontSize: 9 } },
  ],
}

/** 旧版演示模板（批A v1 自由定位，保留验证兼容读取） */
const EXPENSE_TPL_V1: BdTemplate = {
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
    formType: "INLINE",
    formCode: "",
    formSchema: EXPENSE_SCHEMA,
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
    defaultPrintTplId: 12,
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
    formType: "INLINE",
    formCode: "",
    formSchema: VEHICLE_SCHEMA,
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
    formType: "INLINE",
    formCode: "",
    formSchema: [],
    numberRuleId: 1,
    wfDefCode: null,
    listConfig: { columns: [], filters: [] },
    status: "DRAFT",
    remark: "草稿中的定义（字段未设计，发布校验会拦）",
    updatedAt: "2026-07-11T09:00:00",
  },
  {
    id: 4,
    code: "gw_send_reg",
    name: "发文办理（CODE 表单）",
    category: "公文",
    formType: "CODE",
    formCode: "gw_send",
    numberRuleId: null,
    wfDefCode: "gw_send",
    listConfig: { columns: [], filters: [] },
    status: "PUBLISHED",
    remark: "高级：绑手写 CODE 表单的存量形态（录入走其业务页面）",
    submitPath: "/document/send?new=1",
    updatedAt: "2026-07-11T11:00:00",
  },
]

/** 定义的录入 schema（§10）：INLINE=私有 formSchema；CODE=无（走 submitPath）；ONLINE 存量=mock 无从取回空 */
function schemaOfDef(def: BizDocDef | undefined): FormWidget[] {
  if (!def) return []
  if (def.formType === "INLINE") return def.formSchema ?? []
  return []
}

const TPLS: BizDocPrintTpl[] = [
  { id: 12, defId: 1, name: "标准报销单（A4）", paper: "A4", landscape: false, content: EXPENSE_TPL_V2, isDefault: true },
  { id: 11, defId: 1, name: "旧版套打（v1 兼容）", paper: "A4", landscape: false, content: EXPENSE_TPL_V1, isDefault: false },
]
let tplSeq = 20

let docSeq = 100
const DOCS: BizDoc[] = [
  {
    id: 91, defId: 1, defCode: "expense", docNo: "BX〔2026〕0012", title: "费用报销单-王经理",
    formData: {
      expenseType: "差旅费", amount: 2380.5, expenseDate: "2026-07-05", project: "华东巡检", memo: "7月华东区客户巡检差旅：高铁往返+住宿 2 晚。",
      handler: { id: 5, name: "李文", username: "liwen" },
      items: [
        { name: "高铁票（沪杭往返）", amount: 620.5, remark: "二等座" },
        { name: "酒店住宿 2 晚", amount: 1560, remark: "含早" },
        { name: "市内交通", amount: 200, remark: "" },
      ],
    },
    status: "EFFECTIVE", processInstanceId: "pi-9001", creatorName: "王经理", deptName: "市场部", createdAt: "2026-07-06T10:00:00",
  },
  {
    id: 92, defId: 1, defCode: "expense", docNo: "BX〔2026〕0013", title: "费用报销单-李文",
    formData: {
      expenseType: "办公用品", amount: 468, expenseDate: "2026-07-08", project: "", memo: "打印纸与硒鼓补充。",
      items: [
        { name: "A4 打印纸 10 箱", amount: 280, remark: "" },
        { name: "硒鼓 2 只", amount: 188, remark: "HP 88A" },
      ],
    },
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

/**
 * 定义的录入表单 widgets（§10）：
 * INLINE → 直接取私有 formSchema（本地，不发请求）；
 * CODE → 空（录入走其业务页面 submitPath）；
 * 存量 ONLINE → 兼容读外部在线表单（form-defs latest）。
 */
export function fetchDefSchema(def: BizDocDef): Promise<BdResult<FormWidget[]>> {
  if (def.formType !== "ONLINE") {
    return Promise.resolve({ data: schemaOfDef(def), demo: false })
  }
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
    () => [],
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
        ({ id: 0, defId: doc.defId, name: "临时模板", paper: "A4", landscape: false, content: emptyTemplateV2(), isDefault: false } satisfies BizDocPrintTpl)
      const fields: Record<string, string> = {}
      for (const w of schemaOfDef(def)) fields[w.key ?? w.id] = w.label
      // §9.3：绑流程单据带 _approvals（按办理顺序）；mock 按状态推演，真实由磐石从流程实例取
      const approvals: Record<string, unknown>[] = []
      if (doc.processInstanceId && (doc.status === "APPROVING" || doc.status === "EFFECTIVE" || doc.status === "REJECTED")) {
        approvals.push({ nodeName: "部门审批", assigneeName: "王经理", opinion: doc.status === "REJECTED" ? doc.rejectReason ?? "退回修改" : "同意。", time: `${doc.createdAt.slice(0, 10)} 14:00` })
        if (doc.status === "EFFECTIVE") {
          approvals.push({ nodeName: "财务复核", assigneeName: "李会计", opinion: "已复核，金额无误。", time: `${doc.createdAt.slice(0, 10)} 16:30` })
        }
      }
      const data: Record<string, unknown> = {
          ...doc.formData,
          docNo: doc.docNo ?? "",
          title: doc.title,
          // v2 系统字段（§9.1）+ v1 旧键（兼容旧模板）
          creatorName: doc.creatorName,
          deptName: doc.deptName ?? "",
          createdAt: doc.createdAt.slice(0, 10),
          creator: doc.creatorName,
          dept: doc.deptName ?? "",
          date: doc.createdAt.slice(0, 10),
          status: doc.status,
          _approvals: approvals,
      }
      // §12：含 calc 的 v2 模板 → 求值并入 data（真实由磐石在出数据时求值）
      if (isV2(tpl.content)) Object.assign(data, evalCalcDemo(tpl.content.calc, data))
      return { tpl, data, fields }
    },
  )
}

/** 定义下的打印模板列表（定义抽屉展示 + 打印选模板） */
export function fetchPrintTpls(defId: number): Promise<BdResult<BizDocPrintTpl[]>> {
  return withMock(
    () => api<BizDocPrintTpl[]>(`/api/bizdoc/defs/${defId}/print-tpls`),
    () => TPLS.filter((t) => t.defId === defId),
  )
}

/** 单个模板（设计器载入） */
export function fetchPrintTpl(tplId: number): Promise<BdResult<BizDocPrintTpl | null>> {
  return withMock(
    () => api<BizDocPrintTpl>(`/api/bizdoc/print-tpls/${tplId}`),
    () => TPLS.find((t) => t.id === tplId) ?? null,
  )
}

export interface SavePrintTplPayload {
  id?: number | null
  defId: number
  name: string
  paper: BizDocPrintTpl["paper"]
  landscape: boolean
  content: AnyBdTemplate
  isDefault?: boolean
}

/** 保存模板（设计器）：新建 POST / 更新 PUT */
export function savePrintTpl(payload: SavePrintTplPayload): Promise<BdResult<BizDocPrintTpl>> {
  return withMock(
    () =>
      payload.id
        ? api<BizDocPrintTpl>(`/api/bizdoc/print-tpls/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : api<BizDocPrintTpl>("/api/bizdoc/print-tpls", { method: "POST", body: JSON.stringify(payload) }),
    () => {
      const existing = TPLS.find((t) => t.id === payload.id)
      if (existing) {
        Object.assign(existing, { name: payload.name, paper: payload.paper, landscape: payload.landscape, content: payload.content })
        return { ...existing }
      }
      const tpl: BizDocPrintTpl = {
        id: ++tplSeq,
        defId: payload.defId,
        name: payload.name,
        paper: payload.paper,
        landscape: payload.landscape,
        content: payload.content,
        isDefault: payload.isDefault ?? TPLS.every((t) => t.defId !== payload.defId),
      }
      TPLS.push(tpl)
      return { ...tpl }
    },
  )
}

export function setDefaultPrintTpl(tplId: number): Promise<BdResult<void>> {
  return withMock(
    () => api<void>(`/api/bizdoc/print-tpls/${tplId}/default`, { method: "POST" }),
    () => {
      const tpl = TPLS.find((t) => t.id === tplId)
      if (!tpl) return
      for (const t of TPLS) {
        if (t.defId === tpl.defId) t.isDefault = t.id === tplId
      }
      const def = DEFS.find((d) => d.id === tpl.defId)
      if (def) def.defaultPrintTplId = tplId
    },
  )
}

export function deletePrintTpl(tplId: number): Promise<BdResult<void>> {
  return withMock(
    () => api<void>(`/api/bizdoc/print-tpls/${tplId}`, { method: "DELETE" }),
    () => {
      const i = TPLS.findIndex((t) => t.id === tplId)
      if (i >= 0) TPLS.splice(i, 1)
    },
  )
}
