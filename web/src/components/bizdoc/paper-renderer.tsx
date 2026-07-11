/**
 * BizDoc 共用纸面渲染器（丹青同源红线：设计器 / 预览 / 打印三态共用，杜绝漂移）。
 *
 * v2（§9 范式变更）：文档流式块级渲染（块自上而下堆叠、自动高度、打印天然分页），
 * mode="design" 时插值 token 呈现为蓝色字段 chip（设计器画布复用 V2BlockBody）。
 * v1（自由 mm 定位）保留兼容读取；页码页脚打印走 @page margin box（print-preview 生成）。
 * VOID 单据叠 45°「作废」水印（打印态 fixed，逐页重复）。
 */
import type { CSSProperties, ReactNode } from "react"
import {
  fieldText,
  getByPath,
  interpolate,
  paperSize,
  textStyleOf,
  type BdElement,
  type BdRenderCtx,
} from "./model"
import {
  BD_FONT_STACKS,
  formatPageNo,
  isV2,
  pageSizeMm,
  type AnyBdTemplate,
  type BdBlock,
  type BdBlockStyle,
  type BdTemplateV2,
} from "./model-v2"
import { QrSvg } from "./qr"
import "./bizdoc.css"

export type RenderMode = "final" | "design"

/* ============================ 插值 token → 文本 / chip ============================ */

const TOKEN_SPLIT_RE = /(\{\{\s*[\w.]+\s*\}\})/g
const APPROVAL_SUB_LABEL: Record<string, string> = {
  nodeName: "节点",
  assigneeName: "办理人",
  opinion: "意见",
  time: "时间",
}
const SYS_LABELS: Record<string, string> = {
  docNo: "单号",
  title: "标题",
  creatorName: "创建人",
  deptName: "部门",
  createdAt: "创建时间",
  status: "状态",
}

/** token 的人话名（chip 展示）：字段 label / 系统字段 / 审批N·子项 */
function tokenLabel(expr: string, fields: Record<string, string>): string {
  if (fields[expr]) return fields[expr]
  if (SYS_LABELS[expr]) return SYS_LABELS[expr]
  const m = /^_approvals\.(\d+)\.(\w+)$/.exec(expr)
  if (m) return `审批${Number(m[1]) + 1}·${APPROVAL_SUB_LABEL[m[2]] ?? m[2]}`
  return expr
}

/** 智能文本：final=插值；design=token 蓝 chip */
export function TokenText({ text, ctx, mode }: { text: string; ctx: BdRenderCtx; mode: RenderMode }) {
  if (mode === "final") return <>{interpolate(text, ctx.data)}</>
  const parts = text.split(TOKEN_SPLIT_RE)
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(p)
        if (!m) return <span key={i}>{p}</span>
        return (
          <span key={i} className="bd-chip" data-expr={m[1]}>
            {tokenLabel(m[1], ctx.fields)}
          </span>
        )
      })}
    </>
  )
}

/* ============================ v2 块渲染 ============================ */

function blkFont(style: BdBlockStyle | undefined): CSSProperties {
  const s: CSSProperties = {}
  if (style?.fontSize) s.fontSize = `${style.fontSize}pt`
  if (style?.bold) s.fontWeight = 700
  if (style?.align) s.textAlign = style.align
  return s
}

const alignFlex = (a: "left" | "center" | "right") => (a === "left" ? "flex-start" : a === "right" ? "flex-end" : "center")

/** 明细行数据：final 取子表数组；design / 缺数据给占位行 */
function detailRows(field: string, ctx: BdRenderCtx, mode: RenderMode): Record<string, unknown>[] | null {
  const v = getByPath(ctx.data, field)
  if (Array.isArray(v) && v.length > 0) return v as Record<string, unknown>[]
  return mode === "design" ? null : []
}

/**
 * 单个 v2 块的“内容体”（不含设计器外壳）。row 容器由调用方决定：
 * final 态本组件自递归；design 态设计器画布用 renderColumn 自己包外壳。
 */
