/**
 * 表单设计器 widget 模型（从 demo/form-designer 抽出的可复用核心）。
 *
 * schemaJson.widgets 即该结构的数组：动态表单渲染器（FormRenderer）与 JSON→BPMN 转换器
 * 均按此模型消费。v2 增强：容器控件（grid/group/tabs/collapse）、子表单（subform）、
 * 联动 visibleWhen/requiredWhen、可配校验 validation、数据源 dataSource、事件脚本 events。
 * 增强字段均为可选，旧 schema 不含即回退旧行为；本模型结构上可赋值给运行时 FormWidget。
 */
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronsDownUp,
  CircleDollarSign,
  CircleDot,
  Code2,
  Hash,
  Image,
  LayoutGrid,
  Link2,
  ListTree,
  MapPin,
  Minus,
  PanelsTopLeft,
  PenLine,
  SquareStack,
  Star,
  Table2,
  Text,
  TextCursorInput,
  TextQuote,
  ToggleLeft,
  Type,
  UploadCloud,
  UserRound,
} from "lucide-react"
import type {
  ConditionGroup,
  DataSource,
  ValidationRule,
  WidgetEvents,
} from "@/types/workflow"

export type WidgetType =
  | "input"
  | "textarea"
  | "number"
  | "radio"
  | "checkbox"
  | "select"
  | "date"
  | "user"
  | "rating"
  | "switch"
  | "divider"
  | "note"
  // v2 容器 / 子表单
  | "grid"
  | "group"
  | "tabs"
  | "collapse"
  | "subform"
  // v2 第二波数据 / 布局控件
  | "upload"
  | "image"
  | "richtext"
  | "amount"
  | "address"
  | "cascade"
  | "relation"
  | "signature"
  | "html"

export interface FormWidget {
  id: string
  type: WidgetType
  label: string
  placeholder: string
  required: boolean
  description: string
  /** 占整行还是半行（两列栅格）；{span} 为 24 栅格跨列（grid 容器子控件用） */
  width: "full" | "half" | { span: number }
  /** radio / checkbox / select 的选项 */
  options: string[]
  /** divider / note 的文案 */
  content: string
  /** 稳定字段标识：流程条件、审批人规则、表单数据以此为键；缺省等于 id */
  key?: string
  /* ---- v2 增强（可选） ---- */
  defaultValue?: unknown
  readonly?: boolean
  hidden?: boolean
  validation?: ValidationRule[]
  dataSource?: DataSource
  visibleWhen?: ConditionGroup
  requiredWhen?: ConditionGroup
  /** 容器子控件 / subform 列定义 */
  children?: FormWidget[]
  /** 控件专属属性（容器 columns/tabs/panels、number precision、date mode 等） */
  props?: Record<string, unknown>
  events?: WidgetEvents
}

/** 取字段的稳定 key（缺省回落到 id） */
export const widgetKeyOf = (widget: FormWidget) => widget.key?.trim() || widget.id

export type WidgetCategory = "基础字段" | "选择字段" | "增强字段" | "高级字段" | "布局" | "容器"

export const WIDGET_META: Record<
  WidgetType,
  { label: string; icon: typeof Type; category: WidgetCategory }
> = {
  input: { label: "单行文本", icon: TextCursorInput, category: "基础字段" },
  textarea: { label: "多行文本", icon: Text, category: "基础字段" },
  number: { label: "数字", icon: Hash, category: "基础字段" },
  amount: { label: "金额", icon: CircleDollarSign, category: "基础字段" },
  date: { label: "日期", icon: Calendar, category: "基础字段" },
  radio: { label: "单选", icon: CircleDot, category: "选择字段" },
  checkbox: { label: "多选", icon: CheckSquare, category: "选择字段" },
  select: { label: "下拉选择", icon: ChevronDown, category: "选择字段" },
  cascade: { label: "级联选择", icon: ListTree, category: "选择字段" },
  address: { label: "省市区", icon: MapPin, category: "选择字段" },
  user: { label: "成员", icon: UserRound, category: "增强字段" },
  rating: { label: "评分", icon: Star, category: "增强字段" },
  switch: { label: "开关", icon: ToggleLeft, category: "增强字段" },
  upload: { label: "附件上传", icon: UploadCloud, category: "高级字段" },
  image: { label: "图片", icon: Image, category: "高级字段" },
  richtext: { label: "富文本", icon: TextQuote, category: "高级字段" },
  relation: { label: "关联表单", icon: Link2, category: "高级字段" },
  signature: { label: "手写签名", icon: PenLine, category: "高级字段" },
  divider: { label: "分割线", icon: Minus, category: "布局" },
  note: { label: "说明文字", icon: Type, category: "布局" },
  html: { label: "HTML", icon: Code2, category: "布局" },
  grid: { label: "栅格", icon: LayoutGrid, category: "容器" },
  group: { label: "分组卡片", icon: SquareStack, category: "容器" },
  tabs: { label: "标签页", icon: PanelsTopLeft, category: "容器" },
  collapse: { label: "折叠面板", icon: ChevronsDownUp, category: "容器" },
  subform: { label: "子表单", icon: Table2, category: "容器" },
}

