/**
 * BizDoc 共用纸面渲染器（丹青 §0 同源红线：设计器 / 预览 / 打印三态共用本组件，杜绝漂移）。
 *
 * 批A 最小实现：label / field / sysfield / line（+rect 顺带，纯 CSS 边框零成本）按 mm 绝对定位渲染；
 * table / image / qrcode 留接口（renderElement switch 分支已占位，批B 补全，print 态渲染为空、
 * 屏幕态给灰占位标注）。VOID 单据叠 45°「作废」水印（§8 裁定，进打印）。
 */
import type { CSSProperties } from "react"
import {
  fieldText,
  interpolate,
  paperSize,
  textStyleOf,
  type BdElement,
  type BdRenderCtx,
  type BdTemplate,
} from "./model"
import "./bizdoc.css"

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
    // 批B 补全：table（明细循环）/ image / qrcode —— 接口已留，print 态不渲染
    case "table":
    case "image":
    case "qrcode":
      return (
        <div
          key={el.id}
          className="bd-el bd-editing-only"
          style={{
            ...elementBox(el),
            border: "1px dashed #d1d5db",
            color: "#9ca3af",
            fontSize: "8pt",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {el.type === "qrcode" ? `二维码 ${interpolate(el.value, ctx.data)}` : el.type === "table" ? "明细表（批B）" : "图片（批B）"}
        </div>
      )
    default:
      return null
  }
}

export interface PaperRendererProps {
  tpl: BdTemplate
  ctx: BdRenderCtx
  /** VOID 单据：45°「作废」水印平铺（进打印） */
  voidWatermark?: boolean
  /** 屏幕缩放（transform，仅视觉；打印强制 none） */
  scale?: number
}

export function PaperRenderer({ tpl, ctx, voidWatermark = false, scale = 1 }: PaperRendererProps) {
  const size = paperSize(tpl.paper, tpl.landscape)
  // 水印平铺：按纸面尺寸铺 3×4 个
  const marks: { left: string; top: string }[] = []
  if (voidWatermark) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        marks.push({ left: `${(c + 0.2) * (size.w / 3)}mm`, top: `${(r + 0.35) * (size.h / 4)}mm` })
      }
    }
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
      {voidWatermark && (
        <div className="bd-void-mark" aria-hidden>
          {marks.map((m, i) => (
            <span key={i} style={m}>
              作废
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
