/**
 * 共享流程跟踪图 `WorkflowFlowTrack`（重构阶段 A，docs/design/workflow-detail-shell.md §5-A）。
 *
 * 把原 instance-detail.tsx 内联的 FlowTrack / DingtalkTrackHost / useTrackPredict 抽成共享组件，
 * 供审批与公文（后续）共用。承载全部增强：① 节点办理信息 ② 回放 ③ 预测完整链路 + 连线高亮流动 +
 * 全屏 + DINGTALK 分支。
 *
 * 解耦要点：
 *  - **数据源** `source`：`inline`（详情内嵌 designerJson/bpmnXml，审批用）或 `defCode`（按流程定义 code
 *    拉最新模型，公文用，/api/wf/process-defs/{code}/latest）。
 *  - **预测端点** 用 `predict.run` 回调注入（审批 /api/wf/instances/{id}/predict；公文以后传自己的）——
 *    组件只负责把 WfPredictResult 归一为 FlowPredict + 管理 loading。
 *  - nodeInfo/replaySteps 由组件内部对 `timeline` 调 buildNodeInfo/buildReplaySteps 生成（不再由页面传）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { GitBranch, Maximize2, Minimize2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { api, NetworkError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { WfHighlight, WfTimelineItem } from "@/types/workflow"
import type { WfPredictResult } from "@/types/workflow-p3"
import type { ProcessDefItem } from "../types"
import { DingtalkTrack } from "../../wf-dingtalk-track"
import { FlowViewer, type FlowPredict } from "./flow-viewer"
import type { ProcessModel } from "./model"
import { buildNodeInfo, buildReplaySteps } from "./runtime-info"

/* ============================ 契约（供阶段 B 基座复用） ============================ */

export type WorkflowFlowSource =
  /** 审批：详情内嵌 designerJson（DINGTALK）/ bpmnXml（BPMN·GRAPH） */
  | { load: "inline"; designerType?: string | null; designerJson?: unknown; bpmnXml?: string | null }
  /** 公文/单据：按流程定义 code 拉最新模型 */
  | { load: "defCode"; defCode: string }

/** 图内预测配置（端点不同 → 传 run 回调；不传/enabled=false 则不显预测入口） */
export interface WorkflowFlowPredict {
  enabled: boolean
  run: () => Promise<WfPredictResult>
}

export interface WorkflowFlowTrackProps {
  source: WorkflowFlowSource
  /** 归一化时间线（组件内部 build nodeInfo/replaySteps） */
  timeline: WfTimelineItem[]
  highlight?: WfHighlight
  currentNodes?: { nodeId?: string; nodeName?: string }[]
  predict?: WorkflowFlowPredict
}

/* ============================ 预测归一（原 useTrackPredict） ============================ */

/** WfPredictResult → FlowPredict 完整链路（done/current/future + 并签/驳回元信息） */
function toFlowPredict(res: WfPredictResult): FlowPredict {
  const path = (res.path ?? []).filter((p) => p.nodeId)
  return {
    note: res.note,
    nodes: path.map((p) => ({
      nodeId: p.nodeId,
      nodeName: p.nodeName,
      status: p.status === "done" || p.status === "current" || p.status === "future" ? p.status : "future",
      assignees: (p.assignees ?? []).map((a) => a.name).filter(Boolean),
      canReject: p.canReject,
      rejectTo: p.rejectTo ?? null,
      multiMode: p.multiMode ?? null,
      parallelGroup: p.parallelGroup ?? null,
    })),
  }
}

function usePredictRunner(predict?: WorkflowFlowPredict) {
  const [data, setData] = useState<FlowPredict | null>(null)
  const [loading, setLoading] = useState(false)
  const runFn = predict?.run
  const runPredict = useCallback(async () => {
    if (!runFn) return
    setLoading(true)
    try {
      setData(toFlowPredict(await runFn()))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "预测失败")
    } finally {
      setLoading(false)
    }
  }, [runFn])
  return { predict: data, predictLoading: loading, runPredict }
}

/* ============================ 模型装载（inline bpmnXml / defCode） ============================ */

/** POST /api/wf/models/import 结果：bpmnXml → 归一化 ProcessModel */
interface BpmnImportResult {
  model: ProcessModel
  warnings?: string[]
}

/** designerJson（字符串或对象）→ ProcessModel；非法/空返回 null */
function parseGraphModel(raw: unknown): ProcessModel | null {
  if (raw == null) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && typeof obj === "object" && Array.isArray((obj as { nodes?: unknown }).nodes)) return obj as ProcessModel
    return null
  } catch {
    return null
  }
}

type Resolved =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "empty" }
  | { kind: "dingtalk"; designerJson: unknown }
  | { kind: "model"; model: ProcessModel }

/** bpmnXml → ProcessModel 缓存（按 xml 串键，跨组件实例复用，避免重复 import） */
const xmlModelCache = new Map<string, ProcessModel>()
/** defCode → 解析结果缓存 */
const defResolvedCache = new Map<string, Resolved>()

/** ProcessDefItem → 解析结果（DINGTALK 走钉钉跟踪图，GRAPH designerJson 走 FlowViewer） */
function resolveDef(row: ProcessDefItem): Resolved {
  if (row.designerType === "DINGTALK" && row.designerJson != null) return { kind: "dingtalk", designerJson: row.designerJson }
  const m = parseGraphModel(row.designerJson)
  if (m) return { kind: "model", model: m }
  return { kind: "empty" }
}

