/**
 * list 卡（§3.4 结构化列表：待办/公文等）。
 * 窄面板用「堆叠行」：首列作主标题（可带行级 link），其余列 label·value 次级信息。
 * V2 批C：datasetId + page → **卡内分页**（GET /api/ai/datasets/{id}?pageNum=）；
 * moreFeatureCode 经 Registry 受控导航（旧 moreLink 兼容）。
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, ChevronLeft, ChevronRight, ListChecks, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { fetchDataset } from "../api"
import { resolveFeaturePath } from "../protocol"
import type { AiListCard, AiListRow } from "../types"

export function ListCard({ card }: { card: AiListCard }) {
  const navigate = useNavigate()
  const primaryKey = card.columns[0]?.key
  // 卡内分页态（数据集）；初始用卡自带 rows/page
  const [rows, setRows] = useState<AiListRow[]>(card.rows)
  const [page, setPage] = useState(card.page ?? null)
  const [loading, setLoading] = useState(false)

  const totalPages = page ? Math.max(1, Math.ceil(page.total / Math.max(1, page.size))) : 1
  const pageable = !!card.datasetId && !!page && page.total > page.size

  const goPage = async (pageNum: number) => {
    if (!card.datasetId || loading) return
    setLoading(true)
    try {
      const res = await fetchDataset(card.datasetId, pageNum, page?.size ?? 20)
      setRows(res.data.rows as AiListRow[])
      setPage(res.data.page)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  const morePath = card.moreLink ?? (card.moreFeatureCode ? resolveFeaturePath(card.moreFeatureCode) : null)

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <ListChecks className="size-4 text-primary" />
        <p className="text-sm font-semibold">{card.title}</p>
        <span className="ml-auto text-xs text-muted-foreground">{page ? `${page.total} 项` : `${rows.length} 项`}</span>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">暂无数据</div>
      ) : (
        <ul className={cn("divide-y", loading && "opacity-50")}>
          {rows.map((row, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!row.link}
                onClick={() => row.link && navigate(String(row.link))}
                className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left enabled:hover:bg-accent/50 disabled:cursor-default"
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", row.link && "text-primary")}>
                    {String(row[primaryKey] ?? "—")}
                  </p>
                  {card.columns.length > 1 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {card.columns
                        .slice(1)
                        .map((c) => `${c.label} ${String(row[c.key] ?? "—")}`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                {row.link && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 卡内分页（数据集） */}
      {pageable && page && (
        <div className="flex items-center justify-between border-t px-3.5 py-1.5">
          <button
            type="button"
            disabled={loading || page.current <= 1}
            onClick={() => void goPage(page.current - 1)}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-primary hover:bg-accent/50 disabled:cursor-default disabled:text-muted-foreground/50"
          >
            <ChevronLeft className="size-3.5" /> 上一页
          </button>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {loading && <Loader2 className="size-3 animate-spin" />}
            {page.current}/{totalPages} 页
          </span>
          <button
            type="button"
            disabled={loading || page.current >= totalPages}
            onClick={() => void goPage(page.current + 1)}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-primary hover:bg-accent/50 disabled:cursor-default disabled:text-muted-foreground/50"
          >
            下一页 <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      {morePath && (
        <button
          type="button"
          onClick={() => navigate(morePath)}
          className="flex w-full items-center justify-center gap-1 border-t px-3.5 py-2 text-xs text-primary hover:bg-accent/50"
        >
          查看全部 <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}
