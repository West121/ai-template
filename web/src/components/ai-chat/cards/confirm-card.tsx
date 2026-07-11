/**
 * confirm 卡（§3.2 变更类二段式确认）：LLM 只出卡，用户点「确认」→ POST /api/ai/confirm 执行。
 * danger=红色语义（左描边 + destructive 键）；状态机 idle/submitting/done/cancelled/expired
 * 见 confirm-machine.ts（纯 reducer，可测）。
 */
import { Fragment, useReducer } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { confirmAction } from "../api"
import type { AiConfirmCard } from "../types"
import { CONFIRM_INITIAL, confirmReducer } from "./confirm-machine"

export function ConfirmCard({ card }: { card: AiConfirmCard }) {
  const navigate = useNavigate()
  const [s, dispatch] = useReducer(confirmReducer, CONFIRM_INITIAL)

  const doConfirm = async () => {
    dispatch({ type: "CONFIRM" })
    try {
      const res = await confirmAction(card.actionId)
      if (res.data.ok) {
        dispatch({ type: "SUCCESS", message: res.data.message, resultLink: res.data.resultLink })
      } else {
        dispatch({ type: "FAILURE", expired: res.data.expired })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "执行失败")
      dispatch({ type: "FAILURE" })
    }
  }

  return (
    <div
      className={cn(
        "w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm",
        card.danger && "border-destructive/40 border-l-4 border-l-destructive",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {card.danger ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : (
          <ShieldCheck className="size-4 shrink-0 text-primary" />
        )}
        <p className="text-sm font-semibold">{card.title}</p>
      </div>
      {card.summary && <p className="mb-3 text-xs text-muted-foreground">{card.summary}</p>}

      {card.params && card.params.length > 0 && (
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-muted/50 p-2.5 text-xs">
          {card.params.map((p) => (
            <Fragment key={p.label}>
              <dt className="text-muted-foreground">{p.label}</dt>
              <dd className="min-w-0 break-words font-medium">{p.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {/* 按钮区按状态机呈现 */}
      {s.state === "done" ? (
        <div aria-live="polite" className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {s.resultMessage ?? "已执行"}
          </span>
          {s.resultLink && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(s.resultLink!)}>
              查看结果 <ExternalLink className="size-3" />
            </Button>
          )}
        </div>
      ) : s.state === "cancelled" ? (
        <p className="text-xs text-muted-foreground">已取消</p>
      ) : s.state === "expired" ? (
        <div className="space-y-2">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8" disabled>
              取消
            </Button>
            <Button variant={card.danger ? "destructive" : "default"} size="sm" className="h-8" disabled>
              确认
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">此操作已过期，请重新发起</p>
        </div>
      ) : (
        <div className="space-y-2">
          {s.error && <p className="text-xs text-destructive">{s.error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={s.state === "submitting"}
              onClick={() => dispatch({ type: "CANCEL" })}
            >
              取消
            </Button>
            <Button
              variant={card.danger ? "destructive" : "default"}
              size="sm"
              className="h-8"
              disabled={s.state !== "idle"}
              onClick={() => void doConfirm()}
            >
              {s.state === "submitting" ? "执行中…" : "确认"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
