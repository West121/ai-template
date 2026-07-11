/**
 * 元素库（§9.2 左栏，分组对齐参考图：布局容器/表头区域/信息区域/表格区域/其他元素）。
 * 拖入画布按文档流插入；点击=追加到末尾。
 */
import type { BdBlockType } from "@/components/bizdoc/model-v2"
import { BLOCK_META, DND_NEW } from "./meta"

const GROUPS: { name: string; types: BdBlockType[] }[] = [
  { name: "布局容器", types: ["row"] },
  { name: "表头区域", types: ["title", "docInfo"] },
  { name: "信息区域", types: ["labelField", "infoTable", "text"] },
  { name: "表格区域", types: ["detailTable", "approvalTable"] },
  { name: "其他元素", types: ["signature", "qrcode", "barcode", "image", "divider", "spacer"] },
]

export function Palette({ onAdd }: { onAdd: (type: BdBlockType) => void }) {
  return (
    <div className="space-y-3 overflow-y-auto p-3">
      {GROUPS.map((g) => (
        <div key={g.name}>
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{g.name}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {g.types.map((t) => {
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
        块按文档流从上到下堆叠、自动撑高、打印自动分页；需要并排放置时先拖入「行容器」再往栏内放块。
      </p>
    </div>
  )
}
