/**
 * 工作流 P3 · 实例详情高级能力入口与面板。
 *
 *  - 流程预测：POST instances/{id}/predict → 可视化后续将经过节点 + 预计审批人（节点链）
 *  - 打印套打：打开 WfPrintView（见 wf-print.tsx）
 *  - 唤醒：已结束实例（管理员）按快照重建 + 定位节点重审 → POST instances/{id}/resurrect
 *  - 子流程入口：subInstances 有值时点击跳转子实例详情
 *
 * 后端 P3 端点未就绪时优雅降级（提示接口未就绪，不造假数据）。
 */
import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Bot,
  ExternalLink,
  GitBranch,
  GitFork,
  Loader2,
  Printer,
  RotateCcw,
  Send,
  Sparkles,
  Timer,
  UserCheck,
  Workflow,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, NetworkError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/modal"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { WF_STATUS_META, type FormSchema, type WfFormData } from "@/types/workflow"
import type { WfInstanceDetailP3, WfPredictNode, WfPredictResult, WfSubInstance } from "@/types/workflow-p3"
import { WfPrintView } from "./wf-print"

/* ---------------- 节点类型 → 图标 ---------------- */

const NODE_ICON: Record<string, typeof UserCheck> = {
  approval: UserCheck,
  cc: Send,
  condition: GitFork,
  subprocess: Workflow,
  timer: Timer,
  trigger: Zap,
  ai: Bot,
  end: GitBranch,
}

/* ---------------- 流程预测面板 ---------------- */

function PredictChain({ path }: { path: WfPredictNode[] }) {
  if (path.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">无后续节点（流程即将结束）</div>
  }
  return (
    <div className="space-y-0 py-1">
      {path.map((node, index) => {
        const Icon = NODE_ICON[node.type] ?? UserCheck
        return (
          <div key={`${node.nodeId}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
            {index < path.length - 1 && <div className="absolute left-[15px] top-8 h-full w-px bg-border" />}
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-primary/5 text-primary">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{node.nodeName}</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
                  预计第 {index + 1} 步
                </Badge>
              </div>
              {node.assignees && node.assignees.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {node.assignees.map((a, i) => (
                    <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {a.name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">审批人：按规则运行时确定</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PredictModal({
  instanceId,
  open,
  onClose,
}: {
  instanceId: number
  open: boolean
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<WfPredictResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await api<WfPredictResult>(`/api/wf/instances/${instanceId}/predict`, { method: "POST" })
      setResult(data)
    } catch (err) {
      if (err instanceof NetworkError) setError("后端未启动，无法预测")
      else if (err instanceof ApiError) setError(err.message || "预测接口尚未就绪")
      else setError("预测失败")
    } finally {
      setLoading(false)
    }
  }, [instanceId])

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> 流程预测
        </span>
      }
      description="按当前表单值静态演算后续将经过的节点与预计审批人（不落库）"
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button className="gap-1.5" disabled={loading} onClick={() => void run()}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {result ? "重新预测" : "开始预测"}
          </Button>
        </>
      }
    >
      <div className="min-h-40">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-sm">正在演算路径…</span>
          </div>
        )}
        {!loading && error && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            {error}
          </div>
        )}
        {!loading && !error && !result && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            点击「开始预测」演算后续审批路径
          </div>
        )}
        {!loading && result && (
          <>
            <PredictChain path={result.path} />
            {result.note && (
              <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{result.note}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- 唤醒（已结束实例重新进入审批） ---------------- */

function ResurrectDialog({
  detail,
  open,
  onClose,
  onReload,
}: {
  detail: WfInstanceDetailP3
  open: boolean
  onClose: () => void
  onReload: () => void
}) {
  // 候选唤醒节点：优先 jumpTargets，否则从时间线去重节点
  const candidates =
    detail.jumpTargets && detail.jumpTargets.length > 0
      ? detail.jumpTargets.map((t) => ({ nodeId: t.nodeId, name: t.name }))
      : Array.from(
          new Map(
            (detail.timeline ?? [])
              .filter((t) => t.nodeId)
              .map((t) => [t.nodeId, { nodeId: t.nodeId as string, name: t.nodeName ?? (t.nodeId as string) }]),
          ).values(),
        )

  const [nodeId, setNodeId] = useState("")
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!nodeId) {
      toast.error("请选择唤醒定位节点")
      return
    }
    setSubmitting(true)
    try {
      await api(`/api/wf/instances/${detail.id}/resurrect`, {
        method: "POST",
        body: JSON.stringify({ nodeId, comment: comment.trim() || undefined }),
      })
      toast.success("已唤醒：按快照重建实例并定位重审")
      onClose()
      onReload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "唤醒失败（接口可能尚未就绪）")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !submitting && onClose()}
      title="唤醒流程"
      description="已结束实例按快照重建新实例，定位到所选节点重新审批（原实例不变）"
      width={440}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "唤醒中…" : "确认唤醒"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">唤醒定位节点</Label>
          {candidates.length > 0 ? (
            <Select value={nodeId || undefined} onValueChange={setNodeId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择重新进入的节点" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.nodeId} value={c.nodeId}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={nodeId} onChange={(e) => setNodeId(e.target.value)} placeholder="输入节点 id" />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">唤醒说明（可选）</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="记录唤醒原因，写入 ext.resurrectFrom"
            rows={3}
          />
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- 子流程入口 ---------------- */

export function SubInstanceLinks({ subInstances }: { subInstances?: WfSubInstance[] }) {
  const navigate = useNavigate()
  if (!subInstances || subInstances.length === 0) return null
  return (
    <div className="space-y-2">
      {subInstances.map((sub) => {
        const meta = WF_STATUS_META[sub.bizStatus]
        return (
          <button
            key={sub.subInstanceId}
            type="button"
            onClick={() => navigate(`/workflow/instances/${sub.subInstanceId}`)}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
          >
            <Workflow className="size-4 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1 truncate text-sm">{sub.title}</span>
            {meta && (
              <Badge variant="outline" className={cn("shrink-0", meta.className)}>
                {meta.label}
              </Badge>
            )}
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- P3 操作栏（预测 / 打印 / 唤醒） ---------------- */

export function WfP3Bar({
  detail,
  schema,
  data,
  onReload,
}: {
  detail: WfInstanceDetailP3
  schema: FormSchema
  data: WfFormData
  onReload: () => void
}) {
  const [predictOpen, setPredictOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [resurrectOpen, setResurrectOpen] = useState(false)

  return (
    <>
      {detail.predictable && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPredictOpen(true)}>
          <Sparkles className="size-3.5" /> 预测
        </Button>
      )}
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPrintOpen(true)}>
        <Printer className="size-3.5" /> 打印
      </Button>
      {detail.resurrectable && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setResurrectOpen(true)}>
          <RotateCcw className="size-3.5" /> 唤醒
        </Button>
      )}

      {predictOpen && (
        <PredictModal instanceId={detail.id} open={predictOpen} onClose={() => setPredictOpen(false)} />
      )}
      <WfPrintView
        detail={detail}
        schema={schema}
        data={data}
        open={printOpen}
        onClose={() => setPrintOpen(false)}
      />
      {resurrectOpen && (
        <ResurrectDialog
          detail={detail}
          open={resurrectOpen}
          onClose={() => setResurrectOpen(false)}
          onReload={onReload}
        />
      )}
    </>
  )
}
