/**
 * BizDoc 模板 JSON v2（bizdoc-design.md §9.1：文档流式块级契约，替代 §4 自由定位）。
 *
 * 块从上到下堆叠、自动高度、天然分页；插值统一 `{{expr}}`（表单字段 / 系统字段 /
 * 审批数据 `_approvals[i].{nodeName,assigneeName,opinion,time}`，路径点分）。
 * v1（自由定位）保留兼容读取（schemaVersion 判别），新建默认 v2。
 * 本文件纯逻辑（无 React），供 paper-renderer / 套打设计器 / 单测共用。
 */
import { getByPath, interpolate, type BdRenderCtx, type BdTemplate } from "./model"
import { evaluate, validate as validateFormula } from "@/lib/formula-eval"

/* ============================ 页面设置 ============================ */

export type BdPageSize = "A4" | "A5" | "Letter"

export interface BdPageNumber {
  show: boolean
  position: "footer" | "header"
  align: "left" | "center" | "right"
  /** `{page}` / `{total}` 占位 */
  format: string
  /** pt */
  fontSize: number
  /** CSS 颜色；缺省 muted 灰 #9ca3af */
  color?: string
}

export type BdFontName = "宋体" | "黑体" | "仿宋" | "楷体"

/** 文档页眉/页脚（单行富内容：文本 + `{{token}}` + 对齐；每页固定，打印走 @page margin box） */
export interface BdPageBand {
  text: string
  align: "left" | "center" | "right"
  /** pt，缺省 9 */
  fontSize: number
}

export interface BdPageV2 {
  size: BdPageSize
  landscape: boolean
  /** [上,右,下,左] mm（v2 参与排版：即纸面内边距 / @page margin） */
  margin: [number, number, number, number]
  fontFamily: BdFontName
  pageNumber: BdPageNumber
  /** 文档页眉（每页顶部固定） */
  header?: BdPageBand | null
  /** 文档页脚（每页底部固定；与页码同在页脚时按对齐槽并排） */
  footer?: BdPageBand | null
}

/** 页码缺省色（muted 灰） */
export const PAGENO_DEFAULT_COLOR = "#9ca3af"

/** 新页眉/页脚缺省值 */
export function newPageBand(which: "header" | "footer"): BdPageBand {
  return { text: which === "header" ? "文档页眉" : "文档页脚", align: "center", fontSize: 9 }
}

/* ============================ 块契约 ============================ */

export interface BdBlockStyle {
  /** pt */
  fontSize?: number
  bold?: boolean
  align?: "left" | "center" | "right"
  /** infoTable/labelField：标签列宽 mm */
  labelWidth?: number
}

interface BdBlockBase {
  id: string
  style?: BdBlockStyle
}

export interface BdTitleBlock extends BdBlockBase {
  type: "title"
  text: string
}

/** 右对齐信息行（单据编号 / 日期…） */
export interface BdDocInfoBlock extends BdBlockBase {
  type: "docInfo"
  items: { label: string; value: string }[]
}

/** 智能表格：label/value 网格 */
export interface BdInfoTableBlock extends BdBlockBase {
  type: "infoTable"
  columnsPerRow: number
  cells: { label: string; value: string; /** 跨几组（label+value），缺省 1 */ span?: number }[]
}

/** 单行标签字段 */
export interface BdLabelFieldBlock extends BdBlockBase {
  type: "labelField"
  label: string
  value: string
}

/** 智能文本（插值段落） */
export interface BdTextBlock extends BdBlockBase {
  type: "text"
  content: string
}

/** 明细表格（子表循环） */
export interface BdDetailTableBlock extends BdBlockBase {
  type: "detailTable"
  /** 子表字段 key（值为行数组） */
  field: string
  columns: { field: string; label: string; /** mm；缺省均分 */ w?: number }[]
  /** 显示序号列 */
  showIndex?: boolean
}

/** 审批区（数据来自 _approvals，见 §9.3） */
export interface BdApprovalTableBlock extends BdBlockBase {
  type: "approvalTable"
  steps: { label: string; value: string }[]
}