/** 同步可得的解析（缓存命中 / DINGTALK inline / 无源）；否则 null 表示需异步加载 */
function syncResolve(source: WorkflowFlowSource, designerJson: unknown): Resolved | null {
  if (source.load === "inline") {
    if (source.designerType === "DINGTALK" && designerJson != null) return { kind: "dingtalk", designerJson }
    if (!source.bpmnXml) return { kind: "empty" }
    const cached = xmlModelCache.get(source.bpmnXml)
    return cached ? { kind: "model", model: cached } : null
  }
  return defResolvedCache.get(source.defCode) ?? null
}

function useResolvedModel(source: WorkflowFlowSource, designerJson: unknown): Resolved {
  const [state, setState] = useState<Resolved>(() => syncResolve(source, designerJson) ?? { kind: "loading" })
  // 原始类型依赖，避免 inline 对象每渲染新引用触发重复加载
  const load = source.load
  const dtype = source.load === "inline" ? source.designerType ?? null : null
  const xml = source.load === "inline" ? source.bpmnXml ?? null : null
  const defCode = source.load === "defCode" ? source.defCode : null
  const hasDj = designerJson != null

  useEffect(() => {
    const sync = syncResolve(source, designerJson)
    if (sync) {
      setState(sync)
      return
    }
    let disposed = false
    setState({ kind: "loading" })
    if (load === "inline" && xml) {
      void api<BpmnImportResult>("/api/wf/models/import", { method: "POST", headers: { "Content-Type": "text/plain" }, body: xml })
        .then((res) => {
          if (disposed) return
          xmlModelCache.set(xml, res.model)
          setState({ kind: "model", model: res.model })
        })
        .catch(() => {
          if (!disposed) setState({ kind: "error", text: "流程图解析失败" })
        })
    } else if (defCode) {
      void api<ProcessDefItem>(`/api/wf/process-defs/${defCode}/latest`)
        .then((row) => {
          if (disposed) return
          const r = resolveDef(row)
          defResolvedCache.set(defCode, r)
          setState(r)
        })
        .catch((err) => {
          if (!disposed) setState(err instanceof NetworkError ? { kind: "error", text: "后端未连接，无法加载流程图" } : { kind: "empty" })
        })
    }
    return () => {
      disposed = true
    }
    // syncResolve/designerJson 由原始依赖覆盖（DINGTALK inline 走 hasDj）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, dtype, xml, defCode, hasDj])

  return state
}

/* ============================ 渲染 ============================ */

function Placeholder({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-105 flex-col items-center justify-center gap-2 text-muted-foreground">
      {icon}
      <span className="max-w-xs text-center text-sm">{text}</span>
    </div>
  )
}

interface FlowRenderProps {
  highlight?: WfHighlight
  nodeInfo: Record<string, import("./runtime-info").NodeRuntimeInfo>
  replaySteps: string[]
  predict: FlowPredict | null
  onRequestPredict?: () => void
  predictLoading: boolean
}

/** BPMN/GRAPH：FlowViewer + 全屏（原 FlowTrack 渲染，行为一致） */
function ModelFlowViewer({ model, ...p }: { model: ProcessModel } & FlowRenderProps) {
  const [fullscreen, setFullscreen] = useState(false)
  return (
    <div className={cn("relative", fullscreen && "fixed inset-0 z-50 flex flex-col bg-background p-4")}>
      <FlowViewer
        model={model}
        highlight={p.highlight}
        nodeInfo={p.nodeInfo}
        replaySteps={p.replaySteps}
        predict={p.predict}
        onRequestPredict={p.onRequestPredict}
        predictLoading={p.predictLoading}
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

export function WorkflowFlowTrack({ source, timeline, highlight, currentNodes, predict }: WorkflowFlowTrackProps) {
  const nodeInfo = useMemo(() => buildNodeInfo(timeline, highlight, currentNodes), [timeline, highlight, currentNodes])
  const replaySteps = useMemo(() => buildReplaySteps(timeline), [timeline])
  const { predict: predictData, predictLoading, runPredict } = usePredictRunner(predict)
  const onRequestPredict = predict?.enabled ? () => void runPredict() : undefined

  const designerJson = source.load === "inline" ? source.designerJson : undefined
  const resolved = useResolvedModel(source, designerJson)

  const flowProps: FlowRenderProps = { highlight, nodeInfo, replaySteps, predict: predictData, onRequestPredict, predictLoading }

  if (resolved.kind === "loading") return <Skeleton className="h-105 w-full rounded-md" />
  if (resolved.kind === "error") return <Placeholder icon={<ShieldAlert className="size-8 opacity-40" />} text={resolved.text} />
  if (resolved.kind === "empty") return <Placeholder icon={<GitBranch className="size-8 opacity-30" />} text="暂无流程图" />
  if (resolved.kind === "dingtalk") {
    return (
      <div className="min-h-105">
        <DingtalkTrack
          designerJson={resolved.designerJson}
          highlight={highlight}
          nodeInfo={nodeInfo}
          replaySteps={replaySteps}
          predict={predictData}
          onRequestPredict={onRequestPredict}
          predictLoading={predictLoading}
        />
      </div>
    )
  }
  return <ModelFlowViewer model={resolved.model} {...flowProps} />
}
