/**
 * 元素库（§9.2 左栏，分组对齐参考图：布局容器/表头区域/信息区域/表格区域/页脚区域/其他元素）。
 * 块：拖入画布按文档流插入，点击=追加到末尾；文档页眉/页脚为页面级（点击启用，每页固定）。
 */
import { PanelBottomDashed, PanelTopDashed } from "lucide-react"
import type { BdBlockType } from "@/components/bizdoc/model-v2"
import { BLOCK_META, DND_NEW } from "./meta"

type PaletteItem = { kind: "block"; type: BdBlockType } | { kind: "band"; band: "header" | "footer" }

const GROUPS: { name: string; items: PaletteItem[] }[] = [
  { name: "布局容器", items: [{ kind: "block", type: "row" }] },
  {
    name: "表头区域",
    items: [
      { kind: "band", band: "header" },
      { kind: "block", type: "title" },
      { kind: "block", type: "docInfo" },
    ],
  },
  {
    name: "信息区域",
    items: [
      { kind: "block", type: "labelField" },
      { kind: "block", type: "infoTable" },
      { kind: "block", type: "text" },
    ],
  },
  {
    name: "表格区域",
    items: [
      { kind: "block", type: "detailTable" },
      { kind: "block", type: "approvalTable" },
    ],
  },
  { name: "页脚区域", items: [{ kind: "band", band: "footer" }] },
  {
    name: "其他元素",
    items: [
      { kind: "block", type: "signature" },
      { kind: "block", type: "qrcode" },
      { kind: "block", type: "barcode" },
      { kind: "block", type: "image" },
      { kind: "block", type: "divider" },
      { kind: "block", type: "spacer" },
    ],
  },
]

export function Palette({
  onAdd,
  onAddBand,
  hasBand,
}: {
  onAdd: (type: BdBlockType) => void
  /** 启用文档页眉/页脚（页面级，每页固定） */
  onAddBand: (which: "header" | "footer") => void
  /** 已启用态（置灰防重复加） */
  hasBand: { header: boolean; footer: boolean }
}) {
  return (
    <div className="space-y-3 overflow-y-auto p-3">
      {GROUPS.map((g) => (
        <div key={g.name}>
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{g.name}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((item) => {
              if (item.kind === "band") {
                const Icon = item.band === "header" ? PanelTopDashed : PanelBottomDashed
                const label = item.band === "header" ? "文档页眉" : "文档页脚"
                const used = hasBand[item.band]
                return (
                  <button
                    key={item.band}
                    type="button"
                    disabled={used}
                    title={used ? `${label}已启用（画布中点击编辑）` : `启用${label}（每页固定，可插字段）`}
                    onClick={() => onAddBand(item.band)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      used ? "cursor-not-allowed border-dashed text-muted-foreground/50" : "hover:border-primary/40 hover:bg-primary/5"
                    }`}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{label}</span>
                  </button>
                )
              }
              const t = item.type
              const meta = BLOCK_META[t]
              const Icon = meta.icon
              const p1 = t === "barcode"
              return (
                <button
                  key={t}
                  type="button"
                  draggable={!p1}
                  disabled={p1}
                  title={p1 ? "条形码 P1 后补" : `拖入画布或点击追加「${meta.label}」`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_NEW, t)
                    e.dataTransfer.effectAllowed = "copy"
                  }}
                  onClick={() => !p1 && onAdd(t)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    p1
                      ? "cursor-not-allowed border-dashed text-muted-foreground/50"
                      : "cursor-grab hover:border-primary/40 hover:bg-primary/5 active:cursor-grabbing"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{meta.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        块按文档流从上到下堆叠、自动撑高、打印自动分页；页眉/页脚每页固定；需要并排放置时先拖入「行容器」再往栏内放块。
      </p>
    </div>
  )
}