/** 行容器分栏：各栏是 blocks 子数组 */
export interface BdRowBlock extends BdBlockBase {
  type: "row"
  children: BdBlock[][]
}

/** 签章占位框 */
export interface BdSignatureBlock extends BdBlockBase {
  type: "signature"
  label: string
  align: "left" | "center" | "right"
}

export interface BdQrcodeBlockV2 extends BdBlockBase {
  type: "qrcode"
  value: string
  /** 边长 mm */
  size: number
  align: "left" | "center" | "right"
}

/** 条形码：P1 后补（契约占位，渲染器出占位框、打印不出） */
export interface BdBarcodeBlock extends BdBlockBase {
  type: "barcode"
  value: string
  align: "left" | "center" | "right"
}

export interface BdImageBlockV2 extends BdBlockBase {
  type: "image"
  /** dataURL 或 fileId（设计器上传即嵌 dataURL） */
  src?: string
  /** 宽 mm（高按比例） */
  w: number
  align: "left" | "center" | "right"
}

export interface BdDividerBlock extends BdBlockBase {
  type: "divider"
}

export interface BdSpacerBlock extends BdBlockBase {
  type: "spacer"
  /** mm */
  h: number
}

export type BdBlock =
  | BdTitleBlock
  | BdDocInfoBlock
  | BdInfoTableBlock
  | BdLabelFieldBlock
  | BdTextBlock
  | BdDetailTableBlock
  | BdApprovalTableBlock
  | BdRowBlock
  | BdSignatureBlock
  | BdQrcodeBlockV2
  | BdBarcodeBlock
  | BdImageBlockV2
  | BdDividerBlock
  | BdSpacerBlock

export type BdBlockType = BdBlock["type"]

/* ============================ 计算配置（§12） ============================ */

export type CalcFn = "SUM" | "AVG" | "MAX" | "MIN" | "COUNT"
export type CalcFormat = "number" | "chinese"

/** 聚合字段：对子表列聚合，产出命名变量 */
export interface BdCalcAggregate {
  name: string
  label: string
  /** 子表字段 key（数据里为行数组） */
  source: string
  /** 聚合列（COUNT 可空 = 数行数） */
  field: string
  fn: CalcFn
  format: CalcFormat
  /** 小数位（number 格式） */
  scale: number
}

/** 计算字段：Aviator 表达式（可引表单字段与聚合结果；求值权威在后端） */
export interface BdCalcComputed {
  name: string
  label: string
  expr: string
  format: CalcFormat
  scale: number
}

export interface BdCalc {
  aggregates: BdCalcAggregate[]
  computed: BdCalcComputed[]
}

export interface BdTemplateV2 {
  schemaVersion: 2
  page: BdPageV2
  blocks: BdBlock[]
  /** §12 计算配置（存在即启用；求值顺序 aggregates → computed，失败置 "-" 不阻断打印） */
  calc?: BdCalc
}

/** v1 / v2 联合（打印/预览两版都要认） */
export type AnyBdTemplate = BdTemplate | BdTemplateV2

export function isV2(tpl: AnyBdTemplate): tpl is BdTemplateV2 {
  return tpl.schemaVersion === 2
}

/* ============================ 工厂 / 解析 ============================ */

let seq = 0
export function blockId(): string {
  seq += 1
  return `b${Date.now().toString(36)}${seq.toString(36)}`
}

export function emptyTemplateV2(size: BdPageSize = "A4"): BdTemplateV2 {
  return {
    schemaVersion: 2,
    page: {
      size,
      landscape: false,
      margin: [20, 20, 20, 20],
      fontFamily: "宋体",
      pageNumber: { show: true, position: "footer", align: "center", format: "第 {page} 页 / 共 {total} 页", fontSize: 10 },
    },
    blocks: [],
  }
}

