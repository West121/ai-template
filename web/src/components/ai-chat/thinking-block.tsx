/**
 * 「思考中」折叠态块（丹青 ai-thinking-status.md）：替换旧 ToolStatusBar 的平铺多行。
 *
 * 三态头**永远一行**：进行中（主色 Sparkles 呼吸，显当前运行步 displayName，无则「思考中…」）/
 * 完成（灰「✦ 已完成 · N 步 ▸」）/ 有失败（琥珀「部分步骤失败 · N 步」）。默认收起，点开看每步明细
 * （复用原 spinner/绿勾/红叉行视觉）。`phase="done" && steps.length===0` → 返回 null（纯文本直答不留空块）。
 *
 * 内部**不写 `ml-9`**（缩进交调用方：流式独立态外层套 ml-9，并入消息列时不套）。
 * 动效全部 motion-reduce 降级；aria-expanded/controls 关联展开体。
 */
import { useId, useState } from "react"
import { Check, ChevronRight, Loader2, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolStatusItem } from "./api"

export function ThinkingBlock({
  steps,
  phase,
  defaultOpen = false,
}: {
  steps: ToolStatusItem[]
  /** active=流式中；done=消息落地后 */
  phase: "active" | "done"
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const running = steps.find((s) => s.state === "running")
  const failed = steps.some((s) => s.state === "failed")
  const n = steps.length

  // 无步骤且已完成 → 不渲染回看块（纯文本直答，没什么可追溯）
  if (phase === "done" && n === 0) return null

  const head =
    phase === "active"
      ? { text: running?.displayName ?? "思考中…", tone: "active" as const }
      : failed
        ? { text: `部分步骤失败 · ${n} 步`, tone: "warn" as const }
        : { text: `已完成 · ${n} 步`, tone: "done" as const }

  return (
    <div className="w-fit min-w-0 max-w-full">
      {/* 折叠头（整行可点，永远一行高度） */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs transition-colors motion-reduce:transition-none",
          head.tone === "active" && "border-primary/30 bg-primary/5 text-primary",
          head.tone === "done" && "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
          head.tone === "warn" && "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
        )}
      >
        <Sparkles className={cn("size-3.5 shrink-0", head.tone === "active" && "animate-pulse text-primary motion-reduce:animate-none")} />
        <span className="min-w-0 truncate">{head.text}</span>
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
      </button>

      {/* 展开体：每步明细（复用原 ToolStatusBar 行视觉） */}
      {open && (
        <ul id={panelId} className="mt-1 flex flex-col gap-1 rounded-lg border bg-muted/20 px-2.5 py-1.5">
          {steps.map((t) => (
            <li key={t.id || t.displayName} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t.state === "running" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
              ) : t.state === "done" ? (
                <Check className="size-3.5 shrink-0 text-emerald-500" />
              ) : (
                <X className="size-3.5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 truncate">{t.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
