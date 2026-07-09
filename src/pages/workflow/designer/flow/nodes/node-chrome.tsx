/**
 * 自定义节点共享外观：连线锚点样式、节点名标签、选中态高亮环、
 * 圆角矩形活动卡（ActivityCard）、菱形网关壳（GatewayShell）。
 */
import type { ComponentType, ReactNode } from "react"
import { Handle, Position } from "@xyflow/react"
import type { LucideProps } from "lucide-react"
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

/**
 * 圆角矩形活动卡（userTask/serviceTask/cc/ai/webhook/callActivity/subProcess 复用）。
 * headerClass 决定标题条底色、handleColor 决定锚点主题色（`!bg-*`）。
 */
export function ActivityCard({
  title,
  icon: Icon,
  headerClass,
  handleColor,
  selected,
  children,
  className,
}: {
  title: string
  icon: ComponentType<LucideProps>
  headerClass: string
  handleColor: string
  selected?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "w-52 overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md",
        selectedRing(selected),
        className,
      )}
    >
      <div className={cn("flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-white", headerClass)}>
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </div>
      {children && <div className="truncate px-3 py-2 text-xs text-muted-foreground">{children}</div>}
      <Handle type="target" position={Position.Top} className={handleClass(handleColor)} />
      <Handle type="source" position={Position.Bottom} className={handleClass(handleColor)} />
    </div>
  )
}

/**
 * 菱形网关壳（exclusive/parallel/inclusive 复用）：rotate-45 方块 + 反向旋转的居中图标。
 * 顶/底/右三个锚点，支持分叉多出边。
 */
export function GatewayShell({
  icon: Icon,
  name,
  colorClass,
  iconClass,
  handleColor,
  selected,
}: {
  icon: ComponentType<LucideProps>
  name: ReactNode
  /** 菱形边框 + 底色，如 "border-amber-500 bg-amber-500/10" */
  colorClass: string
  /** 图标颜色，如 "text-amber-600 dark:text-amber-400" */
  iconClass: string
  /** 锚点主题色，如 "!bg-amber-500" */
  handleColor: string
  selected?: boolean
}) {
  return (
    <div className="relative size-12">
      <div
        className={cn(
          "flex size-12 rotate-45 items-center justify-center rounded-md border-2 shadow-sm",
          colorClass,
          selectedRing(selected),
        )}
      >
        <Icon className={cn("size-4 -rotate-45", iconClass)} />
      </div>
      <NodeLabel>{name}</NodeLabel>
      <Handle type="target" position={Position.Top} className={handleClass(handleColor)} />
      <Handle type="source" position={Position.Bottom} className={handleClass(handleColor)} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass(handleColor)} />
    </div>
  )
}