/** 新块缺省值（元素库拖入用） */
export function newBlock(type: BdBlockType): BdBlock {
  const id = blockId()
  switch (type) {
    case "title":
      return { id, type, text: "单据标题", style: { fontSize: 18, bold: true, align: "center" } }
    case "docInfo":
      return { id, type, items: [{ label: "单据编号", value: "{{docNo}}" }, { label: "日期", value: "{{createdAt}}" }] }
    case "infoTable":
      return {
        id,
        type,
        columnsPerRow: 2,
        cells: [
          { label: "字段一", value: "" },
          { label: "字段二", value: "" },
        ],
        style: { fontSize: 10.5, labelWidth: 28 },
      }
    case "labelField":
      return { id, type, label: "标签", value: "", style: { fontSize: 10.5, labelWidth: 28 } }
    case "text":
      return { id, type, content: "双击编辑智能文本，可插入 {{docNo}} 等字段。", style: { fontSize: 10.5 } }
    case "detailTable":
      return { id, type, field: "items", columns: [{ field: "name", label: "事项", w: 60 }, { field: "amount", label: "金额", w: 30 }], showIndex: true, style: { fontSize: 10.5 } }
    case "approvalTable":
      return {
        id,
        type,
        steps: [
          { label: "审批人", value: "{{_approvals.0.assigneeName}}" },
          { label: "办理人", value: "{{_approvals.1.assigneeName}}" },
        ],
        style: { fontSize: 10.5 },
      }
    case "row":
      return { id, type, children: [[], []] }
    case "signature":
      return { id, type, label: "签章", align: "right" }
    case "qrcode":
      return { id, type, value: "{{docNo}}", size: 20, align: "right" }
    case "barcode":
      return { id, type, value: "{{docNo}}", align: "left" }
    case "image":
      return { id, type, w: 30, align: "left" }
    case "divider":
      return { id, type }
    case "spacer":
      return { id, type, h: 6 }
  }
}

/** 解析存储 content（字符串或对象）：v2（blocks）/ v1（elements）都认；非法回 null */
export function parseAnyTemplate(raw: unknown): AnyBdTemplate | null {
  if (raw == null) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!obj || typeof obj !== "object") return null
    const o = obj as { schemaVersion?: unknown; blocks?: unknown; elements?: unknown }
    if (o.schemaVersion === 2 && Array.isArray(o.blocks)) return obj as BdTemplateV2
    if (Array.isArray(o.elements)) return obj as BdTemplate
    return null
  } catch {
    return null
  }
}

/* ============================ 纸张几何 ============================ */

const PAGE_MM: Record<BdPageSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
}

export function pageSizeMm(page: Pick<BdPageV2, "size" | "landscape">): { w: number; h: number } {
  const p = PAGE_MM[page.size] ?? PAGE_MM.A4
  return page.landscape ? { w: p.h, h: p.w } : p
}

/** 页码文案（屏幕预览按单页 1/1 呈现；打印走 @page counter） */
export function formatPageNo(format: string, page: number, total: number): string {
  return format.replace(/\{page\}/g, String(page)).replace(/\{total\}/g, String(total))
}

/* ============================ 块树纯操作（设计器用） ============================ */

/** 深拷贝并重新发号（复制块用；row 递归） */
export function cloneBlock(block: BdBlock): BdBlock {
  const copy = JSON.parse(JSON.stringify(block)) as BdBlock
  const renew = (b: BdBlock) => {
    b.id = blockId()
    if (b.type === "row") b.children.forEach((col) => col.forEach(renew))
  }
  renew(copy)
  return copy
}

/** 块所在位置：根级 → parent=null；行容器内 → parent=rowId + 栏号 */
export interface BlockPath {
  parent: string | null
  col: number
  index: number
}

/** 遍历（含 row 子块），回调返回 false 终止 */
export function walkBlocks(blocks: BdBlock[], fn: (b: BdBlock, path: BlockPath) => void | false): void {
  const visit = (list: BdBlock[], parent: string | null, col: number): boolean => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i]
      if (fn(b, { parent, col, index: i }) === false) return false
      if (b.type === "row") {
        for (let c = 0; c < b.children.length; c++) {
          if (!visit(b.children[c], b.id, c)) return false
        }
      }
    }
    return true
  }
  visit(blocks, null, 0)
}

