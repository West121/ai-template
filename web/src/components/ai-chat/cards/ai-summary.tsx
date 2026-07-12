/**
 * 批E 亮点⑨ 审批 AI 摘要块（confirm 卡 / list 待办项复用）：
 * 3 行摘要 + 风险点（高=红 / 中=黄 / 其它=中性）+ 顶部"AI 生成仅供参考"。
 * 输入为已归一的 AiSummary（parseAiSummary），此处只负责呈现。
 */
import { Sparkles, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { riskTone } from "../protocol"
import type { AiSummary } from "../types"

const TONE_CLS: Record<"high" | "medium" | "low", string> = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
  low: "bg-muted text-muted-foreground border-border",
}

export function AiSummaryBlock({ data, className }: { data: AiSummary; className?: string }) {
  const risks = data.risks ?? []
  return (
    <div className={cn("rounded-lg border border-dashed bg-muted/30 p-2.5", className)}>
      <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Sparkles className="size-3 text-primary" />
        AI 摘要 · 生成内容仅供参考
      </p>
      {data.summary && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">{data.summary}</p>}
      {risks.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {risks.map((r, i) => (
            <li key={i}>
              <span
                className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", TONE_CLS[riskTone(r.level)])}
              >
                <TriangleAlert className="size-2.5 shrink-0" />
                <span className="min-w-0 break-words">{r.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
