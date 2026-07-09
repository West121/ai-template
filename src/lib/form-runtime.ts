/**
 * 表单运行时引擎（无 UI 依赖）：被 FormRenderer 与设计器预览共用。
 * 负责：选项归一化、字段扁平化、条件求值（联动）、校验规则求值、脚本钩子执行。
 *
 * 两条求值路径，信任级别不同（见 docs/design/next-gen-workflow-and-formula.md 第三部分）：
 *  - **Tier 1 公式（安全）**：自定义校验规则 `custom.expr` 走 `formula-eval.ts` 的安全 AST
 *    解释器（`evaluate`），**不使用 `new Function`/`eval`**，够不到 window/fetch/原型链。
 *  - **Tier 2 脚本（受信）**：`runScript` 是表单事件钩子（onLoad/onChange/onSubmit），仍以
 *    `new Function` 在浏览器内执行——它以**当前页面的完整权限**运行（能读 window/fetch/DOM/token）。
 *    这不是沙箱，也不假装是：脚本是「定义态受信工件」，仅平台管理员可写、随定义版本化审核
 *    （治理见设计文档 3.3）。此前「绝不暴露 window/fetch/DOM」的注释是安全谎言（F-01），已删除。
 */
import type {
  ConditionGroup,
  DataSource,
  FormCondition,
  FormWidget,
  ValidationRule,
  WidgetOption,
} from "@/types/workflow"
import { evaluate } from "@/lib/formula-eval"

/* ---------------- 常量：类型集合 ---------------- */

export const LAYOUT_TYPES = ["divider", "note", "html"] as const
export const CONTAINER_TYPES = ["grid", "group", "tabs", "collapse"] as const
export const OPTION_TYPES = ["radio", "checkbox", "select"] as const

export const isLayout = (t: string) => (LAYOUT_TYPES as readonly string[]).includes(t)
export const isContainer = (t: string) => (CONTAINER_TYPES as readonly string[]).includes(t)
export const isSubform = (t: string) => t === "subform"
export const hasOptions = (t: string) => (OPTION_TYPES as readonly string[]).includes(t)

/** 金额同数字：内部用字符串承载、提交转 number */
export const isNumericType = (t: string) => t === "number" || t === "amount"

/** 渲染器原生支持的数据控件类型（叶子）；其余走占位 */
export const KNOWN_LEAF_TYPES = [
  "input",
  "textarea",
  "number",
  "radio",
  "checkbox",
  "select",
  "date",
  "user",
  "rating",
  "switch",
  // 第二波
  "upload",
  "image",
  "richtext",
  "amount",
  "address",
  "cascade",
  "relation",
  "signature",
] as const
export const isKnownLeaf = (t: string) => (KNOWN_LEAF_TYPES as readonly string[]).includes(t)

/** 数据控件（会产生 formData 键）：非布局、非纯容器 */
export const isDataWidget = (w: FormWidget) => !isLayout(w.type) && !isContainer(w.type)

/** widget 在 formData 中的键：稳定 key 优先，回退 id */
export const keyOf = (w: FormWidget) => (w.key && w.key.trim()) || w.id

/* ---------------- 选项归一化 ---------------- */

export function normalizeOptions(
  options?: (string | { label: string; value: string })[],
): WidgetOption[] {
  if (!Array.isArray(options)) return []
  return options.map((o) => (typeof o === "string" ? { label: o, value: o } : o))
}

/* ---------------- 扁平化：递归收集所有数据控件（容器透明，subform 视为叶子） ---------------- */

export function collectDataWidgets(widgets: FormWidget[]): FormWidget[] {
  const out: FormWidget[] = []
  const walk = (list: FormWidget[]) => {
    for (const w of list) {
      if (isContainer(w.type)) {
        if (Array.isArray(w.children)) walk(w.children)
      } else if (isSubform(w.type)) {
        out.push(w) // subform 本身是一个数组型数据字段，其 children 是列定义不在顶层
      } else if (isDataWidget(w)) {
        out.push(w)
      }
    }
  }
  walk(widgets)
  return out
}

/* ---------------- 默认值 ---------------- */

export function widgetDefault(w: FormWidget): unknown {
  if (w.defaultValue !== undefined && w.defaultValue !== null) return w.defaultValue
  if (isSubform(w.type)) return []
  switch (w.type) {
    case "checkbox":
    case "upload":
    case "image":
    case "address":
    case "cascade":
    case "relation":
      return []
    case "rating":
      return 0
    case "switch":
      return false
    default:
      return ""
  }
}