export function findBlock(blocks: BdBlock[], id: string): { block: BdBlock; path: BlockPath } | null {
  let hit: { block: BdBlock; path: BlockPath } | null = null
  walkBlocks(blocks, (b, path) => {
    if (b.id === id) {
      hit = { block: b, path }
      return false
    }
  })
  return hit
}

/** 取容器数组（parent=null → 根；否则 row 的第 col 栏）；找不到回 null */
function containerOf(blocks: BdBlock[], parent: string | null, col: number): BdBlock[] | null {
  if (parent == null) return blocks
  const row = findBlock(blocks, parent)?.block
  return row && row.type === "row" ? row.children[col] ?? null : null
}

/** 纯函数：删除块（返回新根数组；未找到原样返回） */
export function removeBlock(blocks: BdBlock[], id: string): BdBlock[] {
  const next = JSON.parse(JSON.stringify(blocks)) as BdBlock[]
  const hit = findBlock(next, id)
  if (!hit) return blocks
  const container = containerOf(next, hit.path.parent, hit.path.col)
  container?.splice(hit.path.index, 1)
  return next
}

/** 纯函数：在指定容器 index 处插入块（row 内不允许再嵌 row → 原样返回） */
export function insertBlock(blocks: BdBlock[], block: BdBlock, at: { parent: string | null; col: number; index: number }): BdBlock[] {
  if (at.parent != null && block.type === "row") return blocks
  const next = JSON.parse(JSON.stringify(blocks)) as BdBlock[]
  const container = containerOf(next, at.parent, at.col)
  if (!container) return blocks
  container.splice(Math.max(0, Math.min(at.index, container.length)), 0, block)
  return next
}

/** 纯函数：移动块到目标位置（同容器/跨容器都支持；row 不允许进 row） */
export function moveBlock(blocks: BdBlock[], id: string, to: { parent: string | null; col: number; index: number }): BdBlock[] {
  const src = findBlock(blocks, id)
  if (!src) return blocks
  if (to.parent != null && (src.block.type === "row" || to.parent === id)) return blocks
  const next = JSON.parse(JSON.stringify(blocks)) as BdBlock[]
  const hit = findBlock(next, id)!
  const fromContainer = containerOf(next, hit.path.parent, hit.path.col)
  if (!fromContainer) return blocks
  const [moved] = fromContainer.splice(hit.path.index, 1)
  // 同容器且删除位在目标位之前 → 目标 index 前移
  let index = to.index
  if (hit.path.parent === to.parent && hit.path.col === to.col && hit.path.index < to.index) index -= 1
  const toContainer = containerOf(next, to.parent, to.col)
  if (!toContainer) return blocks
  toContainer.splice(Math.max(0, Math.min(index, toContainer.length)), 0, moved)
  return next
}

/** 纯函数：按 id 打补丁（返回新数组） */
export function patchBlock(blocks: BdBlock[], id: string, patch: Partial<BdBlock>): BdBlock[] {
  const next = JSON.parse(JSON.stringify(blocks)) as BdBlock[]
  const hit = findBlock(next, id)
  if (!hit) return blocks
  Object.assign(hit.block, patch)
  return next
}

/* ============================ 插值 token 收集 / 失效检测 ============================ */

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g

function tokensIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TOKEN_RE)) out.push(m[1])
  return out
}

/** 页眉/页脚在选中态与 token 归属上的哨兵 id */
export const HEADER_ID = "__header__"
export const FOOTER_ID = "__footer__"

