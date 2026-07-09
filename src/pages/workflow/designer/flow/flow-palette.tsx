/**
 * 左侧节点调色板：分组罗列可新增节点，支持拖拽到画布或点击新增。
 *  - 拖拽：onDragStart 写入 PALETTE_DND_MIME=调色板条目 key，画布 onDrop 据落点新增。
 *  - 点击：onPick(key) 由上层在默认位置新增。
 */
import type { DragEvent } from "react"
import { cn } from "@/lib/utils"
import { PALETTE_DND_MIME, PALETTE_GROUPS, type PaletteItem } from "./node-catalog"

export function FlowPalette({ onPick }: { onPick: (key: string) => void }) {
  const handleDragStart = (e: DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData(PALETTE_DND_MIME, item.key)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div className="flex w-40 shrink-0 flex-col gap-3 overflow-y-auto border-r bg-muted/20 p-2.5">
      <p className="px-0.5 text-xs leading-tight text-muted-foreground">拖拽到画布，或点击在画布中央新增</p>
      {PALETTE_GROUPS.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <div className="px-0.5 text-xs font-medium text-foreground/80">{group.title}</div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onClick={() => onPick(item.key)}
                  className={cn(
                    "flex w-full cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-accent active:cursor-grabbing",
                  )}
                >
                  <Icon className={cn("size-3.5 shrink-0", item.colorClass)} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
