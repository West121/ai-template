import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Bell,
  CloudOff,
  ExternalLink,
  FileCode2,
  GitBranch,
  History,
  MessagesSquare,
  RotateCw,
  Send,
  ShieldAlert,
  Undo2,
  Maximize2,
  Minimize2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { api, NetworkError } from "@/lib/api"
import { FormRenderer } from "@/components/form-renderer"
import { HostedForm } from "@/components/hosted-form"
import { buildFieldPolicyMap } from "@/components/field-perms-editor"
import { getForm, isCodeForm } from "@/lib/form-registry"
import { normalizeFormType } from "@/pages/workflow/designer/types"
import type { FieldPolicyMap } from "@/lib/form-manifest"
import "@/pages/workflow/forms" // 触发 CODE 表单登记（registerForm 副作用）
import { Modal } from "@/components/modal"
import { RichTextViewer } from "@/components/rich-text"
import { WfOpBar } from "@/components/wf-op-dialogs"
import { InstancePrintButton } from "@/pages/bizdoc/instance-print"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  parseFormData,
  parseFormSchema,
  WF_STATUS_META,
  wfFormatTime,
  type WfComment,
  type WfFormData,
  type WfHighlight,
  type WfTimelineItem,
} from "@/types/workflow"
import type { WfInstanceDetailP3 } from "@/types/workflow-p3"
import { SubInstanceLinks, WfP3Bar } from "./wf-p3"
import { SealStrip } from "./wf-print"
import { DingtalkTrack } from "./wf-dingtalk-track"
import { FlowViewer, type FlowPredict } from "./designer/flow/flow-viewer"
import type { ProcessModel } from "./designer/flow/model"
import { buildNodeInfo, buildReplaySteps, type NodeRuntimeInfo } from "./designer/flow/runtime-info"
import type { WfPredictResult } from "@/types/workflow-p3"

/* ================= 跟踪图：react-flow 只读 FlowViewer + 高亮 ================= */

/** POST /api/wf/models/import 结果：bpmnXml → 归一化 ProcessModel（+ 未完全还原提示） */
interface BpmnImportResult {
  model: ProcessModel
  warnings?: string[]
}

/**
 * bpmnXml → ProcessModel 缓存（按 xml 串键）：同一实例多次开合流程跟踪侧栏、切换全屏时避免重复调
 * /api/wf/models/import。模块级 Map，跨组件实例复用；xml 变化（新版本/重新加载）自然产生新键。
 */
const modelCache = new Map<string, ProcessModel>()

/**
 * 流程预测取数（钉钉 + BPMN 两跟踪图复用）：POST /predict → 归一 FlowPredict（后续节点 + 预计办理人）。
 * 注意：后端 /predict 仅钉钉模式支持；BPMN 返回"暂不支持"，故仅在 predictable 时暴露入口。
 */