/** 收集模板全部插值表达式（含块内所有 value/content/text + 页眉/页脚 band） */
export function collectTokens(tpl: BdTemplateV2): { blockId: string; expr: string }[] {
  const out: { blockId: string; expr: string }[] = []
  if (tpl.page.header) for (const expr of tokensIn(tpl.page.header.text)) out.push({ blockId: HEADER_ID, expr })
  if (tpl.page.footer) for (const expr of tokensIn(tpl.page.footer.text)) out.push({ blockId: FOOTER_ID, expr })
  walkBlocks(tpl.blocks, (b) => {
    const texts: string[] = []
    switch (b.type) {
      case "title":
        texts.push(b.text)
        break
      case "docInfo":
        b.items.forEach((it) => texts.push(it.value))
        break
      case "infoTable":
        b.cells.forEach((c) => texts.push(c.value))
        break
      case "labelField":
        texts.push(b.value)
        break
      case "text":
        texts.push(b.content)
        break
      case "approvalTable":
        b.steps.forEach((s) => texts.push(s.value))
        break
      case "qrcode":
      case "barcode":
        texts.push(b.value)
        break
      default:
        break
    }
    for (const t of texts) for (const expr of tokensIn(t)) out.push({ blockId: b.id, expr })
  })
  return out
}

/** 系统字段（§9.1：docNo/title/creatorName/deptName/createdAt/status） */
export const SYS_KEYS_V2 = ["docNo", "title", "creatorName", "deptName", "createdAt", "status"] as const

/**
 * 失效绑定检测（预览黄条）：token 根键不在字段清单 / 数据 / 系统字段 / _approvals → 失效。
 * detailTable 的 field 也参与检测。
 */
export function staleTokensV2(tpl: BdTemplateV2, ctx: BdRenderCtx): { blockId: string; expr: string }[] {
  const calcNames = new Set([...(tpl.calc?.aggregates ?? []), ...(tpl.calc?.computed ?? [])].map((c) => c.name))
  const known = (root: string) =>
    root === "_approvals" ||
    (SYS_KEYS_V2 as readonly string[]).includes(root) ||
    calcNames.has(root) ||
    root in ctx.fields ||
    root in ctx.data
  const stale = collectTokens(tpl).filter((t) => !known(t.expr.split(".")[0]))
  walkBlocks(tpl.blocks, (b) => {
    if (b.type === "detailTable" && !known(b.field)) stale.push({ blockId: b.id, expr: b.field })
  })
  return stale
}

/* ============================ 预览样例数据（设计器） ============================ */

/** 审批样例（§9.3 _approvals 形状） */
export function sampleApprovals(): Record<string, unknown>[] {
  return [
    { nodeName: "部门审批", assigneeName: "王经理", opinion: "同意。", time: "2026-07-10 10:30" },
    { nodeName: "财务复核", assigneeName: "李会计", opinion: "已复核，金额无误。", time: "2026-07-10 15:20" },
  ]
}

/**
 * 按模板 token + 字段清单生成预览样例数据：
 * 字段 → 「label示例」；系统字段给演示值；detailTable 字段给 2 行样例（列 field 取「label1/2」）。
 */
export function buildSampleData(tpl: BdTemplateV2, fields: Record<string, string>): Record<string, unknown> {
  const data: Record<string, unknown> = {
    docNo: "BX〔2026〕0012",
    title: "示例单据",
    creatorName: "张三",
    deptName: "综合办公室",
    createdAt: "2026-07-10",
    status: "EFFECTIVE",
    _approvals: sampleApprovals(),
  }
  for (const [key, label] of Object.entries(fields)) {
    if (!(key in data)) data[key] = `${label}示例`
  }
  for (const t of collectTokens(tpl)) {
    const root = t.expr.split(".")[0]
    if (!(root in data)) data[root] = `${root}示例`
  }
  walkBlocks(tpl.blocks, (b) => {
    if (b.type === "detailTable") {
      data[b.field] = [1, 2].map((n) => {
        const row: Record<string, unknown> = {}
        for (const c of b.columns) row[c.field] = c.field === "amount" ? n * 100 : `${c.label}${n}`
        return row
      })
    }
  })
  return data
}

/* ============================ 字体映射（v2 存中文名，回退链同公文） ============================ */

