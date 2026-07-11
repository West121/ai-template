/**
 * 纸面文档流画布（§9.2 中栏）：块 hover 出工具条（拖拽排序/上移下移/复制/删除）、点击选中、
 * 双击标题/文本/标签行内编辑；**单元格就地编辑**（infoTable/labelField/docInfo 值区点击 →
 * 内联输入 + 「插入变量」浮层，第五张截图交互）；palette 拖入按文档流插入（蓝色指示线落点）；
 * 行容器分栏为嵌套放置区（row 不允许再嵌 row）。渲染体复用 V2BlockBody（同源红线）。
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Copy, GripVertical, Trash2, X } from "lucide-react"
import { PageBandRow, V2BlockBody, type CellEditApi, type CellRef } from "@/components/bizdoc/paper-renderer"
import type { BdRenderCtx } from "@/components/bizdoc/model"
import {
  BD_FONT_STACKS,
  FOOTER_ID,
  HEADER_ID,
  cloneBlock,
  findBlock,
  insertBlock,
  moveBlock,
  newBlock,
  pageSizeMm,
  removeBlock,
  type BdBlock,
  type BdBlockType,
  type BdPageV2,
  type BdTemplateV2,
} from "@/components/bizdoc/model-v2"
import { BLOCK_META, DND_MOVE, DND_NEW } from "./meta"
import { CellTokenEditor } from "./cell-editor"
import type { VarGroup } from "./token-vars"

interface DropAt {
  parent: string | null
  col: number
  index: number
}

export interface CanvasProps {
  tpl: BdTemplateV2
  /** design 态上下文（data 空、fields 供 chip 显示名） */
  ctx: BdRenderCtx
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** 结构变化（插入/移动/复制/删除/行内编辑）→ 提交历史 */
  onBlocks: (blocks: BdBlock[]) => void
  /** 页面级补丁（页眉/页脚删除等） */
  onPatchPage: (p: Partial<BdPageV2>) => void
  /** 「插入变量」浮层分组（与 field-picker 同源，含显示属性变体/计算变量） */
  varGroups: VarGroup[]
}

const sameAt = (a: DropAt | null, b: DropAt) => a != null && a.parent === b.parent && a.col === b.col && a.index === b.index

