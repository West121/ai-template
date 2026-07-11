/**
 * BizDoc 套打模板 JSON 契约（bizdoc-design.md §4 + §8 裁定的 style 扩展）与渲染映射纯函数。
 *
 * 坐标口径（§8）：元素 x/y/w/h 相对**纸张原点**（mm），margin 仅画参考线不参与坐标。
 * 本文件纯逻辑（无 React），供 paper-renderer / 设计器（批B）/ 单测共用。
 */

/* ============================ 模板契约 ============================ */

export type BdPaper = "A4" | "A5"

/** §8 裁定的 style 扩展全部可选、带缺省，schemaVersion 仍为 1 */
export interface BdStyle {
  /** pt，缺省 10.5（五号） */
  fontSize?: number
  bold?: boolean
  align?: "left" | "center" | "right"
  /** line/rect：线宽 pt，缺省 0.75 */
  lineWidth?: number
  /** line/rect：实/虚线 */
  lineStyle?: "solid" | "dashed"
  /** image 适应方式 */
  imageFit?: "contain" | "cover" | "fill"
  /** qrcode 纠错级别，缺省 M */
  qrEcLevel?: "L" | "M" | "Q" | "H"
  /** 字体族（宋体/黑体/仿宋/楷体，回退链同公文口径） */
  fontFamily?: "song" | "hei" | "fangsong" | "kai"
  /** table：表头加粗 */
  headerBold?: boolean
  /** table：行高 mm，缺省 7 */
  rowHeight?: number
}

interface BdElementBase {
  id: string
  x: number
  y: number
  w: number
  h: number
  style?: BdStyle
}

export interface BdLabelEl extends BdElementBase {
  type: "label"
  text: string
}

export interface BdFieldEl extends BdElementBase {
  type: "field"
  /** 表单字段 key */
  field: string
  /** 前缀文案（如"请假类型："），可选 */
  label?: string
}

/** 系统字段：单号/标题/创建人/部门/日期 */
export type BdSysFieldKey = "docNo" | "title" | "creator" | "dept" | "date"

export interface BdSysFieldEl extends BdElementBase {
  type: "sysfield"
  field: BdSysFieldKey
  label?: string
}

export interface BdTableEl extends BdElementBase {
  type: "table"
  /** 子表字段 key（值为行数组） */
  field: string
  columns: { field: string; label: string; w: number }[]
}

export interface BdLineEl extends BdElementBase {
  type: "line"
}

export interface BdRectEl extends BdElementBase {
  type: "rect"
}

export interface BdImageEl extends BdElementBase {
  type: "image"
  /** dataURL 或 fileId */
  src?: string
}

export interface BdQrcodeEl extends BdElementBase {
  type: "qrcode"
  /** 支持 {{docNo}} 等插值 */
  value: string
}

export type BdElement =
  | BdLabelEl
  | BdFieldEl
  | BdSysFieldEl
  | BdTableEl
  | BdLineEl
  | BdRectEl
  | BdImageEl
  | BdQrcodeEl

export interface BdTemplate {
  schemaVersion: 1
  paper: BdPaper
  landscape: boolean
  /** [上,右,下,左] mm，仅参考线 */
  margin: [number, number, number, number]
  elements: BdElement[]
}

/** 空模板（新建用） */
export function emptyTemplate(paper: BdPaper = "A4"): BdTemplate {
  return { schemaVersion: 1, paper, landscape: false, margin: [10, 10, 10, 10], elements: [] }
}

/** 解析存储的 content JSON（字符串或对象）；非法回 null */
export function parseTemplate(raw: unknown): BdTemplate | null {
  if (raw == null) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && typeof obj === "object" && Array.isArray((obj as { elements?: unknown }).elements)) {
      return obj as BdTemplate
    }
    return null
  } catch {
    return null
  }
}

/* ============================ 纸张几何 ============================ */

const PAPER_MM: Record<BdPaper, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
}

/** 纸张尺寸（mm），横向交换宽高 */
export function paperSize(paper: BdPaper, landscape: boolean): { w: number; h: number } {
  const p = PAPER_MM[paper]
  return landscape ? { w: p.h, h: p.w } : p
}

/* ============================ 渲染映射（数据 → 文本） ============================ */

/** 打印上下文：表单数据 + 系统字段值 + 字段 label 映射（失效判定用） */
export interface BdRenderCtx {
  /** form_data + 系统字段（docNo/title/creator/dept/date 由后端一并给） */
  data: Record<string, unknown>
  /** 字段 key → label（字段清单；不在其中的 field 绑定视为失效） */
  fields: Record<string, string>
}

/** 值格式化：空 → ""；数组顿号连；对象取 name/label；布尔 是/否 */
export function formatValue(v: unknown): string {
  if (v == null || v === "") return ""
  if (Array.isArray(v)) return v.map(formatValue).join("、")
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    if (typeof o.name === "string") return o.name
    if (typeof o.label === "string") return o.label
    return JSON.stringify(v)
  }
  if (typeof v === "boolean") return v ? "是" : "否"
  return String(v)
}

/** `{{key}}` 插值（qrcode value 等）：上下文缺键输出空串 */
export function interpolate(tpl: string, data: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => formatValue(data[key]))
}

/**
 * field/sysfield 的呈现文本 = 前缀 label + 值。
 * 字段失效（不在 fields 清单且数据里也没有）→ 值输出空（丹青 §4.5 兜底口径）。
 */
export function fieldText(el: BdFieldEl | BdSysFieldEl, ctx: BdRenderCtx): { prefix: string; value: string; stale: boolean } {
  const known = el.field in ctx.fields || el.field in ctx.data
  const value = formatValue(ctx.data[el.field])
  return { prefix: el.label ?? "", value, stale: !known }
}

/** 模板内失效绑定的元素 id（预览黄条提示用） */
export function staleElementIds(tpl: BdTemplate, ctx: BdRenderCtx): string[] {
  const ids: string[] = []
  for (const el of tpl.elements) {
    if ((el.type === "field" || el.type === "table") && !(el.field in ctx.fields) && !(el.field in ctx.data)) {
      ids.push(el.id)
    }
  }
  return ids
}

/** 字体族回退链（同公文 gongwen-format-spec 口径） */
export const BD_FONTS: Record<NonNullable<BdStyle["fontFamily"]>, string> = {
  song: '"SimSun","宋体","STSong",serif',
  hei: '"SimHei","黑体","Microsoft YaHei",sans-serif',
  fangsong: '"FangSong","仿宋","仿宋_GB2312","STFangsong",serif',
  kai: '"KaiTi","楷体","STKaiti",serif',
}

/** 元素文本样式 → 内联 CSS（mm/pt 物理单位，进 .bd-paper 恒白语境） */
export function textStyleOf(style: BdStyle | undefined): {
  fontSize: string
  fontWeight: number
  textAlign: "left" | "center" | "right"
  fontFamily: string
} {
  return {
    fontSize: `${style?.fontSize ?? 10.5}pt`,
    fontWeight: style?.bold ? 700 : 400,
    textAlign: style?.align ?? "left",
    fontFamily: BD_FONTS[style?.fontFamily ?? "song"],
  }
}