export const BD_FONT_STACKS: Record<BdFontName, string> = {
  宋体: '"SimSun","宋体","STSong",serif',
  黑体: '"SimHei","黑体","Microsoft YaHei",sans-serif',
  仿宋: '"FangSong","仿宋","仿宋_GB2312","STFangsong",serif',
  楷体: '"KaiTi","楷体","STKaiti",serif',
}

/* ============================ 打印 @page CSS（纯函数） ============================ */

/** 页码格式 → CSS content 值（`{page}`→counter(page)，`{total}`→counter(pages)） */
export function cssPageContent(format: string): string {
  const parts = format.split(/(\{page\}|\{total\})/).filter((p) => p !== "")
  if (parts.length === 0) return '""'
  return parts
    .map((p) => (p === "{page}" ? "counter(page)" : p === "{total}" ? "counter(pages)" : `"${p.replace(/"/g, '\\"')}"`))
    .join(" ")
}

/** CSS content 字符串字面量（转义引号/反斜杠，页眉页脚为单行：换行折为空格） */
function cssLiteral(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*\n\s*/g, " ")}"`
}

const slotOf = (align: "left" | "center" | "right") => align

/**
 * 打印容器的 @page 规则：
 * v2 → 纸张/方向/边距 + 页码/页眉/页脚 margin box（@top-… / @bottom-…，Chrome 131+）；
 *      band 文本按 data 插值；band 与页码同边同槽时并排（全角空格分隔）；
 * v1 → margin 0（坐标相对纸张原点，元素自带边距）。
 */
export function buildPrintPageCss(tpl: AnyBdTemplate, data: Record<string, unknown> = {}): string {
  if (!isV2(tpl)) {
    return `@page { size: ${tpl.paper} ${tpl.landscape ? "landscape" : "portrait"}; margin: 0; }`
  }
  const { page } = tpl
  const [mt, mr, mb, ml] = page.margin
  const font = BD_FONT_STACKS[page.fontFamily] ?? BD_FONT_STACKS["宋体"]

  // 槽位聚合：edge-slot → { 内容片段, 字号, 颜色 }
  const boxes = new Map<string, { parts: string[]; fontSize: number; color: string }>()
  const put = (edge: "top" | "bottom", slot: string, contentCss: string, fontSize: number, color: string) => {
    const key = `${edge}-${slot}`
    const box = boxes.get(key)
    if (box) {
      box.parts.push(contentCss)
    } else {
      boxes.set(key, { parts: [contentCss], fontSize, color })
    }
  }

  // 页眉/页脚 band（先放，页码后并排拼接）
  if (page.header?.text) {
    put("top", slotOf(page.header.align), cssLiteral(interpolate(page.header.text, data)), page.header.fontSize, "#000")
  }
  if (page.footer?.text) {
    put("bottom", slotOf(page.footer.align), cssLiteral(interpolate(page.footer.text, data)), page.footer.fontSize, "#000")
  }
  const pn = page.pageNumber
  if (pn.show) {
    put(pn.position === "header" ? "top" : "bottom", slotOf(pn.align), cssPageContent(pn.format), pn.fontSize, pn.color ?? PAGENO_DEFAULT_COLOR)
  }

  let boxCss = ""
  for (const [key, box] of boxes) {
    boxCss += ` @${key} { content: ${box.parts.join(' "　" ')}; font-size: ${box.fontSize}pt; font-family: ${font}; color: ${box.color}; }`
  }
  return `@page { size: ${page.size} ${page.landscape ? "landscape" : "portrait"}; margin: ${mt}mm ${mr}mm ${mb}mm ${ml}mm;${boxCss} }`
}

/* ============================ 计算配置：求值/校验（§12，前端仅预览，权威在后端 Aviator） ============================ */

/** 新聚合字段缺省 */
export function newAggregate(): BdCalcAggregate {
  return { name: "", label: "", source: "", field: "", fn: "SUM", format: "number", scale: 2 }
}

