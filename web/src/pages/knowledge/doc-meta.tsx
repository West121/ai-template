/**
 * 文档 AI 元信息（批3）：AI 摘要卡（标「AI 生成」）+ 标签 chips（AI 自动 vs 手动区分来源）。
 * 磐石批3后端保存后生成 summary(kb_doc.summary) + 自动标签；无摘要/无标签则不渲染（空态不占位）。
 */
import { Sparkles, Tag } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { KbTag } from "./types"

export function DocMeta({ summary, tags }: { summary?: string; tags?: KbTag[] }) {
  const list = Array.isArray(tags) ? tags : []
  const hasSummary = !!summary && summary.trim().length > 0
  if (!hasSummary && list.length === 0) return null

  return (
    <div className="mb-3 space-y-2">
      {hasSummary && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" /> AI 摘要
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-normal text-primary">AI 生成</span>
          </div>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
      )}
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="size-3.5 shrink-0 text-muted-foreground" aria-label="标签" />
          {list.map((t) => (
            <Badge key={t.id} variant="outline" className={cn("gap-1 font-normal", t.source === "AI" && "border-primary/30 text-primary")}>
              {t.source === "AI" && <Sparkles className="size-2.5" />}
              {t.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