/* ---------------- 条件 / 联动求值 ---------------- */

function isEmpty(v: unknown): boolean {
  if (v == null || v === "") return true
  if (Array.isArray(v)) return v.length === 0
  // relation 单选存 { value, label }：value 空视为空
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return isEmpty((v as Record<string, unknown>).value)
  }
  return false
}

export function evalCondition(cond: FormCondition, data: Record<string, unknown>): boolean {
  const left = data[cond.field]
  const right = cond.value
  switch (cond.operator) {
    case "eq":
      return String(left ?? "") === String(right ?? "")
    case "ne":
      return String(left ?? "") !== String(right ?? "")
    case "gt":
      return Number(left) > Number(right)
    case "gte":
      return Number(left) >= Number(right)
    case "lt":
      return Number(left) < Number(right)
    case "lte":
      return Number(left) <= Number(right)
    case "contains":
      return Array.isArray(left)
        ? left.map(String).includes(String(right))
        : String(left ?? "").includes(String(right ?? ""))
    case "notContains":
      return Array.isArray(left)
        ? !left.map(String).includes(String(right))
        : !String(left ?? "").includes(String(right ?? ""))
    case "empty":
      return isEmpty(left)
    case "notEmpty":
      return !isEmpty(left)
    case "in": {
      const list = Array.isArray(right)
        ? right.map(String)
        : String(right ?? "")
            .split(",")
            .map((s) => s.trim())
      return list.includes(String(left ?? ""))
    }
    default:
      return true
  }
}

export function evalConditionGroup(
  group: ConditionGroup | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!group || !Array.isArray(group.conditions) || group.conditions.length === 0) return true
  const results = group.conditions.map((c) => evalCondition(c, data))
  return group.logic === "OR" ? results.some(Boolean) : results.every(Boolean)
}

/* ---------------- 校验规则 → 错误消息 ---------------- */

