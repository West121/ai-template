/**
 * 表单模板库：内置常用 OA 表单模板（请假 / 报销 / 采购 / 入职）+ 用户自定义模板（localStorage）。
 * 应用模板即替换当前画布 widgets 与标题；「另存为模板」把当前设计持久化到本地。
 */
import { createWidget, type FormWidget } from "./model"

export interface FormTemplate {
  code: string
  name: string
  description: string
  title: string
  /** 内置模板按需构建（每次都是全新 widget id）；自定义模板直接给 widgets 快照 */
  build: () => FormWidget[]
  builtin: boolean
}

/* ---------------- 构建辅助 ---------------- */

function w(type: Parameters<typeof createWidget>[0], patch: Partial<FormWidget>): FormWidget {
  return { ...createWidget(type), ...patch }
}

/* ---------------- 内置模板 ---------------- */

function leaveTemplate(): FormWidget[] {
  return [
    w("select", { label: "请假类型", required: true, width: "half", options: ["年假", "事假", "病假", "调休", "婚假", "产假"] }),
    w("radio", { label: "紧急程度", width: "half", options: ["普通", "紧急"] }),
    w("date", { label: "开始日期", required: true, width: "half" }),
    w("date", { label: "结束日期", required: true, width: "half" }),
    w("number", { label: "请假天数", required: true, width: "half", placeholder: "请输入天数" }),
    w("user", { label: "代理人", width: "half" }),
    w("textarea", { label: "请假事由", required: true, description: "请如实填写，将作为审批依据" }),
    w("upload", { label: "证明附件" }),
    w("note", { content: "提交后按「部门主管 → 人事」流程审批，3 天以上需总经理加签。" }),
  ]
}

function reimburseTemplate(): FormWidget[] {
  const detail = w("subform", { label: "报销明细", props: { mode: "table" } })
  detail.children = [
    w("input", { label: "费用项目", required: true }),
    w("select", { label: "费用类型", options: ["交通", "餐饮", "住宿", "办公", "其他"] }),
    w("amount", { label: "金额", required: true }),
    w("input", { label: "备注" }),
  ]
  return [
    w("input", { label: "报销事由", required: true }),
    w("select", { label: "报销类别", width: "half", options: ["差旅报销", "日常报销", "招待报销"] }),
    w("date", { label: "报销日期", width: "half" }),
    detail,
    w("amount", { label: "报销总额", required: true, description: "请与明细合计一致", props: { prefix: "￥" } }),
    w("image", { label: "发票 / 票据", description: "上传发票照片" }),
    w("textarea", { label: "备注说明" }),
  ]
}

function purchaseTemplate(): FormWidget[] {
  const items = w("subform", { label: "采购物品清单", props: { mode: "table" } })
  items.children = [
    w("input", { label: "物品名称", required: true }),
    w("number", { label: "数量", required: true }),
    w("amount", { label: "单价" }),
    w("input", { label: "规格 / 用途" }),
  ]
  return [
    w("input", { label: "采购主题", required: true }),
    w("input", { label: "供应商", width: "half" }),
    w("date", { label: "期望到货日期", width: "half" }),
    items,
    w("amount", { label: "预算金额", required: true, props: { prefix: "￥" } }),
    w("relation", { label: "关联合同", dataSource: { type: "form", defCode: "contract", labelField: "name", valueField: "id" }, props: { multiple: false } }),
    w("user", { label: "采购负责人", width: "half" }),
    w("radio", { label: "紧急程度", width: "half", options: ["普通", "加急"] }),
    w("textarea", { label: "采购说明" }),
  ]
}

function onboardTemplate(): FormWidget[] {
  const grid = w("grid", { label: "基本信息", props: { columns: 2 } })
  grid.children = [
    w("input", { label: "姓名", required: true, width: { span: 12 } }),
    w("radio", { label: "性别", width: { span: 12 }, options: ["男", "女"] }),
    w("input", {
      label: "手机号",
      width: { span: 12 },
      validation: [{ type: "regex", pattern: "^1[3-9]\\d{9}$", preset: "mobile", message: "请输入正确的手机号" }],
    }),
    w("input", {
      label: "身份证号",
      width: { span: 12 },
      validation: [{ type: "regex", pattern: "^\\d{15}$|^\\d{17}[\\dXx]$", preset: "idcard" }],
    }),
  ]
  return [
    grid,
    w("address", { label: "家庭住址" }),
    w("user", { label: "入职部门", width: "half" }),
    w("date", { label: "入职日期", required: true, width: "half" }),
    w("input", { label: "紧急联系人", width: "half" }),
    w("input", { label: "紧急联系电话", width: "half" }),
    w("image", { label: "证件照" }),
    w("signature", { label: "本人签名", required: true }),
  ]
}

export const BUILTIN_TEMPLATES: FormTemplate[] = [
  { code: "leave", name: "请假申请", title: "请假申请表", description: "请假类型 / 起止日期 / 事由 / 附件", build: leaveTemplate, builtin: true },
  { code: "reimburse", name: "费用报销", title: "费用报销单", description: "报销明细子表单 + 金额大写 + 发票", build: reimburseTemplate, builtin: true },
  { code: "purchase", name: "采购申请", title: "采购申请单", description: "采购清单 + 预算金额 + 关联合同", build: purchaseTemplate, builtin: true },
  { code: "onboard", name: "入职登记", title: "员工入职登记表", description: "栅格布局 + 校验 + 省市区 + 签名", build: onboardTemplate, builtin: true },
]

/* ---------------- 自定义模板（localStorage） ---------------- */

const LS_KEY = "form-designer-templates-v2"

interface StoredTemplate {
  code: string
  name: string
  description: string
  title: string
  widgets: FormWidget[]
}

function readStore(): StoredTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? (JSON.parse(raw) as StoredTemplate[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeStore(list: StoredTemplate[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function loadCustomTemplates(): FormTemplate[] {
  return readStore().map((t) => ({
    code: t.code,
    name: t.name,
    description: t.description,
    title: t.title,
    builtin: false,
    build: () => JSON.parse(JSON.stringify(t.widgets)) as FormWidget[],
  }))
}

export function saveCustomTemplate(input: { name: string; description?: string; title: string; widgets: FormWidget[] }) {
  const list = readStore()
  const code = `custom-${Date.now()}`
  list.push({
    code,
    name: input.name,
    description: input.description ?? "",
    title: input.title,
    widgets: JSON.parse(JSON.stringify(input.widgets)) as FormWidget[],
  })
  writeStore(list)
}

export function deleteCustomTemplate(code: string) {
  writeStore(readStore().filter((t) => t.code !== code))
}
