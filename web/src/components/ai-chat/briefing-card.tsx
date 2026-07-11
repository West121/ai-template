/**
 * 主动晨报卡（批D 亮点⑤）：每日首次打开面板置顶。汇总「今日 N 件急事 · M 个会议 · K 待阅」，
 * 逐行可点跳转（featureCode 走 route-registry；过渡期 path 直通；都解析不到则非可点纯文本）。
 * 「今日不再显示」→ 上层写 localStorage（shouldShowBriefing 次日自动恢复）。
 */
import { AlarmClock, CalendarClock, ChevronRight, Mail, Sparkles, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { resolveFeature } from "./route-registry"
import { briefingSummary } from "./panel-logic"
import type { AiBriefing, AiBriefingItem } from "./types"

function itemPath(it: AiBriefingItem): string | null {
  const byFeature = resolveFeature(it.featureCode, it.routeParams)
  if (byFeature) return byFeature
  // 过渡期：后端已校验 path 在可见菜单内
  return typeof it.path === "string" && it.path.startsWith("/") ? it.path : null
}

function kindIcon(kind: AiBriefingItem["kind"]) {
  if (kind === "MEETING") return <CalendarClock className="size-3.5 shrink-0 text-blue-500" />
  if (kind === "UNREAD") return <Mail className="size-3.5 shrink-0 text-emerald-500" />
  return <AlarmClock className="size-3.5 shrink-0 text-amber-500" />
}

export function BriefingCard({ briefing, onDismiss }: { briefing: AiBriefing; onDismiss: () => void }) {
  const navigate = useNavigate()
  const items = Array.isArray(briefing.items) ? briefing.items : []
  const summary = briefingSummary(briefing)

  return (
    <div className="w-full min-w-0 rounded-xl border border-primary/20 bg-primary/5 p-3 shadow-sm">
      <div className="mb-2 flex items-start gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">今日简报</p>
          {(summary || briefing.greeting) && (
            <p className="truncate text-[11px] text-muted-foreground">{summary || briefing.greeting}</p>
          )}
        </div>
        <button
          type="button"
          aria-label="今日不再显示"
          title="今日不再显示"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {items.length > 0 ? (
        <ul className="space-y-0.5">
          {items.map((it, i) => {
            const path = itemPath(it)
            const inner = (
              <>
                {kindIcon(it.kind)}
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                {it.meta && <span className="shrink-0 text-[10px] text-muted-foreground">{it.meta}</span>}
                {path && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
              </>
            )
            return (
              <li key={i}>
                {path ? (
                  <button
                    type="button"
                    onClick={() => navigate(path)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-2 py-1 text-xs text-muted-foreground">今天没有需要特别关注的事项，保持节奏就好。</p>
      )}
    </div>
  )
}