export function V2BlockBody({
  block,
  ctx,
  mode,
  renderColumn,
}: {
  block: BdBlock
  ctx: BdRenderCtx
  mode: RenderMode
  /** design 态 row 分栏的自定义渲染（塞 BlockShell 列表） */
  renderColumn?: (col: BdBlock[], colIndex: number) => ReactNode
}) {
  switch (block.type) {
    case "title":
      return (
        <div className="bd-blk-title" style={{ textAlign: "center", ...blkFont(block.style) }}>
          <TokenText text={block.text} ctx={ctx} mode={mode} />
        </div>
      )
    case "docInfo": {
      const align = block.style?.align ?? "right"
      return (
        <div className="bd-blk-docinfo" style={{ alignItems: alignFlex(align), ...blkFont({ ...block.style, align: undefined }) }}>
          {block.items.map((it, i) => (
            <div key={i}>
              {it.label && `${it.label}：`}
              <TokenText text={it.value} ctx={ctx} mode={mode} />
            </div>
          ))}
        </div>
      )
    }
    case "infoTable": {
      const per = Math.max(1, block.columnsPerRow)
      const labelW = block.style?.labelWidth ?? 28
      // 按 span 装行
      const rows: { label: string; value: string; span: number }[][] = []
      let cur: { label: string; value: string; span: number }[] = []
      let used = 0
      for (const c of block.cells) {
        const span = Math.max(1, Math.min(c.span ?? 1, per))
        if (used + span > per && cur.length > 0) {
          rows.push(cur)
          cur = []
          used = 0
        }
        cur.push({ label: c.label, value: c.value, span })
        used += span
        if (used >= per) {
          rows.push(cur)
          cur = []
          used = 0
        }
      }
      if (cur.length > 0) rows.push(cur)
      return (
        <table className="bd-tbl" style={blkFont({ ...block.style, align: undefined })}>
          <colgroup>
            {Array.from({ length: per }).flatMap((_, i) => [
              <col key={`l${i}`} style={{ width: `${labelW}mm` }} />,
              <col key={`v${i}`} />,
            ])}
          </colgroup>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => {
                  const isLast = ci === r.length - 1
                  const usedSpans = r.reduce((s, x) => s + x.span, 0)
                  const pad = isLast && usedSpans < per ? (per - usedSpans) * 2 : 0
                  return [
                    <td key={`l${ci}`} className="bd-tbl-label">
                      {c.label}
                    </td>,
                    <td key={`v${ci}`} colSpan={c.span * 2 - 1 + pad}>
                      <TokenText text={c.value} ctx={ctx} mode={mode} />
                    </td>,
                  ]
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case "labelField": {
      const labelW = block.style?.labelWidth ?? 28
      return (
        <table className="bd-tbl" style={blkFont({ ...block.style, align: undefined })}>
          <colgroup>
            <col style={{ width: `${labelW}mm` }} />
            <col />
          </colgroup>
          <tbody>
            <tr>
              <td className="bd-tbl-label">{block.label}</td>
              <td>
                <TokenText text={block.value} ctx={ctx} mode={mode} />
              </td>
            </tr>
          </tbody>
        </table>
      )
    }
    case "text":
      return (
        <div className="bd-blk-text" style={blkFont(block.style)}>
          <TokenText text={block.content} ctx={ctx} mode={mode} />
        </div>
      )
    case "detailTable": {
      const rows = detailRows(block.field, ctx, mode)
      return (
        <table className="bd-tbl" style={blkFont({ ...block.style, align: undefined })}>
          {block.columns.some((c) => c.w) && (
            <colgroup>
              {block.showIndex && <col style={{ width: "10mm" }} />}
              {block.columns.map((c, i) => (
                <col key={i} style={c.w ? { width: `${c.w}mm` } : undefined} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {block.showIndex && <th className="bd-tbl-label">序号</th>}
              {block.columns.map((c, i) => (
                <th key={i} className="bd-tbl-label">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows == null ? (
              <tr>
                {block.showIndex && <td style={{ textAlign: "center" }}>1</td>}
                {block.columns.map((c, i) => (
                  <td key={i}>
                    <span className="bd-chip">{`${block.field}.${c.field}`}</span>
                  </td>
                ))}
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                {block.showIndex && <td>&nbsp;</td>}
                {block.columns.map((_, i) => (
                  <td key={i}>&nbsp;</td>
                ))}
              </tr>
            ) : (
              rows.map((r, ri) => (
                <tr key={ri}>
                  {block.showIndex && <td style={{ textAlign: "center" }}>{ri + 1}</td>}
                  {block.columns.map((c, i) => (
                    <td key={i}>{interpolate(`{{${c.field}}}`, r)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )
    }
    case "approvalTable":
      return (
        <table className="bd-tbl" style={blkFont({ ...block.style, align: undefined })}>
          <tbody>
            <tr>
              {block.steps.map((s, i) => (
                <td key={i} className="bd-tbl-label" style={{ textAlign: "center" }}>
                  {s.label}
                </td>
              ))}
            </tr>
            <tr>
              {block.steps.map((s, i) => (
                <td key={i} className="bd-tbl-sign">
                  <TokenText text={s.value} ctx={ctx} mode={mode} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )
    case "row":
      return (
        <div className="bd-blk-row">
          {block.children.map((col, ci) => (
            <div key={ci} className="bd-blk-col">
              {renderColumn ? (
                renderColumn(col, ci)
              ) : (
                <div className="bd-flow-list">
                  {col.map((b) => (
                    <V2BlockBody key={b.id} block={b} ctx={ctx} mode={mode} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )
    case "signature":
      return (
        <div style={{ display: "flex", justifyContent: alignFlex(block.align), ...blkFont(block.style) }}>
          <div className="bd-blk-sign">
            <span>{block.label}</span>
            <span className="bd-blk-sign-box" />
          </div>
        </div>
      )
    case "qrcode": {
      const val = interpolate(block.value, ctx.data)
      return (
        <div style={{ display: "flex", justifyContent: alignFlex(block.align) }}>
          <QrSvg value={val || (mode === "design" ? "预览" : "")} sizeMm={block.size} />
        </div>
      )
    }
    case "barcode":
      // P1：打印不出，设计/预览给占位
      return (
        <div className="bd-editing-only" style={{ display: "flex", justifyContent: alignFlex(block.align) }}>
          <span className="bd-placeholder" style={{ width: "50mm", height: "10mm" }}>
            条形码（P1 后补）
          </span>
        </div>
      )
    case "image": {
      const usable = block.src && /^(data:|blob:|https?:|\/)/.test(block.src)
      if (!usable) {
        return (
          <div className="bd-editing-only" style={{ display: "flex", justifyContent: alignFlex(block.align) }}>
            <span className="bd-placeholder" style={{ width: `${block.w}mm`, height: "16mm" }}>
              图片（未设置）
            </span>
          </div>
        )
      }
      return (
        <div style={{ display: "flex", justifyContent: alignFlex(block.align) }}>
          <img src={block.src} alt="" style={{ width: `${block.w}mm`, height: "auto" }} />
        </div>
      )
    }
    case "divider":
      return <hr className="bd-blk-divider" />
    case "spacer":
      return <div className={mode === "design" ? "bd-blk-spacer bd-blk-spacer--design" : "bd-blk-spacer"} style={{ height: `${block.h}mm` }} />
    default:
      return null
  }
}

/** v2 文档流整纸渲染（final：预览/打印共用） */
function V2Paper({
  tpl,
  ctx,
  mode,
  scale,
  watermark,
}: {
  tpl: BdTemplateV2
  ctx: BdRenderCtx
  mode: RenderMode
  scale: number
  watermark?: ReactNode
}) {
  const size = pageSizeMm(tpl.page)
  const [mt, mr, mb, ml] = tpl.page.margin
  const pn = tpl.page.pageNumber
  const pageNoEl = pn.show ? (
    <div
      className="bd-pageno bd-editing-only"
      style={{ textAlign: pn.align, fontSize: `${pn.fontSize}pt`, ...(pn.position === "header" ? { order: -1, marginBottom: "2mm" } : {}) }}
    >
      {formatPageNo(pn.format, 1, 1)}
    </div>
  ) : null
  return (
    <div
      className={`bd-paper bd-paper--flow${scale !== 1 ? " bd-paper--scaled" : ""}`}
      style={{
        width: `${size.w}mm`,
        minHeight: `${size.h}mm`,
        padding: `${mt}mm ${mr}mm ${mb}mm ${ml}mm`,
        fontFamily: BD_FONT_STACKS[tpl.page.fontFamily] ?? BD_FONT_STACKS["宋体"],
        fontSize: "10.5pt",
        ...(scale !== 1 ? { transform: `scale(${scale})` } : {}),
      }}
    >
      {pn.position === "header" && pageNoEl}
      <div className="bd-flow-list">
        {tpl.blocks.map((b) => (
          <V2BlockBody key={b.id} block={b} ctx={ctx} mode={mode} />
        ))}
      </div>
      {pn.position === "footer" && pageNoEl}
      {watermark}
    </div>
  )
}

/* ============================ v1 兼容渲染（自由 mm 定位） ============================ */

function elementBox(el: BdElement): CSSProperties {
  return { left: `${el.x}mm`, top: `${el.y}mm`, width: `${el.w}mm`, height: `${Math.max(el.h, 0.1)}mm` }
}

function renderElement(el: BdElement, ctx: BdRenderCtx) {
  switch (el.type) {
    case "label": {
      const s = textStyleOf(el.style)
      return (
        <div key={el.id} className="bd-el" style={{ ...elementBox(el), ...s }}>
          {el.text}
        </div>
      )
    }
    case "field":
    case "sysfield": {
      const s = textStyleOf(el.style)
      const { prefix, value } = fieldText(el, ctx)
      return (
        <div key={el.id} className="bd-el" style={{ ...elementBox(el), ...s }}>
          {prefix}
          {value}
        </div>
      )
    }
    case "line": {
      const widthPt = el.style?.lineWidth ?? 0.75
      const vertical = el.w === 0
      return (
        <div
          key={el.id}
          className="bd-el"
          style={{
            left: `${el.x}mm`,
            top: `${el.y}mm`,
            width: vertical ? "0" : `${el.w}mm`,
            height: vertical ? `${el.h}mm` : "0",
            borderTop: vertical ? undefined : `${widthPt}pt ${el.style?.lineStyle ?? "solid"} #000`,
            borderLeft: vertical ? `${widthPt}pt ${el.style?.lineStyle ?? "solid"} #000` : undefined,
          }}
        />
      )
    }
    case "rect": {
      const widthPt = el.style?.lineWidth ?? 0.75
      return (
        <div
          key={el.id}
          className="bd-el"
          style={{ ...elementBox(el), border: `${widthPt}pt ${el.style?.lineStyle ?? "solid"} #000` }}
        />
      )
    }
    case "table": {
      const rows = getByPath(ctx.data, el.field)
      const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
      return (
        <div key={el.id} className="bd-el" style={{ ...elementBox(el), ...textStyleOf(el.style) }}>
          <table className="bd-tbl">
            <colgroup>
              {el.columns.map((c, i) => (
                <col key={i} style={{ width: `${c.w}mm` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {el.columns.map((c, i) => (
                  <th key={i} className="bd-tbl-label" style={el.style?.headerBold === false ? { fontWeight: 400 } : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r, ri) => (
                <tr key={ri} style={el.style?.rowHeight ? { height: `${el.style.rowHeight}mm` } : undefined}>
                  {el.columns.map((c, i) => (
                    <td key={i}>{interpolate(`{{${c.field}}}`, r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case "image": {
      const usable = el.src && /^(data:|blob:|https?:|\/)/.test(el.src)
      if (!usable) return null
      return (
        <div key={el.id} className="bd-el" style={elementBox(el)}>
          <img src={el.src} alt="" style={{ width: "100%", height: "100%", objectFit: el.style?.imageFit ?? "contain" }} />
        </div>
      )
    }
    case "qrcode":
      return (
        <div key={el.id} className="bd-el" style={elementBox(el)}>
          <QrSvg value={interpolate(el.value, ctx.data)} sizeMm={Math.min(el.w, el.h)} ecLevel={el.style?.qrEcLevel ?? "M"} />
        </div>
      )
    default:
      return null
  }
}

/* ============================ 出口 ============================ */

export interface PaperRendererProps {
  tpl: AnyBdTemplate
  ctx: BdRenderCtx
  /** VOID 单据：45°「作废」水印平铺（进打印，打印态 fixed 逐页重复） */
  voidWatermark?: boolean
  /** 屏幕缩放（transform，仅视觉；打印强制 none） */
  scale?: number
  /** design=插值 token 呈现字段 chip（设计器）；缺省 final */
  mode?: RenderMode
}

export function PaperRenderer({ tpl, ctx, voidWatermark = false, scale = 1, mode = "final" }: PaperRendererProps) {
  const size = isV2(tpl) ? pageSizeMm(tpl.page) : paperSize(tpl.paper, tpl.landscape)
  // 水印平铺：按纸面尺寸铺 3×4 个
  const marks: { left: string; top: string }[] = []
  if (voidWatermark) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        marks.push({ left: `${(c + 0.2) * (size.w / 3)}mm`, top: `${(r + 0.35) * (size.h / 4)}mm` })
      }
    }
  }
  const watermark = voidWatermark && (
    <div className="bd-void-mark" aria-hidden>
      {marks.map((m, i) => (
        <span key={i} style={m}>
          作废
        </span>
      ))}
    </div>
  )

  if (isV2(tpl)) {
    return <V2Paper tpl={tpl} ctx={ctx} mode={mode} scale={scale} watermark={watermark} />
  }

  return (
    <div
      className={scale !== 1 ? "bd-paper bd-paper--scaled" : "bd-paper"}
      style={{
        width: `${size.w}mm`,
        height: `${size.h}mm`,
        ...(scale !== 1 ? { transform: `scale(${scale})` } : {}),
      }}
    >
      {tpl.elements.map((el) => renderElement(el, ctx))}
      {watermark}
    </div>
  )
}
