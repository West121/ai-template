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
import { useCallback, useEffect, useMemo, useState } from "react"
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
import { useHasPerm } from "@/stores/auth-store"
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
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { WF_STATUS_META, type FormSchema, type WfFormData, type WfOrgRef } from "@/types/workflow"
import type { WfInstanceDetailP3, WfPredictNode, WfPredictResult, WfResurrectPreview, WfSubInstance } from "@/types/workflow-p3"
import { fetchResurrectPreview } from "./wf-resurrect"
import { WfPrintView } from "./wf-print"

/** org-picker 的 OrgRef（type）→ 后端契约 WfOrgRef（kind） */
const toWfOrgRef = (refs: OrgRef[]): WfOrgRef[] => refs.map((r) => ({ kind: r.type, id: r.id, name: r.name }))

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

export function PredictChain({ path }: { path: WfPredictNode[] }) {
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
  // 候选唤醒节点：优先 jumpTargets，否则从时间线去重节点（memo 稳定引用，供预览 effect 依赖）
  const candidates = useMemo(
    () =>
      detail.jumpTargets && detail.jumpTargets.length > 0
        ? detail.jumpTargets.map((t) => ({ nodeId: t.nodeId, name: t.name }))
        : Array.from(
            new Map(
              (detail.timeline ?? [])
                .filter((t) => t.nodeId)
                .map((t) => [t.nodeId, { nodeId: t.nodeId as string, name: t.nodeName ?? (t.nodeId as string) }]),
            ).values(),
          ),
    [detail.jumpTargets, detail.timeline],
  )

  const [nodeId, setNodeId] = useState("")
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // 唤醒重新选人：选节点 → 拉预览 → 默认回填 historyAssignees → 可改人/角色/部门（不改=沿用规则）
  const [preview, setPreview] = useState<WfResurrectPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewDemo, setPreviewDemo] = useState(false)
  const [assignees, setAssignees] = useState<OrgRef[]>([])
  const [touched, setTouched] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 选中节点变化 → 拉预览并默认回填（真实数据回填真实办理人；演示数据仅展示历史，不预填避免占位 id 提交）
  useEffect(() => {
    if (!nodeId) {
      setPreview(null)
      setAssignees([])
      setTouched(false)
      return
    }
    let disposed = false
    setPreviewLoading(true)
    const nodeName = candidates.find((c) => c.nodeId === nodeId)?.name
    void fetchResurrectPreview(detail.id, nodeId, nodeName, detail.timeline)
      .then((res) => {
        if (disposed) return
        setPreview(res.data)
        setPreviewDemo(res.demo)
        setAssignees(res.demo ? [] : res.data.historyAssignees.map((h) => ({ type: "USER", id: h.id, name: h.name })))
        setTouched(false)
      })
      .catch(() => {
        if (!disposed) {
          setPreview(null)
          toast.error("唤醒预览加载失败")
        }
      })
      .finally(() => {
        if (!disposed) setPreviewLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [nodeId, detail.id, detail.timeline, candidates])

  const submit = async () => {
    if (!nodeId) {
      toast.error("请选择唤醒定位节点")
      return
    }
    setSubmitting(true)
    try {
      // 演示预填且未改动 → 不带 assignees（避免提交占位 id，沿用规则）；否则带所选（空=沿用规则）
      const useAssignees = previewDemo && !touched ? [] : assignees
      await api(`/api/wf/instances/${detail.id}/resurrect`, {
        method: "POST",
        body: JSON.stringify({
          nodeId,
          comment: comment.trim() || undefined,
          assignees: useAssignees.length ? toWfOrgRef(useAssignees) : undefined,
        }),
      })
      toast.success(useAssignees.length ? "已唤醒：定位重审并指派所选办理人" : "已唤醒：按快照重建并沿用节点规则")
      onClose()
      onReload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "唤醒失败（接口可能尚未就绪）")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
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

        {/* 重新选人：选节点后展示（默认回填原节点上次办理人，可改人/角色/部门；不改=沿用规则） */}
        {nodeId && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">重审办理人</Label>
              {previewLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            </div>
            <OrgPickerField
              value={assignees}
              multiple
              placeholder="沿用节点规则（点击可改为指定成员 / 角色 / 部门）"
              onOpen={() => setPickerOpen(true)}
              onRemove={(ref) => {
                setTouched(true)
                setAssignees((prev) => prev.filter((r) => !(r.type === ref.type && r.id === ref.id)))
              }}
            />
            {/* 演示预填提示：接口未就绪，仅展示历史办理人，选真实成员后方可指派 */}
            {previewDemo && preview && preview.historyAssignees.length > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                原节点上次办理人：{preview.historyAssignees.map((h) => h.name).join("、")}
                <span className="text-muted-foreground">（预览接口就绪后自动回填；当前请手动选择真实成员，否则沿用规则）</span>
              </p>
            )}
            {/* 规则试算提示 + 沿用规则清空 */}
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] text-muted-foreground">
                {assignees.length === 0
                  ? "未指定 → 沿用节点规则"
                  : preview?.ruleAssignees?.length
                    ? `规则将指派：${preview.ruleAssignees.map((r) => r.name).join("、")}`
                    : "已指定重审办理人"}
              </p>
              {assignees.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
                  onClick={() => {
                    setTouched(true)
                    setAssignees([])
                  }}
                >
                  沿用规则
                </Button>
              )}
            </div>
          </div>
        )}

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
    {/* 重新选人：复用组织选择器（成员/部门/角色 2D 模型） */}
    <OrgPicker
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      title="选择重审办理人"
      value={assignees}
      onConfirm={(refs) => {
        setTouched(true)
        setAssignees(refs)
      }}
    />
    </>
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

  // 唤醒是管理员操作（后端 B-11 收权到 wf:instance:admin）——复用 WfOpBar 里 jump/terminate
  // 的同一判断：优先详情下发的 isAdmin，回退前端权限码，避免非管理员点击后 403。
  const adminPerm = useHasPerm("wf:instance:admin")
  const isAdmin = detail.isAdmin ?? adminPerm

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
      {detail.resurrectable && isAdmin && (
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