function useTrackPredict(instanceId: number) {
  const [predict, setPredict] = useState<FlowPredict | null>(null)
  const [predictLoading, setPredictLoading] = useState(false)
  const runPredict = useCallback(async () => {
    setPredictLoading(true)
    try {
      const res = await api<WfPredictResult>(`/api/wf/instances/${instanceId}/predict`, { method: "POST" })
      const path = res.path ?? []
      setPredict({
        nodeIds: path.map((p) => p.nodeId).filter(Boolean),
        assignees: Object.fromEntries(path.filter((p) => p.nodeId).map((p) => [p.nodeId, (p.assignees ?? []).map((a) => a.name)])),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "预测失败")
    } finally {
      setPredictLoading(false)
    }
  }, [instanceId])
  return { predict, predictLoading, runPredict }
}

/**
 * 钉钉跟踪图宿主：owns 预测拉取，向 DingtalkTrack 透传 ①办理信息 ②回放 ③预测（钉钉是主战场）。
 */
function DingtalkTrackHost({
  designerJson,
  highlight,
  nodeInfo,
  replaySteps,
  instanceId,
  predictable,
}: {
  designerJson: unknown
  highlight?: WfHighlight
  nodeInfo?: Record<string, NodeRuntimeInfo>
  replaySteps?: string[]
  instanceId: number
  predictable?: boolean
}) {
  const { predict, predictLoading, runPredict } = useTrackPredict(instanceId)
  return (
    <div className="min-h-105">
      <DingtalkTrack
        designerJson={designerJson}
        highlight={highlight}
        nodeInfo={nodeInfo}
        replaySteps={replaySteps}
        predict={predict}
        onRequestPredict={predictable ? () => void runPredict() : undefined}
        predictLoading={predictLoading}
      />
    </div>
  )
}

/**
 * 流程跟踪图（BPMN / GRAPH 定义）：把后端 bpmnXml 经 POST /api/wf/models/import 转成归一化
 * ProcessModel，喂只读 FlowViewer 渲染 + 高亮当前节点/已完成路径。
 * 高亮 id（highlight.completed/active）与 ProcessModel 节点/边 id 对齐（== BPMN 元素 id）。
 */
function FlowTrack({
  xml,
  highlight,
  nodeInfo,
  replaySteps,
  instanceId,
  predictable,
}: {
  xml: string
  highlight?: WfHighlight
  /** ① 节点办理信息（timeline 映射，瞬态叠加） */
  nodeInfo?: Record<string, NodeRuntimeInfo>
  /** ② 回放时间序 */
  replaySteps?: string[]
  /** ③ 预测：实例 id + 是否可预测 */
  instanceId: number
  predictable?: boolean
}) {
  const [model, setModel] = useState<ProcessModel | null>(() => modelCache.get(xml) ?? null)
  const [loadError, setLoadError] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // ③ 流程预测（复用 /predict；拉取后 FlowViewer 显蓝虚线 + 可播放）
  const { predict, predictLoading, runPredict } = useTrackPredict(instanceId)

  useEffect(() => {
    const cached = modelCache.get(xml)
    if (cached) {
      setModel(cached)
      setLoadError(false)
      return
    }
    let disposed = false
    setModel(null)
    setLoadError(false)
    void api<BpmnImportResult>("/api/wf/models/import", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: xml,
    })
      .then((res) => {
        if (disposed) return
        modelCache.set(xml, res.model)
        setModel(res.model)
      })
      .catch(() => {
        if (!disposed) setLoadError(true)
      })
    return () => {
      disposed = true
    }
  }, [xml])

  if (loadError) {
    return (
      <div className="flex h-105 flex-col items-center justify-center gap-2 text-muted-foreground">
        <ShieldAlert className="size-8 opacity-40" />
        <span className="text-sm">流程图解析失败</span>
      </div>
    )
  }

  if (!model) {
    return <Skeleton className="h-105 w-full rounded-md" />
  }

  return (
    <div className={cn("relative", fullscreen && "fixed inset-0 z-50 flex flex-col bg-background p-4")}>
      <FlowViewer
        model={model}
        highlight={highlight}
        nodeInfo={nodeInfo}
        replaySteps={replaySteps}
        predict={predict}
        onRequestPredict={predictable ? () => void runPredict() : undefined}
        predictLoading={predictLoading}
        heightClass={fullscreen ? "min-h-0 flex-1" : "h-105"}
      />
      <div className="absolute top-3 right-3 z-10">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 border bg-card/90 shadow-sm backdrop-blur"
          title={fullscreen ? "退出全屏" : "全屏查看"}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>
    </div>
  )
}

/* ================= 审批记录时间线 ================= */

const TIMELINE_META: Record<string, { label: string; dot: string }> = {
  START: { label: "发起申请", dot: "bg-blue-500" },
  CREATE: { label: "发起申请", dot: "bg-blue-500" },
  SUBMIT: { label: "发起申请", dot: "bg-blue-500" },
  APPROVE: { label: "同意", dot: "bg-emerald-500" },
  REJECT: { label: "驳回", dot: "bg-rose-500" },
  RESUBMIT: { label: "重新提交", dot: "bg-blue-500" },
  CANCEL: { label: "撤销申请", dot: "bg-gray-400" },
  TERMINATE: { label: "终止流程", dot: "bg-orange-500" },
  CC: { label: "抄送", dot: "bg-violet-500" },
  URGE: { label: "催办", dot: "bg-amber-500" },
  COMMENT: { label: "意见", dot: "bg-slate-400" },
  AI_APPROVE: { label: "AI 通过", dot: "bg-emerald-500" },
  AI_REJECT: { label: "AI 拒绝", dot: "bg-rose-500" },
}