export const REGEX_PRESETS: Record<string, { label: string; pattern: string }> = {
  mobile: { label: "手机号", pattern: "^1[3-9]\\d{9}$" },
  email: { label: "邮箱", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
  idcard: { label: "身份证", pattern: "^\\d{15}$|^\\d{17}[\\dXx]$" },
  url: { label: "网址", pattern: "^https?://[^\\s]+$" },
}

/** 对单个字段值按规则求值，返回错误消息（无错误返回 null）。required 单独在渲染器判定（含 requiredWhen）。 */
export function validateValue(
  rules: ValidationRule[] | undefined,
  value: unknown,
  data: Record<string, unknown>,
): string | null {
  if (!Array.isArray(rules)) return null
  const empty = isEmpty(value)
  for (const rule of rules) {
    switch (rule.type) {
      case "required":
        if (empty) return rule.message || "此项为必填"
        break
      case "regex":
        if (!empty && rule.pattern) {
          try {
            if (!new RegExp(rule.pattern).test(String(value))) return rule.message || "格式不正确"
          } catch {
            /* 无效正则忽略 */
          }
        }
        break
      case "length": {
        if (!empty) {
          const len = Array.isArray(value) ? value.length : String(value).length
          if (rule.min != null && len < rule.min) return rule.message || `长度不能少于 ${rule.min}`
          if (rule.max != null && len > rule.max) return rule.message || `长度不能超过 ${rule.max}`
        }
        break
      }
      case "range": {
        if (!empty) {
          const num = Number(value)
          if (!Number.isNaN(num)) {
            if (rule.min != null && num < rule.min) return rule.message || `不能小于 ${rule.min}`
            if (rule.max != null && num > rule.max) return rule.message || `不能大于 ${rule.max}`
          }
        }
        break
      }
      case "custom": {
        if (rule.expr && rule.expr.trim()) {
          try {
            // Tier 1 安全公式：AST 解释器求值（绝不 new Function）。表达式可引用 value / data.*，
            // 返回假值即校验不通过（与旧 new Function 语义等价，出错则不阻断）。
            if (!evaluate(rule.expr, { value, data })) return rule.message || "校验未通过"
          } catch {
            /* 表达式出错不阻断（与旧行为一致） */
          }
        }
        break
      }
      case "unique":
        // 运行态尽力校验：需要跨行/跨记录上下文，交由 subform 层与后端把关，这里跳过
        break
    }
  }
  return null
}

/** unique 规则（子表单内）：给定同列所有值与当前值，判断是否重复 */
export function checkUnique(values: unknown[], index: number): boolean {
  const cur = values[index]
  if (isEmpty(cur)) return true
  return values.every((v, i) => i === index || String(v ?? "") !== String(cur ?? ""))
}

/* ---------------- Tier 2 受信脚本钩子（非沙箱，完整页面权限） ---------------- */

export interface ScriptCtx {
  data: Record<string, unknown>
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  setValue: (key: string, value: unknown) => void
  setVisible: (key: string, visible: boolean) => void
  setRequired: (key: string, required: boolean) => void
  setReadonly: (key: string, readonly: boolean) => void
  setOptions: (key: string, options: WidgetOption[] | string[]) => void
  field?: { key: string; value: unknown }
  variables: Record<string, unknown>
  utils: ScriptUtils
}

export interface ScriptUtils {
  sum: (arr: unknown[]) => number
  round: (n: number, digits?: number) => number
  formatDate: (d: unknown, sep?: string) => string
  now: () => string
  isEmpty: (v: unknown) => boolean
}

export const scriptUtils: ScriptUtils = {
  sum: (arr) => (Array.isArray(arr) ? arr.reduce<number>((s, v) => s + (Number(v) || 0), 0) : 0),
  round: (n, digits = 2) => {
    const f = 10 ** digits
    return Math.round((Number(n) || 0) * f) / f
  },
  formatDate: (d, sep = "-") => {
    const date = d instanceof Date ? d : new Date(String(d))
    if (Number.isNaN(date.getTime())) return ""
    const p = (x: number) => String(x).padStart(2, "0")
    return `${date.getFullYear()}${sep}${p(date.getMonth() + 1)}${sep}${p(date.getDate())}`
  },
  now: () => new Date().toISOString().slice(0, 10),
  isEmpty,
}

/**
 * 执行 Tier 2 表单事件脚本：`new Function` 注入 ctx 后在浏览器内执行，try-catch 兜错。
 * 返回脚本 return 值（onSubmit 返回 false 可拦截提交）。
 *
 * **安全边界（诚实声明，F-01）**：这不是沙箱。脚本以当前页面的完整权限运行——`new Function`
 * 只注入了 ctx，但函数体仍可自由访问 window / fetch / document / localStorage（含登录 token）。
 * 因此脚本是「定义态受信工件」：仅平台管理员可写、随表单定义版本化与审核，禁止最终用户运行时
 * 注入。需要安全、无副作用、高频求值的场景请改用 Tier 1 公式（`formula-eval.ts`）。
 */
export function runScript(source: string | undefined, ctx: ScriptCtx): unknown {
  if (!source || !source.trim()) return undefined
  try {
    const fn = new Function(
      "ctx",
      `"use strict";
const {data,get,set,setValue,setVisible,setRequired,setReadonly,setOptions,field,variables,utils}=ctx;
${source}`,
    )
    return fn(ctx)
  } catch (err) {
    console.warn("[form-script] 脚本执行出错：", err)
    return undefined
  }
}

/* ---------------- 金额：千分位 + 人民币大写 ---------------- */

/** 千分位格式化（保留 digits 位小数；空/非数字返回原样） */
export function formatThousands(value: unknown, digits = 2): string {
  if (value === "" || value == null) return ""
  const num = Number(value)
  if (Number.isNaN(num)) return String(value)
  return num.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** 人民币金额转中文大写（支持元/角/分，最大到万亿级） */
export function toChineseAmount(value: unknown): string {
  const num = Number(value)
  if (Number.isNaN(num)) return ""
  if (num === 0) return "零元整"
  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
  const intUnits = ["", "拾", "佰", "仟"]
  const bigUnits = ["", "万", "亿", "兆"]
  const negative = num < 0
  const abs = Math.abs(num)
  const fixed = abs.toFixed(2)
  const [intPart, decPart] = fixed.split(".")

  let intStr = ""
  if (intPart === "0") {
    intStr = ""
  } else {
    const groups: string[] = []
    let rest = intPart
    while (rest.length > 0) {
      groups.unshift(rest.slice(-4))
      rest = rest.slice(0, -4)
    }
    groups.forEach((group, gi) => {
      const bigUnit = bigUnits[groups.length - 1 - gi]
      let groupStr = ""
      const len = group.length
      let zeroFlag = false
      for (let i = 0; i < len; i++) {
        const d = Number(group[i])
        const unit = intUnits[len - 1 - i]
        if (d === 0) {
          zeroFlag = true
        } else {
          if (zeroFlag) groupStr += digits[0]
          zeroFlag = false
          groupStr += digits[d] + unit
        }
      }
      if (groupStr) intStr += groupStr + bigUnit
    })
    intStr += "元"
  }

  const jiao = Number(decPart[0])
  const fen = Number(decPart[1])
  let decStr = ""
  if (jiao === 0 && fen === 0) {
    decStr = intStr ? "整" : ""
  } else {
    if (jiao > 0) decStr += digits[jiao] + "角"
    else if (intStr) decStr += digits[0]
    if (fen > 0) decStr += digits[fen] + "分"
  }
  if (!intStr && !decStr) return "零元整"
  return (negative ? "负" : "") + (intStr || "") + decStr
}

/* ---------------- 行政区（简化三级，内置数据）---------------- */

/** 简化行政区数据（省 → 市 → 区，覆盖主要直辖市与省份，用于 address 控件与 cascade 预设） */
export const CN_REGIONS: { label: string; value: string; children: { label: string; value: string; children: { label: string; value: string }[] }[] }[] = [
  {
    label: "北京市", value: "110000", children: [
      { label: "市辖区", value: "110100", children: [
        { label: "东城区", value: "110101" }, { label: "西城区", value: "110102" },
        { label: "朝阳区", value: "110105" }, { label: "海淀区", value: "110108" },
        { label: "丰台区", value: "110106" }, { label: "昌平区", value: "110114" },
      ] },
    ],
  },
  {
    label: "上海市", value: "310000", children: [
      { label: "市辖区", value: "310100", children: [
        { label: "黄浦区", value: "310101" }, { label: "徐汇区", value: "310104" },
        { label: "静安区", value: "310106" }, { label: "浦东新区", value: "310115" },
        { label: "闵行区", value: "310112" }, { label: "杨浦区", value: "310110" },
      ] },
    ],
  },
  {
    label: "广东省", value: "440000", children: [
      { label: "广州市", value: "440100", children: [
        { label: "天河区", value: "440106" }, { label: "越秀区", value: "440104" },
        { label: "海珠区", value: "440105" }, { label: "番禺区", value: "440113" },
      ] },
      { label: "深圳市", value: "440300", children: [
        { label: "南山区", value: "440305" }, { label: "福田区", value: "440304" },
        { label: "罗湖区", value: "440303" }, { label: "宝安区", value: "440306" },
        { label: "龙岗区", value: "440307" },
      ] },
      { label: "东莞市", value: "441900", children: [{ label: "莞城街道", value: "441901" }] },
    ],
  },
  {
    label: "浙江省", value: "330000", children: [
      { label: "杭州市", value: "330100", children: [
        { label: "西湖区", value: "330106" }, { label: "余杭区", value: "330110" },
        { label: "滨江区", value: "330108" }, { label: "上城区", value: "330102" },
      ] },
      { label: "宁波市", value: "330200", children: [
        { label: "海曙区", value: "330203" }, { label: "鄞州区", value: "330212" },
      ] },
    ],
  },
  {
    label: "江苏省", value: "320000", children: [
      { label: "南京市", value: "320100", children: [
        { label: "玄武区", value: "320102" }, { label: "鼓楼区", value: "320106" },
        { label: "江宁区", value: "320115" },
      ] },
      { label: "苏州市", value: "320500", children: [
        { label: "姑苏区", value: "320508" }, { label: "工业园区", value: "320571" },
      ] },
    ],
  },
  {
    label: "四川省", value: "510000", children: [
      { label: "成都市", value: "510100", children: [
        { label: "锦江区", value: "510104" }, { label: "武侯区", value: "510107" },
        { label: "高新区", value: "510191" },
      ] },
    ],
  },
]

/** 把简化行政区数据转成通用级联树 */
export function regionTree(): { label: string; value: string; children?: unknown[] }[] {
  return CN_REGIONS
}

/* ---------------- 数据源摘要（设计器展示用） ---------------- */

export function dataSourceLabel(ds: DataSource | undefined): string {
  if (!ds || ds.type === "static") return "静态选项"
  switch (ds.type) {
    case "dict":
      return `字典：${ds.dictCode || "?"}`
    case "form":
      return `关联表单：${ds.defCode || "?"}`
    case "api":
      return `接口：${ds.url || "?"}`
    case "cascade":
      return "级联"
    default:
      return "静态选项"
  }
}
