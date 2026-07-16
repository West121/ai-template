/**
 * devDiff 卡（Dev Studio 批W2 · docs/design/dev-studio.md §2）：AI `dev_propose_change` 的变更提案确认卡。
 * payload：{actionId, assetType, code, name, oldContent, newContent, summary, baseVersion, publish?}
 * 复用二段式基座：confirm-machine（状态机）+ ai-action-outcomes（重挂不复活）+ buildLineDiff（行级 diff）。
 * 大 JSON 性能：未变段落默认折叠（改动前后各留 3 行上下文），「展开全部」再全铺。
 * 确认成功 → 广播 `dev-studio:asset-changed`（工作台监听后刷新中栏资产）；失败（资产被改）→ 终态失败 + 重新发起提示。
 * 防白屏：old/new 非串容错；外层 ErrorBoundary。
 */
import { Fragment, useMemo, useReducer, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CheckCircle2, ChevronsUpDown, ExternalLink, GitCompare, RotateCw } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ErrorBoundary } from "@/components/error-boundary"
import { buildLineDiff, type DiffOp } from "@/pages/knowledge/diff-util"
import { cancelActionV2, confirmActionV2 } from "../api"
import { friendlyAiError, ulid, type AiMessagePart } from "../protocol"
import { CONFIRM_INITIAL, confirmReducer, type ConfirmCardState } from "./confirm-machine"
import { getAiActionOutcome, recordAiActionOutcome, type AiActionOutcome } from "@/stores/ai-action-outcomes"

const ASSET_LABEL: Record<string, string> = {
  ORCH: "自动化编排",
  PROCESS: "流程定义",
  FORM: "在线表单",
  BIZDOC_TPL: "打印模板",
}

/** 结果 store 终态 → 状态机初态（关面板重开不复活，照 knowledge-save/confirm 模式） */
function initState(actionId: string): ConfirmCardState {
  const o: AiActionOutcome | undefined = getAiActionOutcome(actionId)
  if (!o) return CONFIRM_INITIAL
  switch (o.status) {
    case "done":
      return { state: "done", resultMessage: o.resultMessage, resultLink: o.resultLink }
    case "cancelled":
      return { state: "cancelled" }
    case "expired":
      return { state: "expired" }
    case "stale":
      return { state: "stale", error: o.error }
    default:
      return CONFIRM_INITIAL
  }
}

/** diff 分段：未变 run 超过 2×context+1 行时折叠中段（改动上下各留 context 行） */
type DiffSegment = { kind: "ops"; ops: DiffOp[] } | { kind: "collapsed"; count: number; ops: DiffOp[] }

function collapseDiff(ops: DiffOp[], context = 3): DiffSegment[] {
  const segs: DiffSegment[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type !== "same") {
      const run: DiffOp[] = []
      while (i < ops.length && ops[i].type !== "same") run.push(ops[i++])
      segs.push({ kind: "ops", ops: run })
      continue
    }
    const run: DiffOp[] = []
    while (i < ops.length && ops[i].type === "same") run.push(ops[i++])
    const isFirst = segs.length === 0
    const isLast = i >= ops.length
    const head = isFirst ? 0 : context // 开头段不需要给"上一处改动"留下文
    const tail = isLast ? 0 : context
    if (run.length > head + tail + 1) {
      if (head > 0) segs.push({ kind: "ops", ops: run.slice(0, head) })
      segs.push({ kind: "collapsed", count: run.length - head - tail, ops: run.slice(head, run.length - tail) })
      if (tail > 0) segs.push({ kind: "ops", ops: run.slice(run.length - tail) })
    } else {
      segs.push({ kind: "ops", ops: run })
    }
  }
  return segs
}

function DiffLine({ op }: { op: DiffOp }) {
  return (
    <div
      className={cn(
        "whitespace-pre px-2",
        op.type === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        op.type === "del" && "bg-rose-500/10 text-rose-700 line-through dark:text-rose-400",
        op.type === "same" && "text-muted-foreground",
      )}
    >
      {op.type === "add" ? "+ " : op.type === "del" ? "- " : "  "}
      {op.text || " "}
    </div>
  )
}

