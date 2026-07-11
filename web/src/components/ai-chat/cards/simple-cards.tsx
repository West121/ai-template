/**
 * navigate 卡（§3.1 打开功能）与 link 卡（§3.6 快捷入口 chips）。
 */
import { useNavigate } from "react-router-dom"
import { ArrowRight, ArrowUpRight, Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AiLinkCard, AiNavigateCard } from "../types"

export function NavigateCard({ card }: { card: AiNavigateCard }) {
  const navigate = useNavigate()
  return (
    <div className="flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Compass className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{card.title}</p>
        {card.desc && <p className="truncate text-xs text-muted-foreground">{card.desc}</p>}
      </div>
      <Button size="sm" className="h-8 shrink-0 gap-1" onClick={() => navigate(card.path)}>
        打开 <ArrowRight className="size-3.5" />
      </Button>
    </div>
  )
}

export function LinkCard({ card }: { card: AiLinkCard }) {
  const navigate = useNavigate()
  return (
    <div className="flex w-full min-w-0 flex-wrap gap-2">
      {card.items.map((it) => (
        <button
          key={it.path}
          type="button"
          onClick={() => navigate(it.path)}
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ArrowUpRight className="size-3.5 text-muted-foreground" />
          {it.title}
        </button>
      ))}
    </div>
  )
}