/** 新计算字段缺省 */
export function newComputed(): BdCalcComputed {
  return { name: "", label: "", expr: "", format: "number", scale: 2 }
}

/** 计算变量 → 字段树「计算变量」组条目 */
export function calcVarFields(calc: BdCalc | undefined | null): { key: string; label: string; type?: string }[] {
  if (!calc) return []
  return [...calc.aggregates, ...calc.computed]
    .filter((c) => c.name.trim())
    .map((c) => ({ key: c.name.trim(), label: c.label.trim() || c.name.trim(), type: "calc" }))
}

const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
const CN_UNITS = ["", "拾", "佰", "仟"]
const CN_GROUPS = ["", "万", "亿", "万亿"]

/** 人民币大写（§12 chinese 格式；与后端 numberToChinese 同口径：元/角/分/整，负数前置"负"） */
export function numberToChinese(input: number): string {
  if (!Number.isFinite(input)) return "-"
  const negative = input < 0
  const n = Math.round(Math.abs(input) * 100)
  const yuan = Math.floor(n / 100)
  const jiao = Math.floor((n % 100) / 10)
  const fen = n % 10

  let intPart = ""
  if (yuan === 0) {
    intPart = "零"
  } else {
    let rest = yuan
    let group = 0
    while (rest > 0) {
      const seg = rest % 10000
      if (seg > 0) {
        let segStr = ""
        let zeroPending = false
        let s = seg
        for (let u = 0; s > 0; u++) {
          const d = s % 10
          if (d === 0) {
            zeroPending = segStr !== ""
          } else {
            segStr = CN_DIGITS[d] + CN_UNITS[u] + (zeroPending ? "零" : "") + segStr
            zeroPending = false
          }
          s = Math.floor(s / 10)
        }
        // 跨组补零（如 1000200 → 壹佰万零贰佰）
        const needZero = intPart !== "" && seg < 1000
        intPart = segStr + CN_GROUPS[group] + (needZero ? "零" : "") + intPart
      } else if (intPart !== "" && !intPart.startsWith("零")) {
        intPart = `零${intPart}`
      }
      rest = Math.floor(rest / 10000)
      group += 1
    }
  }

  let out = negative ? `负${intPart}元` : `${intPart}元`
  if (jiao === 0 && fen === 0) return `${out}整`
  if (jiao > 0) out += `${CN_DIGITS[jiao]}角`
  else if (fen > 0) out += "零"
  if (fen > 0) out += `${CN_DIGITS[fen]}分`
  return out
}

/** 计算结果格式化：number → 定点小数；chinese → 人民币大写；非数值 → "-" */
export function formatCalcValue(v: unknown, format: CalcFormat, scale: number): string {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return "-"
  return format === "chinese" ? numberToChinese(n) : n.toFixed(Math.max(0, Math.min(6, scale)))
}

/** 聚合求值（对 data[source] 行数组取列） */
function evalAggregate(agg: BdCalcAggregate, data: Record<string, unknown>): number {
  const rows = data[agg.source]
  if (!Array.isArray(rows)) throw new Error(`数据源 ${agg.source} 不是行数组`)
  if (agg.fn === "COUNT" && !agg.field.trim()) return rows.length
  const nums = rows
    .map((r) => Number((r as Record<string, unknown>)?.[agg.field]))
    .filter((x) => Number.isFinite(x))
  switch (agg.fn) {
    case "COUNT":
      return nums.length
    case "SUM":
      return nums.reduce((s, x) => s + x, 0)
    case "AVG":
      return nums.length === 0 ? 0 : nums.reduce((s, x) => s + x, 0) / nums.length
    case "MAX":
      return nums.length === 0 ? 0 : Math.max(...nums)
    case "MIN":
      return nums.length === 0 ? 0 : Math.min(...nums)
  }
}