function DevDiffInner({ part }: { part: AiMessagePart }) {
  const navigate = useNavigate()
  const p = part.payload
  const actionId = String(p.actionId ?? "")
  const assetType = String(p.assetType ?? "")
  const code = String(p.code ?? "")
  const name = typeof p.name === "string" && p.name ? p.name : code
  const summary = typeof p.summary === "string" ? p.summary : ""
  const publish = p.publish === true
  // 防白屏：old/new 非串容错为串
  const oldContent = typeof p.oldContent === "string" ? p.oldContent : p.oldContent == null ? "" : String(p.oldContent)
  const newContent = typeof p.newContent === "string" ? p.newContent : p.newContent == null ? "" : String(p.newContent)

  const [s, dispatch] = useReducer(confirmReducer, actionId, initState)
  const [expandAll, setExpandAll] = useState(false)
  const idemKeyRef = useRef<string | null>(null)

  const ops = useMemo(() => buildLineDiff(oldContent, newContent), [oldContent, newContent])
  const segments = useMemo(() => collapseDiff(ops), [ops])
  const changed = useMemo(() => ops.filter((o) => o.type !== "same").length, [ops])

  const doConfirm = async () => {
    if (!idemKeyRef.current) idemKeyRef.current = ulid()
    dispatch({ type: "CONFIRM" })
    try {
      const res = await confirmActionV2(actionId, idemKeyRef.current)
      const r = res.data
      if (r.status === "EXECUTING") dispatch({ type: "EXECUTING" })
      if (r.ok) {
        dispatch({ type: "SUCCESS", message: r.message, resultLink: r.resultLink })
        recordAiActionOutcome(actionId, { status: "done", resultMessage: r.message, resultLink: r.resultLink })
        // 通知工作台刷新中栏资产（确认成功 → 资产已写新版本）
        window.dispatchEvent(new CustomEvent("dev-studio:asset-changed", { detail: { assetType, code } }))
      } else if (r.expired) {
        dispatch({ type: "FAILURE", expired: true })
        recordAiActionOutcome(actionId, { status: "expired" })
      } else {
        // 执行失败（如资产已被人改）→ 终态失败：message + 重新发起提示
        const msg = r.message ?? "资产已被修改，请重新发起"
        dispatch({ type: "FAILURE", stale: true, error: msg })
        recordAiActionOutcome(actionId, { status: "stale", error: msg })
      }
    } catch (err) {
      const text = friendlyAiError(err, "执行失败")
      toast.error(text)
      dispatch({ type: "FAILURE", error: text })
    }
  }

  const doCancel = () => {
    dispatch({ type: "CANCEL" })
    recordAiActionOutcome(actionId, { status: "cancelled" })
    void cancelActionV2(actionId).catch(() => undefined)
  }

  const busy = s.state === "submitting" || s.state === "executing"

  return (
    <div className={cn("w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm", publish && "border-destructive/40 border-l-4 border-l-destructive")}>
      {/* 头部：资产徽标 + name/code + 需确认 */}
      <div className="mb-1.5 flex items-center gap-2">
        <GitCompare className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          变更提案 · {name}
          <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">{code}</span>
        </p>
        <Badge variant="outline" className="h-4.5 shrink-0 px-1.5 text-[10px]">{ASSET_LABEL[assetType] ?? assetType}</Badge>
        <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">需确认</span>
      </div>
      {summary && <p className="mb-2 break-words text-xs text-muted-foreground">{summary}</p>}

      {/* diff 主体：未变段折叠（±3 行上下文）+ 展开全部 */}
      <div className="mb-2 max-h-72 min-w-0 overflow-auto rounded-md border bg-background font-mono text-[11px] leading-5">
        {segments.map((seg, i) =>
          seg.kind === "ops" || expandAll ? (
            <Fragment key={i}>
              {seg.ops.map((op, j) => (
                <DiffLine key={j} op={op} />
              ))}
            </Fragment>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => setExpandAll(true)}
              className="flex w-full items-center justify-center gap-1 border-y border-dashed bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
            >
              <ChevronsUpDown className="size-3" /> 折叠 {seg.count} 行未变 · 点击展开全部
            </button>
          ),
        )}
        {ops.length === 0 && <p className="px-2 py-3 text-center text-muted-foreground">（无内容差异）</p>}
      </div>

      {/* 生效面提示 */}
      <p className={cn("mb-2 flex items-center gap-1.5 text-[11px]", publish ? "text-destructive" : "text-muted-foreground")}>
        {publish
          ? "确认后将保存并发布，立即对新发起/新触发生效（运行中实例不受影响）。"
          : "确认后仅保存为草稿，需在工作台/设计器发布后才生效。"}
        <span className="ml-auto shrink-0 tabular-nums">基于 v{String(p.baseVersion ?? "?")} · {changed} 行改动</span>
      </p>

      {/* 状态区（confirm-machine） */}
      {s.state === "done" ? (
        <div aria-live="polite" className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> {s.resultMessage ?? "已应用变更"}
          </span>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(s.resultLink ?? "/dev-studio")}>
            在工作台查看 <ExternalLink className="size-3" />
          </Button>
        </div>
      ) : s.state === "cancelled" ? (
        <p className="text-xs text-muted-foreground">已取消</p>
      ) : s.state === "expired" ? (
        <p className="text-xs text-muted-foreground">此提案已过期，请重新发起</p>
      ) : s.state === "stale" ? (
        <div aria-live="polite" className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-2 text-xs text-rose-600">
          <RotateCw className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{s.error ?? "资产已被修改，请重新发起"}（可在右栏重新描述需求发起新提案）</span>
        </div>
      ) : (
        <div className="space-y-2">
          {s.error && <p className="text-xs text-destructive">{s.error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={doCancel}>
              取消
            </Button>
            <Button variant={publish ? "destructive" : "default"} size="sm" className="h-8" disabled={s.state !== "idle"} onClick={() => void doConfirm()}>
              {s.state === "submitting" ? "提交中…" : s.state === "executing" ? "执行中…" : publish ? "确认并发布" : "确认改写"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function DevDiffPart({ part }: { part: AiMessagePart }) {
  return (
    <ErrorBoundary label="dev-diff">
      <DevDiffInner part={part} />
    </ErrorBoundary>
  )
}
