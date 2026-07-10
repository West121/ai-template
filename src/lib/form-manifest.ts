/**
 * 表单字段清单契约（设计文档第二部分 2.2 / 2.4）。
 *
 * 所有表单（无论来源）向流程暴露机器可读的字段清单 `FormFieldManifest`，
 * 「节点字段权限编辑器」（设计时）与 `HostedForm`（运行时）消费同一份清单。
 * 范围锁定两类：
 *  - `ONLINE`：在线设计器表单，清单由后端从 schemaJson 派生（`GET /api/wf/forms/{formKey}/fields`）。
 *  - `CODE`：本仓库手写 react-hook-form 表单，清单在组件旁静态导出并登记到前端 registry。
 *
 * 本文件为**纯契约 + 纯函数**（无 React / 无 api 依赖），可在 node 环境直接单测。
 * 与后端 DTO 对齐（`server` 的 `FormFieldManifest` / `FieldDescriptor`，均 NON_NULL）：
 * 可选字段缺省时后端不下发对应键，前端解析为 `undefined`。禁 any。
 */

/** 表单来源类型（与后端 `FormFieldManifest.formType` 对齐）。 */
export type FormType = "ONLINE" | "CODE"

/** 归一化选项（radio/checkbox/select 的静态选项）。 */
export interface FieldOption {
  label: string
  value: string
}

/**
 * 字段描述符（与后端 `FieldDescriptor` 对齐）。
 *
 * @property key        字段稳定标识；子表单列字段带 `子表单key.列key` 前缀
 * @property label      字段显示名
 * @property type       控件类型（input/textarea/number/select/date/user/subform/...）
 * @property group      分组名：来自分组容器标题或子表单标题；顶层无分组则缺省
 * @property options    静态选项；无则缺省
 * @property dataSource  数据源（字典/关联表单/接口等），原样透传；无则缺省
 * @property required   字段固有必填。**前端 CODE 表单可声明**，供矩阵与运行时校验消费；
 *                      后端 ONLINE 清单不下发此键（缺省 → undefined），两端仍对齐。
 */
export interface FieldDescriptor {
  key: string
  label: string
  type: string
  group?: string
  options?: FieldOption[]
  dataSource?: unknown
  required?: boolean
}

/** 表单字段清单（与后端 `R<FormFieldManifest>.data` 对齐）。 */
export interface FormFieldManifest {
  formKey: string
  formType: FormType
  fields: FieldDescriptor[]
}

/**
 * 运行时字段策略（设计文档 2.2）：节点级联动的三态。
 *  - `visible`：false → 不渲染该字段。
 *  - `editable`：false → 字段 disabled（只读）。
 *  - `required`：true  → 注入必填校验。
 */
export interface FieldPolicy {
  visible: boolean
  editable: boolean
  required: boolean
}

/** 默认策略：可见、可编辑、非必填。 */
export const DEFAULT_FIELD_POLICY: FieldPolicy = { visible: true, editable: true, required: false }

/** `HostedForm` 消费的策略表：字段 key → 策略。 */
export type FieldPolicyMap = Record<string, FieldPolicy>

/** 单字段的渲染态（由策略派生，供手写表单组件逐字段套用）。 */
export interface FieldRenderState {
  /** 不渲染 */
  hidden: boolean
  /** 只读（react-hook-form 字段 disabled） */
  disabled: boolean
  /** 必填（向字段 rules 注入必填校验） */
  required: boolean
}

/**
 * 从策略表派生某字段的渲染态。策略缺省即全放行（可见/可编辑/非必填）。
 * `HostedForm` 与注册组件共用此纯函数，实现 visible/editable/required 的**通用处理**。
 */
export function fieldStateOf(policy: FieldPolicyMap | undefined, key: string): FieldRenderState {
  const p = policy?.[key]
  if (!p) return { hidden: false, disabled: false, required: false }
  return { hidden: !p.visible, disabled: !p.editable, required: p.required }
}

/** 判定字段值是否为“空”（未填）：null/undefined、纯空白字符串、空数组皆视为空。 */
export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === "string") return v.trim() === ""
  if (Array.isArray(v)) return v.length === 0
  return false
}

/**
 * 提交前必填校验（设计文档 2.4：required 来自清单，经 `buildFieldPolicyMap` 合入策略）。
 * 返回未填写的必填字段 key 列表：只校验**可见且必填**的字段（隐藏字段不阻塞提交）。
 * 纯函数、无 React——供 CODE 表单办理动作在带 formData 提交前作权威门禁，且可在 node 环境单测。
 */
export function missingRequiredFields(
  policy: FieldPolicyMap | undefined,
  values: Record<string, unknown>,
): string[] {
  if (!policy) return []
  const out: string[] = []
  for (const [key, p] of Object.entries(policy)) {
    if (p.visible && p.required && isEmptyValue(values[key])) out.push(key)
  }
  return out
}
