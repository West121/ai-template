/**
 * 插值变量目录（纯数据，无组件——供 field-picker 与单元格「插入变量」浮层同源使用）：
 * 表单字段（含 user/dept 等关联字段的显示属性变体）/ 系统字段 / 审批数据 / 计算变量。
 */
export interface FieldOption {
  key: string
  label: string
  /** widget/字段类型（user/dept 等关联类字段展开「显示属性」） */
  type?: string
}

export const SYS_FIELD_OPTIONS_V2: FieldOption[] = [
  { key: "docNo", label: "单号" },
  { key: "title", label: "标题" },
  { key: "creatorName", label: "创建人" },
  { key: "deptName", label: "部门" },
  { key: "createdAt", label: "创建时间" },
  { key: "status", label: "状态" },
]

export const APPROVAL_SUBS: FieldOption[] = [
  { key: "assigneeName", label: "办理人" },
  { key: "opinion", label: "意见" },
  { key: "time", label: "时间" },
  { key: "nodeName", label: "节点名" },
]

/**
 * 关联类字段的「显示属性」（对齐参考编辑器：绑定时可选对象子键）。
 * 磐石在打印数据里把 user/dept 等值解析为 {id,name,...} 对象，token 走点路径取子键。
 */
export const DISPLAY_ATTRS: Record<string, { sub: string; label: string }[]> = {
  user: [
    { sub: "name", label: "名称" },
    { sub: "username", label: "账号" },
  ],
  dept: [{ sub: "name", label: "名称" }],
  relation: [
    { sub: "name", label: "名称" },
    { sub: "id", label: "ID" },
  ],
}

export interface VarItem {
  /** 插值表达式（不含花括号） */
  expr: string
  /** chip 文案（含显示属性变体：用车人(名称)） */
  label: string
}

export interface VarGroup {
  title: string
  items: VarItem[]
}

/**
 * 变量分组（「插入变量」浮层）：表单字段（+显示属性变体平铺）/系统字段/审批数据（前 2 步）/计算变量。
 */
export function buildVarGroups(fields: FieldOption[], calcVars: FieldOption[] = []): VarGroup[] {
  const form: VarItem[] = []
  for (const f of fields) {
    form.push({ expr: f.key, label: f.label })
    for (const a of (f.type && DISPLAY_ATTRS[f.type]) || []) {
      form.push({ expr: `${f.key}.${a.sub}`, label: `${f.label}(${a.label})` })
    }
  }
  const approvals: VarItem[] = [0, 1].flatMap((i) =>
    APPROVAL_SUBS.map((s) => ({ expr: `_approvals.${i}.${s.key}`, label: `审批${i + 1}·${s.label}` })),
  )
  const groups: VarGroup[] = [
    { title: "表单字段", items: form },
    { title: "系统字段", items: SYS_FIELD_OPTIONS_V2.map((f) => ({ expr: f.key, label: f.label })) },
    { title: "审批数据", items: approvals },
  ]
  if (calcVars.length > 0) {
    groups.push({ title: "计算变量", items: calcVars.map((c) => ({ expr: c.key, label: c.label })) })
  }
  return groups
}
