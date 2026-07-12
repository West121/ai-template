/**
 * confirm 卡（V2 §7 持久化动作草稿）：LLM 只出卡，用户点「确认」→
 * POST /api/ai/actions/{id}/confirm（**Idempotency-Key**：首次点击生成 ULID，重试沿用同一 key）；
 * 「取消」→ /cancel（端点不可用静默）。§22 错误 → expired（410）/ stale（AI_ACTION_STALE，
 * 状态已变化请重新查询，终态）/ 可重试文案。danger=红色语义（左描边 + destructive 键）；
 * 状态机含 EXECUTING 见 confirm-machine.ts（纯 reducer，可测）。
 */
import { Fragment, useReducer, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, GitBranch, RotateCw, ShieldCheck, UserRound } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { cancelActionV2, confirmActionV2 } from "../api"
import { friendlyAiError, ulid } from "../protocol"
import type { AiConfirmCard } from "../types"
import { CONFIRM_INITIAL, confirmReducer } from "./confirm-machine"
import { AiSummaryBlock } from "./ai-summary"

/** 批E⑩ 流程预测链：通过后流转 签发(王经理)→用印→归档 */
function PredictChain({ steps }: { steps: NonNullable<AiConfirmCard["predictChain"]> }) {
  if (steps.length === 0) return null
  return (
    <div className="mb-3 rounded-lg border border-dashed bg-muted/30 p-2.5">
      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <GitBranch className="size-3 text-primary" /> 通过后流转
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px]">
              <span className="min-w-0 truncate font-medium">{s.stepName}</span>
              {s.assigneeName && (
                <span className="flex shrink-0 items-center gap-0.5 text-[9px] text-muted-foreground">
                  <UserRound className="size-2.5" />
                  {s.assigneeName}
                </span>
              )}
            </span>
            {i < steps.length - 1 && <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ConfirmCard({ card }: { card: AiConfirmCard }) {
  const navigate = useNavigate()
  const [s, dispatch] = useReducer(confirmReducer, CONFIRM_INITIAL)
  // 幂等键：同一动作的重试沿用同一 key（服务端幂等去重，§7.3）
  const idemKeyRef = useRef<string | null>(null)

  const doConfirm = async () => {
    if (!idemKeyRef.current) idemKeyRef.current = ulid()
    dispatch({ type: "CONFIRM" })
    try {
      const res = await confirmActionV2(card.actionId, idemKeyRef.current)
      const r = res.data
      if (r.status === "EXECUTING") dispatch({ type: "EXECUTING" })
      if (r.ok) {
        dispatch({ type: "SUCCESS", message: r.message, resultLink: r.resultLink })
      } else {
        dispatch({ type: "FAILURE", expired: r.expired, stale: r.stale, error: r.message })
      }
    } catch (err) {
      const text = friendlyAiError(err, "执行失败")
      toast.error(text)
      dispatch({ type: "FAILURE", error: text })
    }
  }

  const doCancel = () => {
    dispatch({ type: "CANCEL" })
    // 服务端草稿标记取消（V2；旧后端/离线静默成功）
    void cancelActionV2(card.actionId).catch(() => undefined)
  }

  const busy = s.state === "submitting" || s.state === "executing"

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
        <p className="min-w-0 flex-1 text-sm font-semibold">{card.title}</p>
        <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">需确认</span>
      </div>
      {card.summary && <p className="mb-3 text-xs text-muted-foreground">{card.summary}</p>}

      {/* 批E⑨ 审批 AI 摘要（3 行 + 风险点） */}
      {card.aiSummary && <AiSummaryBlock data={card.aiSummary} className="mb-3" />}

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

      {/* 批E⑩ 通过后流转预测链（同意按钮上方） */}
      {card.predictChain && card.predictChain.length > 0 && <PredictChain steps={card.predictChain} />}

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
      ) : s.state === "stale" ? (
        <div aria-live="polite" className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">
          <RotateCw className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{s.error ?? "该对象状态已经变化，请重新查询后再操作。"}</span>
        </div>
      ) : (
        <div className="space-y-2">
          {s.error && <p className="text-xs text-destructive">{s.error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {card.expiresAt && (
              <span className="mr-auto text-[10px] text-muted-foreground">
                有效期至 {card.expiresAt.slice(0, 16).replace("T", " ")}
              </span>
            )}
            <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={doCancel}>
              取消
            </Button>
            <Button
              variant={card.danger ? "destructive" : "default"}
              size="sm"
              className="h-8"
              disabled={s.state !== "idle"}
              onClick={() => void doConfirm()}
            >
              {s.state === "submitting" ? "提交中…" : s.state === "executing" ? "执行中…" : "确认"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