function Timeline({ items }: { items: WfTimelineItem[] }) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">暂无流转记录</div>
  }
  return (
    <div className="space-y-0 py-1">
      {items.map((item, index) => {
        const meta = TIMELINE_META[item.action] ?? { label: item.action, dot: "bg-muted-foreground/30" }
        return (
          <div key={index} className="relative flex gap-3 pb-6 last:pb-0">
            {index < items.length - 1 && <div className="absolute left-[5px] top-4 h-full w-px bg-border" />}
            <div className={cn("mt-1 size-[11px] shrink-0 rounded-full", meta.dot)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{meta.label}</span>
                {item.nodeName && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
                    {item.nodeName}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {item.actorName ?? "系统"} · {wfFormatTime(item.createdAt)}
              </div>
              {item.comment && (
                <div className="mt-1 rounded bg-muted/60 px-2 py-1">
                  {/* 意见可能是富文本 HTML（升级后）或存量纯文本，统一走 Viewer（内部 sanitize） */}
                  <RichTextViewer html={item.comment} className="text-xs" />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ================= 沟通线程 ================= */

function CommentThread({ items }: { items: WfComment[] }) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">暂无沟通记录</div>
  }
  return (
    <div className="space-y-3 py-1">
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{item.fromName ?? "系统"}</span>
            <span>{wfFormatTime(item.createdAt)}</span>
          </div>
          <div className="mt-1 text-sm">{item.content}</div>
        </div>
      ))}
    </div>
  )
}

/* ================= 页面 ================= */

export default function WorkflowInstanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const userId = useAuthStore((s) => s.userId)

  const [detail, setDetail] = useState<WfInstanceDetailP3 | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 操作弹窗
  const [canceling, setCanceling] = useState(false)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<WfInstanceDetailP3>(`/api/wf/instances/${id}`)
      setDetail(data)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  // 打开详情自动标记已阅（仅当有我的任务且未阅；后端未就绪时静默失败）
  useEffect(() => {
    if (!detail?.myTaskId || detail.readByMe) return
    void api(`/api/wf/tasks/${detail.myTaskId}/read`, { method: "POST" }).catch(() => {
      /* 已阅接口未就绪：忽略 */
    })
  }, [detail?.myTaskId, detail?.readByMe])

  const formSchema = useMemo(() => parseFormSchema(detail?.formSchema), [detail?.formSchema])
  const formData = useMemo(() => parseFormData(detail?.formData), [detail?.formData])
  // 通知：从流转记录中筛出抄送 / 催办等通知类事件
  const notifyItems = useMemo(
    () => (detail?.timeline ?? []).filter((t) => ["CC", "URGE"].includes(t.action ?? "")),
    [detail?.timeline],
  )
  // 流程图预览增强：① 节点办理信息（timeline→nodeId 映射）② 回放时间序（纯映射，瞬态注入 FlowViewer）
  const nodeRuntimeInfo = useMemo(
    () => buildNodeInfo(detail?.timeline, detail?.highlight, detail?.currentNodes),
    [detail?.timeline, detail?.highlight, detail?.currentNodes],
  )
  const replaySteps = useMemo(() => buildReplaySteps(detail?.timeline), [detail?.timeline])

  const isInitiator = detail != null && userId != null && detail.initiatorId === userId
  /** 被驳回到发起人：实例状态为 REJECTED 且我是发起人 → 表单可编辑 + 重新提交 */
  const resubmitMode = detail?.bizStatus === "REJECTED" && isInitiator

  const statusMeta = detail ? WF_STATUS_META[detail.bizStatus] : undefined

  /* ---------- 操作 ---------- */

  const doCancel = useCallback(async () => {
    if (!detail) return
    setActing(true)
    try {
      await api(`/api/wf/instances/${detail.id}/cancel`, { method: "POST" })
      toast.success("流程已撤销")
      setCanceling(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "撤销失败")
    } finally {
      setActing(false)
    }
  }, [detail, load])

  const doResubmit = useCallback(
    async (data: WfFormData) => {
      if (!detail) return
      setActing(true)
      try {
        await api(`/api/wf/instances/${detail.id}/resubmit`, {
          method: "POST",
          body: JSON.stringify({ formData: data }),
        })
        toast.success("已重新提交")
        void load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "提交失败")
      } finally {
        setActing(false)
      }
    },
    [detail, load],
  )

  /* ---------- 渲染 ---------- */

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-5">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-xl lg:col-span-3" />
        </div>
      </div>
    )
  }

  if (loadError === "network") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <CloudOff className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">后端服务未启动</div>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            实例详情页已接入真实接口（GET /api/wf/instances/{"{id}"}），启动 server/ 后即可查看表单快照、流程跟踪图与审批记录。
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(-1)}>
              <ArrowLeft className="size-3.5" /> 返回
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (loadError || !detail) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-rose-500/60" />
          <div className="text-sm">{loadError ?? "实例不存在"}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(-1)}>
              <ArrowLeft className="size-3.5" /> 返回
            </Button>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const currentNodeNames = (detail.currentNodes ?? [])
    .map((n) => n.nodeName ?? n.nodeId)
    .filter(Boolean)
    .join("、")
  // 流程图是否可渲染（DINGTALK 需 designerJson，BPMN/GRAPH 需 bpmnXml）——决定「流程图」Tab 可用性
  const hasFlow = detail.designerType === "DINGTALK" ? !!detail.designerJson : !!detail.bpmnXml

  /* ---------- 表单来源分流（设计文档 2.4）：CODE（registry 命中）→ HostedForm；ONLINE → FormRenderer ---------- */
  // 节点绑定的是本仓库手写 CODE 表单时，把 nodeFormPerms(tri-state) + 清单 required 合成 FieldPolicyMap 交 HostedForm。
  const codeFormKey = detail.formKey && isCodeForm(detail.formKey) ? detail.formKey : undefined
  const codeFieldPolicy: FieldPolicyMap | undefined = (() => {
    if (!codeFormKey) return undefined
    const manifest = getForm(codeFormKey)?.manifest
    if (!manifest) return undefined
    const policy = buildFieldPolicyMap(manifest.fields, detail.nodeFormPerms)
    // 详情区为只读查看：在策略基础上强制不可编辑（visible/required 仍按 nodeFormPerms/清单）。
    // 可编辑的**填写→提交**在办理动作里进行：见 wf-op-dialogs 的 ApproveDialog（CODE 表单渲染可编辑
    // HostedForm，提交随 approve 带 formData）。
    const view: FieldPolicyMap = {}
    for (const [k, p] of Object.entries(policy)) view[k] = { ...p, editable: false }
    return view
  })()

  return (
    <div className="space-y-4">
      {/* 顶部：标题行 / 元信息行 / 操作栏行 —— 分层避免拥挤 */}
      <Card className="py-4">
        <CardContent className="space-y-3 px-4">
          {/* 标题 + 状态 | 工具（预测/打印/撤销/刷新） */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => navigate(-1)}>
                <ArrowLeft className="size-4.5" />
              </Button>
              <h1 className="truncate text-base font-semibold">{detail.title}</h1>
              <Badge variant="outline" className={statusMeta?.className}>
                {statusMeta?.label ?? detail.bizStatus}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* §11 单据模板打印入口（有匹配已发布模板才显示） */}
              <InstancePrintButton instanceId={detail.id} defCode={detail.defCode} />
              <WfP3Bar detail={detail} schema={formSchema} data={formData} onReload={() => void load()} />
              {detail.canCancel && isInitiator && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCanceling(true)}>
                  <Undo2 className="size-3.5" /> 撤销
                </Button>
              )}
              <Button variant="ghost" size="icon" className="size-8" title="刷新" onClick={() => void load()}>
                <RotateCw className="size-4" />
              </Button>
            </div>
          </div>
          {/* 元信息（与标题对齐） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-xs text-muted-foreground">
            <span>流程：{detail.defName}</span>
            <span>发起人：{detail.initiatorName}</span>
            <span>发起时间：{wfFormatTime(detail.createdAt)}</span>
            {detail.bizTime && (
              <span className="text-amber-600 dark:text-amber-400">业务时间：{wfFormatTime(detail.bizTime)}（穿越时空）</span>
            )}
            {detail.endedAt && <span>结束时间：{wfFormatTime(detail.endedAt)}</span>}
            {currentNodeNames && (
              <span className="font-medium text-foreground/75">当前节点：{currentNodeNames}</span>
            )}
          </div>
          {/* 操作栏（主决策 + 更多 + 管理，为空时不渲染） */}
          <div className="pl-10 empty:hidden">
            <WfOpBar detail={detail} onReload={() => void load()} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/* 表单信息（全宽） */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>表单信息</span>
              {resubmitMode && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                  已驳回至发起人，可修改后重新提交
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {codeFormKey ? (
              // CODE 表单：registry 命中 → HostedForm 渲染，套用 nodeFormPerms 合成的字段策略（只读查看）
              <HostedForm formKey={codeFormKey} formData={formData} fieldPolicy={codeFieldPolicy} />
            ) : normalizeFormType(detail.formType) === "CODE" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-sm">
                  <FileCode2 className="size-4 shrink-0 text-primary" />
                  <span className="text-muted-foreground">此流程使用自定义表单</span>
                </div>
                {detail.formViewPath ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => navigate(detail.formViewPath as string)}
                  >
                    <ExternalLink className="size-3.5" /> 查看自定义表单
                  </Button>
                ) : (
                  <div className="text-xs text-muted-foreground">未配置查看页路径</div>
                )}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">表单数据（只读）</div>
                  <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                    {JSON.stringify(formData, null, 2)}
                  </pre>
                </div>
              </div>
            ) : formSchema.widgets.length === 0 ? (
              <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                暂无表单快照
              </div>
            ) : resubmitMode ? (
              <FormRenderer
                widgets={formSchema.widgets}
                initialValues={formData}
                submitting={acting}
                submitLabel={
                  (
                    <span className="flex items-center gap-1.5">
                      <Send className="size-3.5" /> 重新提交
                    </span>
                  ) as unknown as string
                }
                onSubmit={doResubmit}
              />
            ) : (
              <FormRenderer
                widgets={formSchema.widgets}
                initialValues={formData}
                perms={detail.nodeFormPerms}
                readOnly
              />
            )}

            {/* 电子章展示（按节点盖章记录叠加） */}
            {detail.seals && detail.seals.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">电子章</div>
                <SealStrip seals={detail.seals} />
              </div>
            )}

            {/* 子流程入口 */}
            {detail.subInstances && detail.subInstances.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">子流程</div>
                <SubInstanceLinks subInstances={detail.subInstances} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* 表单下方：流程图（内嵌 · 首屏可见）/ 审批记录 / 评论 / 通知 */}
        <Card className="gap-0 py-0">
          <Tabs defaultValue="timeline">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 pt-3">
              <TabsList>
                <TabsTrigger value="timeline" className="gap-1.5">
                  <History className="size-3.5" /> 审批记录
                  {detail.timeline?.length ? (
                    <span className="text-xs text-muted-foreground">({detail.timeline.length})</span>
                  ) : null}
                </TabsTrigger>
                {/* 流程图入口提升为一级 Tab（办理时一眼可见）：主色图标点睛，含回放/预测 */}
                <TabsTrigger value="flow" className="gap-1.5" disabled={!hasFlow}>
                  <GitBranch className="size-3.5 text-primary" /> 流程图
                  <span className="hidden text-[10px] text-muted-foreground sm:inline">· 回放 / 预测</span>
                </TabsTrigger>
                <TabsTrigger value="comments" className="gap-1.5">
                  <MessagesSquare className="size-3.5" /> 评论
                  {detail.comments?.length ? (
                    <span className="text-xs text-muted-foreground">({detail.comments.length})</span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="notify" className="gap-1.5">
                  <Bell className="size-3.5" /> 通知
                  {notifyItems.length ? (
                    <span className="text-xs text-muted-foreground">({notifyItems.length})</span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="timeline" className="m-0 px-5 py-4">
              <Timeline items={detail.timeline ?? []} />
            </TabsContent>
            {/* 内嵌流程图：BPMN→FlowTrack（含顶部回放/预测工具条 + 全屏 + 图例）；DINGTALK→只读钉钉跟踪图 */}
            <TabsContent value="flow" className="m-0 p-4">
              {detail.designerType === "DINGTALK" && detail.designerJson ? (
                <DingtalkTrackHost
                  designerJson={detail.designerJson}
                  highlight={detail.highlight}
                  nodeInfo={nodeRuntimeInfo}
                  replaySteps={replaySteps}
                  instanceId={detail.id}
                  predictable={detail.predictable}
                />
              ) : detail.bpmnXml ? (
                <FlowTrack
                  xml={detail.bpmnXml}
                  highlight={detail.highlight}
                  nodeInfo={nodeRuntimeInfo}
                  replaySteps={replaySteps}
                  instanceId={detail.id}
                  predictable={detail.predictable}
                />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <GitBranch className="size-8 opacity-30" />
                  <span className="text-sm">暂无流程图</span>
                </div>
              )}
            </TabsContent>
            <TabsContent value="comments" className="m-0 px-5 py-4">
              <CommentThread items={detail.comments ?? []} />
            </TabsContent>
            <TabsContent value="notify" className="m-0 px-5 py-4">
              {notifyItems.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">暂无通知记录</div>
              ) : (
                <Timeline items={notifyItems} />
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      {/* 撤销确认 */}
      <Modal
        open={canceling}
        onOpenChange={(open) => !open && !acting && setCanceling(false)}
        title="撤销流程"
        description={detail.title}
        width={420}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setCanceling(false)} disabled={acting}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void doCancel()} disabled={acting}>
              {acting ? "撤销中…" : "确认撤销"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          撤销后流程立即终止，状态记为「已撤销」。确定要撤销这条申请吗？
        </p>
      </Modal>
    </div>
  )
}