export function DesignerCanvas({ tpl, ctx, selectedId, onSelect, onBlocks, onPatchPage, varGroups }: CanvasProps) {
  const size = pageSizeMm(tpl.page)
  const [mt, mr, mb, ml] = tpl.page.margin
  const [indicator, setIndicator] = useState<DropAt | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 就地编辑中的单元格 */
  const [editingCell, setEditingCell] = useState<{ ref: CellRef; value: string } | null>(null)

  /* -------- 单元格值就地提交 -------- */
  const patchCellValue = (ref: CellRef, v: string) => {
    const next = JSON.parse(JSON.stringify(tpl.blocks)) as BdBlock[]
    const hit = findBlock(next, ref.blockId)
    if (!hit) return
    const b = hit.block
    if (ref.kind === "infoTable" && b.type === "infoTable" && b.cells[ref.index]) b.cells[ref.index].value = v
    else if (ref.kind === "labelField" && b.type === "labelField") b.value = v
    else if (ref.kind === "docInfo" && b.type === "docInfo" && b.items[ref.index]) b.items[ref.index].value = v
    else return
    onBlocks(next)
  }

  const cellEdit: CellEditApi = {
    active: editingCell?.ref ?? null,
    onOpen: (ref, value) => setEditingCell({ ref, value }),
    renderEditor: (ref) => (
      <CellTokenEditor
        initial={editingCell?.value ?? ""}
        groups={varGroups}
        onCommit={(v) => {
          if (editingCell && v !== editingCell.value) patchCellValue(ref, v)
          setEditingCell(null)
        }}
        onCancel={() => setEditingCell(null)}
      />
    ),
  }

  // 删除选中块/页眉/页脚：Delete 键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || !selectedId) return
      const target = e.target as HTMLElement
      if (target.closest("input,textarea,[contenteditable]")) return
      if (selectedId === HEADER_ID || selectedId === FOOTER_ID) {
        onPatchPage(selectedId === HEADER_ID ? { header: null } : { footer: null })
      } else {
        onBlocks(removeBlock(tpl.blocks, selectedId))
      }
      onSelect(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedId, tpl.blocks, onBlocks, onSelect, onPatchPage])

  const handleDrop = (e: DragEvent, at: DropAt) => {
    e.preventDefault()
    e.stopPropagation()
    setIndicator(null)
    const newType = e.dataTransfer.getData(DND_NEW) as BdBlockType | ""
    if (newType) {
      const block = newBlock(newType)
      const next = insertBlock(tpl.blocks, block, at)
      if (next !== tpl.blocks) {
        onBlocks(next)
        onSelect(block.id)
      }
      return
    }
    const moveId = e.dataTransfer.getData(DND_MOVE)
    if (moveId) {
      const next = moveBlock(tpl.blocks, moveId, at)
      if (next !== tpl.blocks) onBlocks(next)
    }
  }

  const dragOver = (e: DragEvent, at: DropAt) => {
    if (!e.dataTransfer.types.includes(DND_NEW) && !e.dataTransfer.types.includes(DND_MOVE)) return
    e.preventDefault()
    e.stopPropagation()
    if (!sameAt(indicator, at)) setIndicator(at)
  }

  /* -------- 行内编辑（标题/智能文本/标签字段 label） -------- */
  const inlinePatch = (id: string, patch: Partial<BdBlock>) => {
    const next = JSON.parse(JSON.stringify(tpl.blocks)) as BdBlock[]
    const hit = findBlock(next, id)
    if (!hit) return
    Object.assign(hit.block, patch)
    onBlocks(next)
  }

  const renderInlineEditor = (block: BdBlock): ReactNode => {
    const done = () => setEditingId(null)
    if (block.type === "title") {
      return (
        <InlineInput
          defaultValue={block.text}
          onDone={(v) => {
            if (v !== block.text) inlinePatch(block.id, { text: v })
            done()
          }}
          style={{ fontSize: `${block.style?.fontSize ?? 18}pt`, fontWeight: block.style?.bold ? 700 : 400, textAlign: "center" }}
        />
      )
    }
    if (block.type === "text") {
      return (
        <InlineInput
          multiline
          defaultValue={block.content}
          onDone={(v) => {
            if (v !== block.content) inlinePatch(block.id, { content: v })
            done()
          }}
          style={{ fontSize: `${block.style?.fontSize ?? 10.5}pt` }}
        />
      )
    }
    if (block.type === "labelField") {
      return (
        <InlineInput
          defaultValue={block.label}
          onDone={(v) => {
            if (v !== block.label) inlinePatch(block.id, { label: v })
            done()
          }}
          style={{ fontSize: `${block.style?.fontSize ?? 10.5}pt` }}
        />
      )
    }
    return null
  }

  /* -------- 块外壳 + 容器列表 -------- */

  const BlockShell = ({ block, at, count }: { block: BdBlock; at: DropAt; count: number }) => {
    const selected = selectedId === block.id
    const editing = editingId === block.id
    const editable = block.type === "title" || block.type === "text" || block.type === "labelField"
    return (
      <div
        className={`bd-shell group/blk relative ${selected ? "bd-shell--selected" : ""}`}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(block.id)
        }}
        onDoubleClick={(e) => {
          if (!editable) return
          e.stopPropagation()
          setEditingId(block.id)
        }}
        onDragOver={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const before = e.clientY < rect.top + rect.height / 2
          dragOver(e, { ...at, index: at.index + (before ? 0 : 1) })
        }}
        onDrop={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const before = e.clientY < rect.top + rect.height / 2
          handleDrop(e, { ...at, index: at.index + (before ? 0 : 1) })
        }}
      >
        {/* hover 工具条 */}
        <div className="bd-shell-tools opacity-0 transition-opacity group-hover/blk:opacity-100">
          <span className="bd-shell-name">{BLOCK_META[block.type]?.label ?? block.type}</span>
          <button
            type="button"
            title="拖拽排序"
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              e.dataTransfer.setData(DND_MOVE, block.id)
              e.dataTransfer.effectAllowed = "move"
            }}
            className="bd-shell-btn cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="size-3" />
          </button>
          <button
            type="button"
            title="上移"
            className="bd-shell-btn disabled:opacity-30"
            disabled={at.index === 0}
            onClick={(e) => {
              e.stopPropagation()
              const next = moveBlock(tpl.blocks, block.id, { ...at, index: at.index - 1 })
              if (next !== tpl.blocks) onBlocks(next)
            }}
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            title="下移"
            className="bd-shell-btn disabled:opacity-30"
            disabled={at.index >= count - 1}
            onClick={(e) => {
              e.stopPropagation()
              const next = moveBlock(tpl.blocks, block.id, { ...at, index: at.index + 2 })
              if (next !== tpl.blocks) onBlocks(next)
            }}
          >
            <ChevronDown className="size-3" />
          </button>
          <button
            type="button"
            title="复制"
            className="bd-shell-btn"
            onClick={(e) => {
              e.stopPropagation()
              const copy = cloneBlock(block)
              const next = insertBlock(tpl.blocks, copy, { ...at, index: at.index + 1 })
              if (next !== tpl.blocks) {
                onBlocks(next)
                onSelect(copy.id)
              }
            }}
          >
            <Copy className="size-3" />
          </button>
          <button
            type="button"
            title="删除"
            className="bd-shell-btn hover:!text-red-600"
            onClick={(e) => {
              e.stopPropagation()
              onBlocks(removeBlock(tpl.blocks, block.id))
              if (selected) onSelect(null)
            }}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
        {editing ? (
          renderInlineEditor(block)
        ) : (
          <V2BlockBody
            block={block}
            ctx={ctx}
            mode="design"
            cellEdit={cellEdit}
            renderColumn={(col, ci) => <BlockList blocks={col} parent={block.id} col={ci} nested />}
          />
        )}
      </div>
    )
  }

  const BlockList = ({ blocks, parent, col, nested = false }: { blocks: BdBlock[]; parent: string | null; col: number; nested?: boolean }) => (
    <div
      className={`bd-flow-list ${nested ? "bd-droplist--nested" : ""}`}
      style={nested && blocks.length === 0 ? { minHeight: "12mm" } : undefined}
      onDragOver={(e) => dragOver(e, { parent, col, index: blocks.length })}
      onDrop={(e) => handleDrop(e, { parent, col, index: blocks.length })}
    >
      {blocks.map((b, i) => (
        <div key={b.id} className="relative">
          {sameAt(indicator, { parent, col, index: i }) && <div className="bd-drop-line" />}
          <BlockShell block={b} at={{ parent, col, index: i }} count={blocks.length} />
        </div>
      ))}
      {sameAt(indicator, { parent, col, index: blocks.length }) && <div className="bd-drop-line" />}
      {blocks.length === 0 && (
        <div className={`bd-empty-hint ${nested ? "" : "py-16"}`}>{nested ? "拖块到此栏" : "从左侧元素库拖入块，或点击元素追加"}</div>
      )}
    </div>
  )

  /** 页眉/页脚 band 的选中壳（点击选中，右上 X 删除） */
  const bandShell = (which: "header" | "footer") => (node: ReactNode) => {
    const id = which === "header" ? HEADER_ID : FOOTER_ID
    const selected = selectedId === id
    return (
      <div
        className={`bd-shell group/band relative inline-block w-full ${selected ? "bd-shell--selected" : ""}`}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(id)
        }}
      >
        <div className="bd-shell-tools opacity-0 transition-opacity group-hover/band:opacity-100">
          <span className="bd-shell-name">{which === "header" ? "文档页眉" : "文档页脚"}</span>
          <button
            type="button"
            title="删除"
            className="bd-shell-btn hover:!text-red-600"
            onClick={(e) => {
              e.stopPropagation()
              onPatchPage(which === "header" ? { header: null } : { footer: null })
              if (selected) onSelect(null)
            }}
          >
            <X className="size-3" />
          </button>
        </div>
        {node}
      </div>
    )
  }

  return (
    <div
      className="bd-paper bd-paper--flow"
      style={{
        width: `${size.w}mm`,
        minHeight: `${size.h}mm`,
        padding: `${mt}mm ${mr}mm ${mb}mm ${ml}mm`,
        fontFamily: BD_FONT_STACKS[tpl.page.fontFamily] ?? BD_FONT_STACKS["宋体"],
        fontSize: "10.5pt",
      }}
      onClick={() => onSelect(null)}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIndicator(null)
      }}
    >
      {/* 页边距参考线 */}
      <div
        className="bd-margin-guide"
        style={{ top: `${mt}mm`, right: `${mr}mm`, bottom: `${mb}mm`, left: `${ml}mm` }}
        aria-hidden
      />
      <PageBandRow page={tpl.page} edge="header" ctx={ctx} mode="design" wrapBand={bandShell("header")} />
      <BlockList blocks={tpl.blocks} parent={null} col={0} />
      <PageBandRow page={tpl.page} edge="footer" ctx={ctx} mode="design" wrapBand={bandShell("footer")} />
    </div>
  )
}

/* -------- 行内编辑输入（自动聚焦，Enter/失焦提交，Esc 取消） -------- */
function InlineInput({
  defaultValue,
  onDone,
  style,
  multiline = false,
}: {
  defaultValue: string
  onDone: (v: string) => void
  style?: React.CSSProperties
  multiline?: boolean
}) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const common = {
    defaultValue,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => onDone(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Escape") onDone(defaultValue)
      if (e.key === "Enter" && !multiline) (e.target as HTMLInputElement).blur()
    },
    style: { ...style, width: "100%", border: "1px dashed #3b82f6", outline: "none", background: "#eff6ff", padding: "0.5mm 1mm" },
  }
  return multiline ? (
    <textarea ref={(el) => void (ref.current = el)} rows={3} {...common} />
  ) : (
    <input ref={(el) => void (ref.current = el)} {...common} />
  )
}