export const WIDGET_CATEGORIES = ["基础字段", "选择字段", "增强字段", "高级字段", "布局", "容器"] as const

/** 容器类控件（可容纳子控件） */
export const CONTAINER_TYPES: WidgetType[] = ["grid", "group", "tabs", "collapse"]
export const isContainerType = (t: WidgetType) => CONTAINER_TYPES.includes(t)
export const isSubformType = (t: WidgetType) => t === "subform"
export const isLayoutType = (t: WidgetType) => t === "divider" || t === "note" || t === "html"

export const FORM_USERS = ["赵天宇", "王小磊", "李思雨", "刘志强", "黄丽娟", "朱国栋", "杨慧敏", "谭凯文"]

let uid = 0
export const newWidgetId = () => `w${++uid}`

/** 载入既有 schema 后调用：把 id 计数器抬到已用序号之后（含容器子控件），避免新增字段 id 冲突 */
export function ensureWidgetIdSeq(widgets: FormWidget[]) {
  // 第一遍：扫描已有 wN 序号，抬高计数器避免新增冲突
  const scan = (list: FormWidget[]) => {
    for (const w of list) {
      const match = /^w(\d+)$/.exec(w.id ?? "")
      if (match) uid = Math.max(uid, Number(match[1]))
      if (Array.isArray(w.children)) scan(w.children)
    }
  }
  scan(widgets)
  // 第二遍：给缺失/非法 id 的控件补唯一 id（种子表单、旧 schema、导入的 JSON 常只有 key 没 id，
  // 不补会导致设计器按 id 选中时全部命中、属性面板取不到唯一目标）
  const fill = (list: FormWidget[]) => {
    for (const w of list) {
      if (!w.id || !/^w\d+$/.test(w.id)) w.id = newWidgetId()
      if (Array.isArray(w.children)) fill(w.children)
    }
  }
  fill(widgets)
}

export function createWidget(type: WidgetType): FormWidget {
  const meta = WIDGET_META[type]
  const hasOptions = type === "radio" || type === "checkbox" || type === "select"
  const base: FormWidget = {
    id: newWidgetId(),
    type,
    label: meta.label,
    placeholder:
      type === "input" || type === "textarea" || type === "number" || type === "amount"
        ? `请输入${meta.label}`
        : type === "select" || type === "date" || type === "user" || type === "cascade" || type === "relation"
          ? `请选择${meta.label}`
          : "",
    required: false,
    description: "",
    width: "full",
    options: hasOptions ? ["选项 1", "选项 2", "选项 3"] : [],
    content:
      type === "note"
        ? "这里是说明文字，可在右侧属性面板编辑。"
        : type === "divider"
          ? "分割线"
          : type === "html"
            ? "<p>自定义 <strong>HTML</strong> 内容，可在右侧属性面板编辑。</p>"
            : "",
  }

  switch (type) {
    case "amount":
      base.props = { prefix: "￥" }
      break
    case "upload":
      base.props = { multiple: true }
      break
    case "image":
      base.props = { multiple: true }
      break
    case "relation":
      base.dataSource = { type: "form", defCode: "", labelField: "name", valueField: "id" }
      base.props = { multiple: false }
      break
    case "cascade":
      base.dataSource = { type: "cascade", preset: "region" }
      break
    case "grid":
      base.label = "栅格"
      base.children = []
      base.props = { columns: 2 }
      break
    case "group":
      base.label = "分组"
      base.children = []
      base.props = { title: "分组标题" }
      break
    case "tabs":
      base.label = "标签页"
      base.children = []
      base.props = { tabs: [{ key: "tab1", label: "标签一" }, { key: "tab2", label: "标签二" }] }
      break
    case "collapse":
      base.label = "折叠面板"
      base.children = []
      base.props = { panels: [{ key: "p1", title: "面板一", defaultOpen: true }, { key: "p2", title: "面板二" }] }
      break
    case "subform":
      base.label = "明细表"
      base.props = { mode: "table" }
      base.children = [
        { ...createWidget("input"), label: "名称" },
        { ...createWidget("number"), label: "数量" },
      ]
      break
  }
  return base
}
