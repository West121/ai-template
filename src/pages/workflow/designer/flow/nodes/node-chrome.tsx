/**
 * 自定义节点共享外观：连线锚点样式、节点名标签、选中态高亮环。
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** 连线锚点基础样式（各节点按主题色再叠加 bg） */
export const handleClass = (extra?: string) =>
  cn("!size-2.5 !rounded-full !border-2 !border-background", extra)

/** 选中态高亮环 */
export function selectedRing(selected?: boolean): string | false {
  return Boolean(selected) && "ring-2 ring-primary ring-offset-2 ring-offset-background"
}

/** 圆形/菱形节点下方的名称标签 */
export function NodeLabel({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-center text-xs font-medium text-foreground">
      {children}
    </div>
  )
}
