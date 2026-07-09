/**
 * 自定义节点共享外观：连线锚点样式、节点名标签、选中/校验高亮环、
 * 圆角矩形活动卡（ActivityCard）、菱形网关壳（GatewayShell）、节点悬浮操作条（NodeToolbarActions）。
 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react"
import { Handle, NodeToolbar, Position } from "@xyflow/react"
import { Copy, Trash2, type LucideProps } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FormFieldOption } from "../../shared/config"

/**
 * 表单字段清单上下文（W-07）：供边/节点摘要把字段 **key** 映射为表单 **label** 展示
 * （画布显示「请假天数 大于 3」而非「days 大于 3」）。由 flow-designer 提供当前流程字段。
 */
export const FormFieldsContext = createContext<FormFieldOption[]>([])

/** 节点校验态（W-14 画布锚定）：error → destructive 环，warning → amber 环 */
export type ValidationRingState = "error" | "warning"

/**
 * 运行时跟踪高亮态（只读 FlowViewer 用）：completed → 绿描边，active → 主题色脉冲。
 * 与设计器编辑态解耦：设计器节点 data.highlight 恒为 undefined，仅实例详情跟踪图注入。
 */
export type NodeHighlightState = "completed" | "active"

/** 连线锚点基础样式（各节点按主题色再叠加 bg） */
export const handleClass = (extra?: string) =>
  cn("!size-2.5 !rounded-full !border-2 !border-background", extra)

/** 选中态高亮环 */
export function selectedRing(selected?: boolean): string | false {
  return Boolean(selected) && "ring-2 ring-primary ring-offset-2 ring-offset-background"
}

/**
 * 统一高亮环，优先级：校验错误/警告 > 运行时跟踪高亮 > 选中态。
 * 校验错误走 `--destructive` token（亮/暗自适应）；运行时 completed 绿描边、active 主题色脉冲
 *（`wf-hl-active` 的脉冲动画在 FlowViewer 的 `<style>` 内定义，设计器态不触发）；皆无时回落到选中环。
 */
export function nodeRing(
  selected?: boolean,
  validation?: ValidationRingState,
  highlight?: NodeHighlightState,
): string | false {
  if (validation === "error") return "ring-2 ring-destructive ring-offset-2 ring-offset-background"
  if (validation === "warning") return "ring-2 ring-amber-500 ring-offset-2 ring-offset-background"
  if (highlight === "active") return "ring-2 ring-primary wf-hl-active"
  if (highlight === "completed") return "ring-2 ring-emerald-500"
  return selectedRing(selected)
}

/* ============================================================
 * 节点悬浮操作（删除/复制）—— W-12
 * ============================================================ */

export interface NodeActions {
  /** 复制节点（深拷贝 data + 偏移 + 选中新节点） */
  copy: (id: string) => void
  /** 删除节点（连同关联边） */
  remove: (id: string) => void
}

/** 由 flow-designer 通过 Provider 注入删除/复制实现，节点组件消费（零 prop drilling） */
export const NodeActionsContext = createContext<NodeActions | null>(null)

/**
 * 节点选中时右上角浮出的操作条（react-flow 官方 NodeToolbar，零新依赖）。
 * 亮/暗走 popover/accent/destructive token。
 */
export function NodeToolbarActions({ id }: { id: string }) {
  const actions = useContext(NodeActionsContext)
  if (!actions) return null
  return (
    <NodeToolbar position={Position.Top} align="end" offset={6}>
      <div className="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-sm">
        <button
          type="button"
          aria-label="复制节点"
          title="复制"
          className="rounded p-1 hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation()
            actions.copy(id)
          }}
        >
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="删除节点"
          title="删除"
          className="rounded p-1 text-destructive hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation()
            actions.remove(id)
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </NodeToolbar>
  )
}

/** 圆形/菱形节点下方的名称标签（W-04：限宽截断，避免长名横向溢出压邻居） */
export function NodeLabel({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-1/2 top-full mt-1.5 max-w-[8rem] -translate-x-1/2 truncate text-center text-xs font-medium text-foreground">
      {children}
    </div>
  )
}

/**
 * 圆角矩形活动卡（userTask/serviceTask/cc/ai/webhook/callActivity/subProcess 复用）。
 * headerClass 决定标题条底色、handleColor 决定锚点主题色（`!bg-*`）。
 */
export function ActivityCard({
  id,
  title,
  icon: Icon,
  headerClass,
  handleColor,
  selected,
  validation,
  highlight,
  children,
  className,
}: {
  /** 节点 id（用于悬浮操作条）；缺省则不渲染操作条 */
  id?: string
  title: string
  icon: ComponentType<LucideProps>
  headerClass: string
  handleColor: string
  selected?: boolean
  validation?: ValidationRingState
  highlight?: NodeHighlightState
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "w-52 overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md",
        nodeRing(selected, validation, highlight),
        className,
      )}
    >
      {id && <NodeToolbarActions id={id} />}
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
  id,
  icon: Icon,
  name,
  colorClass,
  iconClass,
  handleColor,
  selected,
  validation,
  highlight,
}: {
  /** 节点 id（用于悬浮操作条）；缺省则不渲染操作条 */
  id?: string
  icon: ComponentType<LucideProps>
  name: ReactNode
  /** 菱形边框 + 底色，如 "border-amber-500 bg-amber-500/10" */
  colorClass: string
  /** 图标颜色，如 "text-amber-600 dark:text-amber-400" */
  iconClass: string
  /** 锚点主题色，如 "!bg-amber-500" */
  handleColor: string
  selected?: boolean
  validation?: ValidationRingState
  highlight?: NodeHighlightState
}) {
  return (
    <div className="relative size-12">
      {id && <NodeToolbarActions id={id} />}
      <div
        className={cn(
          "flex size-12 rotate-45 items-center justify-center rounded-md border-2 shadow-sm",
          colorClass,
          nodeRing(selected, validation, highlight),
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
