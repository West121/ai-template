/**
 * list 卡（§3.4 结构化列表：待办/公文等）。
 * 窄面板用「堆叠行」：首列作主标题（可带行级 link），其余列 label·value 次级信息；moreLink 底部入口。
 */
import { useNavigate } from "react-router-dom"
import { ArrowRight, ChevronRight, ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AiListCard } from "../types"

export function ListCard({ card }: { card: AiListCard }) {
  const navigate = useNavigate()
  const primaryKey = card.columns[0]?.key
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <ListChecks className="size-4 text-primary" />
        <p className="text-sm font-semibold">{card.title}</p>
        <span className="ml-auto text-xs text-muted-foreground">{card.rows.length} 项</span>
      </div>

      {card.rows.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">暂无数据</div>
      ) : (
        <ul className="divide-y">
          {card.rows.map((row, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!row.link}
                onClick={() => row.link && navigate(row.link)}
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

      {card.moreLink && (
        <button
          type="button"
          onClick={() => navigate(card.moreLink!)}
          className="flex w-full items-center justify-center gap-1 border-t px-3.5 py-2 text-xs text-primary hover:bg-accent/50"
        >
          查看全部 <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}
