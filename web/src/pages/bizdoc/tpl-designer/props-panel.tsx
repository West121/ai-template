/**
 * 属性面板（§9.2 右栏）：未选中块 = 页面设置（大小/方向/边距/字体/页码含颜色）；
 * 选中块 = 该块属性（全 13 类）；选中页眉/页脚 = BandPanel。
 * 文本输入失焦提交（一次编辑一步撤销），开关/下拉即时提交。
 */
import { useEffect, useRef, useState } from "react"
import { Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  PAGENO_DEFAULT_COLOR,
  type BdBlock,
  type BdBlockStyle,
  type BdFontName,
  type BdPageBand,
  type BdPageSize,
  type BdPageV2,
} from "@/components/bizdoc/model-v2"
import { BLOCK_META } from "./meta"
import { TokenInput, type FieldOption } from "./field-picker"

/* -------- 失焦提交的文本/数字输入 -------- */

export function CommitInput({ value, onCommit, placeholder, mono = false }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setV(value)
  }, [value])
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && v !== value && onCommit(v)}
      placeholder={placeholder}
      className={`h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${mono ? "font-mono" : ""}`}
    />
  )
}

export function CommitNumber({ value, onCommit, min, max, step = 1, suffix }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const [v, setV] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setV(String(value))
  }, [value])
  const commit = () => {
    let n = Number(v)
    if (!Number.isFinite(n)) {
      setV(String(value))
      return
    }
    if (min != null) n = Math.max(min, n)
    if (max != null) n = Math.min(max, n)
    setV(String(n))
    if (n !== value) onCommit(n)
  }
  return (
    <div className="flex items-center gap-1">
      <input
        ref={ref}
        type="number"
        value={v}
        step={step}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {suffix && <span className="shrink-0 text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const ALIGN_OPTIONS = [
  { v: "left", label: "左" },
  { v: "center", label: "中" },
  { v: "right", label: "右" },
] as const

function AlignSelect({ value, onChange }: { value: "left" | "center" | "right"; onChange: (v: "left" | "center" | "right") => void }) {
  return (
    <div className="flex gap-1">
      {ALIGN_OPTIONS.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`h-6 flex-1 rounded border text-[11px] ${value === o.v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 色板：预设 + 自定义取色（页码颜色等） */
const COLOR_PRESETS = [PAGENO_DEFAULT_COLOR, "#6b7280", "#000000", "#1d4ed8", "#b91c1c"]

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {COLOR_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className={`size-5 rounded-full border ${value.toLowerCase() === c ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="自定义颜色"
        className="size-5 cursor-pointer rounded border bg-transparent p-0"
      />
    </div>
  )
}

/* -------- 页面设置 -------- */

export function PagePanel({ page, onPatch }: { page: BdPageV2; onPatch: (p: Partial<BdPageV2>) => void }) {
  const patchPn = (p: Partial<BdPageV2["pageNumber"]>) => onPatch({ pageNumber: { ...page.pageNumber, ...p } })
  const patchMargin = (i: number, v: number) => {
    const m = [...page.margin] as BdPageV2["margin"]
    m[i] = v
    onPatch({ margin: m })
  }
  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold">页面设置</h3>
      <Row label="纸张">
        <Select value={page.size} onValueChange={(v) => onPatch({ size: v as BdPageSize })}>
          <SelectTrigger size="sm" className="h-7 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["A4", "A5", "Letter"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="方向">
        <div className="flex items-center gap-2">
          <Switch checked={page.landscape} onCheckedChange={(v) => onPatch({ landscape: v })} />
          <span className="text-xs text-muted-foreground">{page.landscape ? "横向" : "纵向"}</span>
        </div>
      </Row>
      <Row label="字体">
        <Select value={page.fontFamily} onValueChange={(v) => onPatch({ fontFamily: v as BdFontName })}>
          <SelectTrigger size="sm" className="h-7 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["宋体", "黑体", "仿宋", "楷体"] as const).map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">页边距（mm，上/右/下/左）</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {page.margin.map((m, i) => (
            <CommitNumber key={i} value={m} min={0} max={50} onCommit={(v) => patchMargin(i, v)} />
          ))}
        </div>
      </div>
      <Separator />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">页码</h3>
        <Switch checked={page.pageNumber.show} onCheckedChange={(v) => patchPn({ show: v })} />
      </div>
      {page.pageNumber.show && (
        <>
          <Row label="位置">
            <Select value={page.pageNumber.position} onValueChange={(v) => patchPn({ position: v as "footer" | "header" })}>
              <SelectTrigger size="sm" className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="footer">页脚</SelectItem>
                <SelectItem value="header">页眉</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="对齐">
            <AlignSelect value={page.pageNumber.align} onChange={(v) => patchPn({ align: v })} />
          </Row>
          <Row label="格式">
            <CommitInput value={page.pageNumber.format} onCommit={(v) => patchPn({ format: v })} placeholder="第 {page} 页 / 共 {total} 页" mono />
          </Row>
          <Row label="字号">
            <CommitNumber value={page.pageNumber.fontSize} min={6} max={16} step={0.5} suffix="pt" onCommit={(v) => patchPn({ fontSize: v })} />
          </Row>
          <Row label="颜色">
            <ColorSwatches value={page.pageNumber.color ?? PAGENO_DEFAULT_COLOR} onChange={(c) => patchPn({ color: c })} />
          </Row>
          <p className="text-[10px] leading-snug text-muted-foreground">屏幕预览按单页显示；打印按实际页数由浏览器生成（{"{page}"}/{"{total}"} 占位）。</p>
        </>
      )}
    </div>
  )
}

/* -------- 页眉/页脚属性 -------- */

export function BandPanel({
  which,
  band,
  fields,
  calcVars,
  onChange,
  onRemove,
}: {
  which: "header" | "footer"
  band: BdPageBand
  fields: FieldOption[]
  calcVars?: FieldOption[]
  onChange: (b: BdPageBand) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">{which === "header" ? "文档页眉" : "文档页脚"} 属性</h3>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-red-600" onClick={onRemove}>
          <Trash2 className="size-3" /> 移除
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">内容（单行，支持 {"{{字段}}"} 插值）</Label>
        <TokenInput value={band.text} onCommit={(v) => onChange({ ...band, text: v })} fields={fields} calcVars={calcVars} />
      </div>
      <Row label="对齐">
        <AlignSelect value={band.align} onChange={(v) => onChange({ ...band, align: v })} />
      </Row>
      <Row label="字号">
        <CommitNumber value={band.fontSize} min={6} max={16} step={0.5} suffix="pt" onCommit={(v) => onChange({ ...band, fontSize: v })} />
      </Row>
      <p className="text-[10px] leading-snug text-muted-foreground">
        每页{which === "header" ? "顶部" : "底部"}固定；打印经 @page 边距区输出，与页码同侧时按对齐槽并排。
      </p>
    </div>
  )
}

/* -------- 块属性 -------- */

export function BlockPanel({
  block,
  fields,
  calcVars,
  onPatch,
}: {
  block: BdBlock
  fields: FieldOption[]
  calcVars?: FieldOption[]
  onPatch: (patch: Partial<BdBlock>) => void
}) {
  const style = (block.style ?? {}) as BdBlockStyle
  const patchStyle = (p: Partial<BdBlockStyle>) => onPatch({ style: { ...style, ...p } })

  const fontRows = (
    <>
      <Row label="字号">
        <CommitNumber value={style.fontSize ?? 10.5} min={6} max={48} step={0.5} suffix="pt" onCommit={(v) => patchStyle({ fontSize: v })} />
      </Row>
      <Row label="加粗">
        <Switch checked={style.bold ?? false} onCheckedChange={(v) => patchStyle({ bold: v })} />
      </Row>
    </>
  )

  return (
    <div className="space-y-3 p-3" key={block.id}>
      <h3 className="text-xs font-semibold">{BLOCK_META[block.type]?.label ?? block.type} 属性</h3>

      {block.type === "title" && (
        <>
          <Row label="标题">
            <TokenInput value={block.text} onCommit={(v) => onPatch({ text: v })} fields={fields} calcVars={calcVars} />
          </Row>
          {fontRows}
          <Row label="对齐">
            <AlignSelect value={style.align ?? "center"} onChange={(v) => patchStyle({ align: v })} />
          </Row>
        </>
      )}

      {block.type === "docInfo" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">信息行</Label>
            {block.items.map((it, i) => (
              <div key={i} className="space-y-1 rounded-md border p-1.5">
                <div className="flex items-center gap-1">
                  <CommitInput value={it.label} placeholder="标签" onCommit={(v) => onPatch({ items: block.items.map((x, xi) => (xi === i ? { ...x, label: v } : x)) })} />
                  <Button variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => onPatch({ items: block.items.filter((_, xi) => xi !== i) })}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <TokenInput value={it.value} placeholder="值（可插字段）" onCommit={(v) => onPatch({ items: block.items.map((x, xi) => (xi === i ? { ...x, value: v } : x)) })} fields={fields} calcVars={calcVars} />
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-6 w-full gap-1 text-[11px]" onClick={() => onPatch({ items: [...block.items, { label: "标签", value: "" }] })}>
              <Plus className="size-3" /> 加一行
            </Button>
          </div>
          {fontRows}
          <Row label="对齐">
            <AlignSelect value={style.align ?? "right"} onChange={(v) => patchStyle({ align: v })} />
          </Row>
        </>
      )}

      {block.type === "infoTable" && (
        <>
          <Row label="每行组数">
            <CommitNumber value={block.columnsPerRow} min={1} max={4} onCommit={(v) => onPatch({ columnsPerRow: v })} />
          </Row>
          <Row label="标签宽">
            <CommitNumber value={style.labelWidth ?? 28} min={10} max={80} suffix="mm" onCommit={(v) => patchStyle({ labelWidth: v })} />
          </Row>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">单元格（标签 + 值）</Label>
            {block.cells.map((c, i) => (
              <div key={i} className="space-y-1 rounded-md border p-1.5">
                <div className="flex items-center gap-1">
                  <CommitInput value={c.label} placeholder="标签" onCommit={(v) => onPatch({ cells: block.cells.map((x, xi) => (xi === i ? { ...x, label: v } : x)) })} />
                  <div className="w-14 shrink-0">
                    <CommitNumber value={c.span ?? 1} min={1} max={block.columnsPerRow} onCommit={(v) => onPatch({ cells: block.cells.map((x, xi) => (xi === i ? { ...x, span: v } : x)) })} />
                  </div>
                  <Button variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => onPatch({ cells: block.cells.filter((_, xi) => xi !== i) })}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <TokenInput value={c.value} placeholder="值（可插字段）" onCommit={(v) => onPatch({ cells: block.cells.map((x, xi) => (xi === i ? { ...x, value: v } : x)) })} fields={fields} calcVars={calcVars} />
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-6 w-full gap-1 text-[11px]" onClick={() => onPatch({ cells: [...block.cells, { label: "字段", value: "" }] })}>
              <Plus className="size-3" /> 加一格
            </Button>
            <p className="text-[10px] text-muted-foreground">格右侧数字 = 跨组数（占几个 标签+值）。</p>
          </div>
          {fontRows}
        </>
      )}

      {block.type === "labelField" && (
        <>
          <Row label="标签">
            <CommitInput value={block.label} onCommit={(v) => onPatch({ label: v })} />
          </Row>
          <Row label="值">
            <TokenInput value={block.value} onCommit={(v) => onPatch({ value: v })} fields={fields} calcVars={calcVars} />
          </Row>
          <Row label="标签宽">
            <CommitNumber value={style.labelWidth ?? 28} min={10} max={80} suffix="mm" onCommit={(v) => patchStyle({ labelWidth: v })} />
          </Row>
          {fontRows}
        </>
      )}

      {block.type === "text" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">内容（支持 {"{{字段}}"} 插值）</Label>
            <TokenInput multiline value={block.content} onCommit={(v) => onPatch({ content: v })} fields={fields} calcVars={calcVars} />
          </div>
          {fontRows}
          <Row label="对齐">
            <AlignSelect value={style.align ?? "left"} onChange={(v) => patchStyle({ align: v })} />
          </Row>
        </>
      )}

      {block.type === "detailTable" && (
        <>
          <Row label="子表字段">
            <CommitInput value={block.field} mono placeholder="如 items" onCommit={(v) => onPatch({ field: v })} />
          </Row>
          <Row label="序号列">
            <Switch checked={block.showIndex ?? false} onCheckedChange={(v) => onPatch({ showIndex: v })} />
          </Row>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">列（字段 / 表头 / 宽mm）</Label>
            {block.columns.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <CommitInput value={c.field} mono placeholder="字段" onCommit={(v) => onPatch({ columns: block.columns.map((x, xi) => (xi === i ? { ...x, field: v } : x)) })} />
                <CommitInput value={c.label} placeholder="表头" onCommit={(v) => onPatch({ columns: block.columns.map((x, xi) => (xi === i ? { ...x, label: v } : x)) })} />
                <div className="w-14 shrink-0">
                  <CommitNumber value={c.w ?? 0} min={0} max={180} onCommit={(v) => onPatch({ columns: block.columns.map((x, xi) => (xi === i ? { ...x, w: v || undefined } : x)) })} />
                </div>
                <Button variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => onPatch({ columns: block.columns.filter((_, xi) => xi !== i) })}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-6 w-full gap-1 text-[11px]" onClick={() => onPatch({ columns: [...block.columns, { field: "", label: "列" }] })}>
              <Plus className="size-3" /> 加一列
            </Button>
            <p className="text-[10px] text-muted-foreground">宽 0 = 自动均分；子表字段的值须是行数组。</p>
          </div>
          {fontRows}
        </>
      )}

      {block.type === "approvalTable" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">审批步骤（列）</Label>
            {block.steps.map((s, i) => (
              <div key={i} className="space-y-1 rounded-md border p-1.5">
                <div className="flex items-center gap-1">
                  <CommitInput value={s.label} placeholder="列头（如 部门审批）" onCommit={(v) => onPatch({ steps: block.steps.map((x, xi) => (xi === i ? { ...x, label: v } : x)) })} />
                  <Button variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => onPatch({ steps: block.steps.filter((_, xi) => xi !== i) })}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <TokenInput multiline value={s.value} placeholder="内容（插审批字段）" onCommit={(v) => onPatch({ steps: block.steps.map((x, xi) => (xi === i ? { ...x, value: v } : x)) })} fields={fields} calcVars={calcVars} />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-6 w-full gap-1 text-[11px]"
              onClick={() =>
                onPatch({ steps: [...block.steps, { label: `审批${block.steps.length + 1}`, value: `{{_approvals.${block.steps.length}.assigneeName}}` }] })
              }
            >
              <Plus className="size-3" /> 加一步
            </Button>
            <p className="text-[10px] leading-snug text-muted-foreground">数据来自流程办理记录 _approvals（磐石 §9.3），未办为空。</p>
          </div>
          {fontRows}
        </>
      )}

      {block.type === "row" && (
        <>
          <Row label="栏数">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={block.children.length <= 1 || block.children[block.children.length - 1].length > 0}
                onClick={() => onPatch({ children: block.children.slice(0, -1) })}
              >
                − 减栏
              </Button>
              <span className="text-xs">{block.children.length}</span>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={block.children.length >= 4} onClick={() => onPatch({ children: [...block.children, []] })}>
                ＋ 加栏
              </Button>
            </div>
          </Row>
          <p className="text-[10px] leading-snug text-muted-foreground">各栏等宽；把块拖进栏内即可并排（减栏需末栏为空；行容器内不可再嵌行容器）。</p>
        </>
      )}

      {block.type === "signature" && (
        <>
          <Row label="标签">
            <CommitInput value={block.label} onCommit={(v) => onPatch({ label: v })} />
          </Row>
          <Row label="对齐">
            <AlignSelect value={block.align} onChange={(v) => onPatch({ align: v })} />
          </Row>
        </>
      )}

      {block.type === "qrcode" && (
        <>
          <Row label="内容">
            <TokenInput value={block.value} onCommit={(v) => onPatch({ value: v })} fields={fields} calcVars={calcVars} />
          </Row>
          <Row label="边长">
            <CommitNumber value={block.size} min={10} max={60} suffix="mm" onCommit={(v) => onPatch({ size: v })} />
          </Row>
          <Row label="对齐">
            <AlignSelect value={block.align} onChange={(v) => onPatch({ align: v })} />
          </Row>
        </>
      )}

      {block.type === "image" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">图片（嵌入模板 JSON）</Label>
            <label className="flex h-16 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent">
              <Upload className="size-3.5" />
              {block.src ? "重新上传" : "上传图片"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => onPatch({ src: String(reader.result) })
                  reader.readAsDataURL(file)
                }}
              />
            </label>
            {block.src && <img src={block.src} alt="" className="max-h-20 rounded border object-contain" />}
          </div>
          <Row label="宽度">
            <CommitNumber value={block.w} min={5} max={180} suffix="mm" onCommit={(v) => onPatch({ w: v })} />
          </Row>
          <Row label="对齐">
            <AlignSelect value={block.align} onChange={(v) => onPatch({ align: v })} />
          </Row>
        </>
      )}

      {block.type === "spacer" && (
        <Row label="高度">
          <CommitNumber value={block.h} min={1} max={100} suffix="mm" onCommit={(v) => onPatch({ h: v })} />
        </Row>
      )}

      {block.type === "divider" && <p className="text-xs text-muted-foreground">通栏分割线（0.3mm 黑色实线），无更多属性。</p>}

      {block.type === "barcode" && <p className="text-xs text-muted-foreground">条形码为 P1 项，本期打印不输出，仅保留契约占位。</p>}
    </div>
  )
}