/** §12 契约函数名（Aviator 注册小写）→ 前端 formula-eval 白名单大写 */
const CALC_FN_ALIASES = /\b(round|abs|sum|avg|max|min|if|and|or|not|len|concat)\s*\(/gi

/**
 * 计算配置演示求值（预览/mock 用；真实由后端出数据时求值）：
 * aggregates → computed（computed 可引聚合名）；失败该变量置 "-" 不阻断。
 * 返回「变量名 → 格式化后值」。
 */
export function evalCalcDemo(calc: BdCalc | undefined | null, data: Record<string, unknown>): Record<string, string> {
  if (!calc) return {}
  const out: Record<string, string> = {}
  /** 原始数值上下文（computed 引用聚合原值而非格式化文本） */
  const rawCtx: Record<string, unknown> = { ...data }
  for (const agg of calc.aggregates) {
    if (!agg.name.trim()) continue
    try {
      const v = evalAggregate(agg, data)
      rawCtx[agg.name] = v
      out[agg.name] = formatCalcValue(v, agg.format, agg.scale)
    } catch {
      out[agg.name] = "-"
    }
  }
  for (const c of calc.computed) {
    if (!c.name.trim()) continue
    try {
      let expr = c.expr.trim()
      let chineseWrap = false
      const m = /^numberToChinese\s*\((.*)\)\s*$/s.exec(expr)
      if (m) {
        chineseWrap = true
        expr = m[1]
      }
      const v = evaluate(expr.replace(CALC_FN_ALIASES, (s) => s.toUpperCase()), rawCtx)
      rawCtx[c.name] = v
      out[c.name] = chineseWrap ? numberToChinese(Number(v)) : formatCalcValue(v, c.format, c.scale)
    } catch {
      out[c.name] = "-"
    }
  }
  return out
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** 公式里放行的 §12 小写函数名（后端 Aviator 注册；前端 validate 用 extraFns 放行） */
const CALC_EXTRA_FNS = ["round", "abs", "sum", "avg", "max", "min", "numberToChinese"] as const

/**
 * 计算配置校验（§12：发布/下一步拦截）。
 * 检查：字段名空/非法/与表单-系统字段重名/内部重名；聚合未选子表；计算公式空/语法错误。
 */
export function calcIssues(calc: BdCalc | undefined | null, fields: Record<string, string>): string[] {
  if (!calc) return []
  const issues: string[] = []
  const seen = new Set<string>()
  const checkName = (name: string, where: string) => {
    const n = name.trim()
    if (!n) {
      issues.push(`${where}未填写字段名`)
      return
    }
    if (!NAME_RE.test(n)) {
      issues.push(`${where}字段名「${n}」非法（字母/下划线开头，仅限字母数字下划线）`)
      return
    }
    if (n in fields || (SYS_KEYS_V2 as readonly string[]).includes(n)) {
      issues.push(`字段名「${n}」与表单/系统字段重名，请更换`)
    }
    if (seen.has(n)) issues.push(`字段名「${n}」在计算配置内重复`)
    seen.add(n)
  }
  calc.aggregates.forEach((a, i) => {
    const where = `第 ${i + 1} 个聚合字段`
    checkName(a.name, where)
    if (!a.source.trim()) issues.push(`${where}${a.name.trim() ? `「${a.name.trim()}」` : ""}未选择数据源（子表）`)
    if (a.fn !== "COUNT" && !a.field.trim()) issues.push(`${where}${a.name.trim() ? `「${a.name.trim()}」` : ""}未填写聚合字段（列）`)
  })
  calc.computed.forEach((c, i) => {
    const where = `第 ${i + 1} 个计算字段`
    checkName(c.name, where)
    if (!c.expr.trim()) {
      issues.push(`${where}${c.name.trim() ? `「${c.name.trim()}」` : ""}计算公式为空`)
    } else {
      const r = validateFormula(c.expr.replace(CALC_FN_ALIASES, (s) => s.toUpperCase()), [...CALC_EXTRA_FNS])
      if (!r.ok) issues.push(`计算字段「${c.name.trim() || i + 1}」公式语法错误：${r.error ?? "无法解析"}`)
    }
  })
  return issues
}

export { getByPath }
