/**
 * 办文单流程图（只读跟踪图）。
 *
 * 复用审批详情 instance-detail.tsx 的 FlowTrack 模式：拉流程定义 designerJson → ProcessModel →
 * 喂只读 FlowViewer（designer/flow/flow-viewer），按 doc.highlight 高亮已完成 / 当前节点。
 *  - 发文用 gw_send、收文用 gw_recv（按 doc.direction）。
 *  - highlight：后端 GET /api/office/doc/{id} 返回优先；缺省按 currentTask 派生（deriveHighlight）。
 *  - 降级：NetworkError（后端未连接）/ 无 designerJson → 占位提示，不崩。模型按 defCode 缓存。
 */
import { useEffect, useState } from "react"
import { GitBranch, Loader2 } from "lucide-react"
import { api, NetworkError } from "@/lib/api"
import { FlowViewer } from "@/pages/workflow/designer/flow/flow-viewer"
import type { ProcessModel } from "@/pages/workflow/designer/flow/model"
import type { ProcessDefItem } from "@/pages/workflow/designer/types"
import { deriveHighlight } from "./mock"
import type { GwDoc } from "./types"

/** designerJson（字符串或对象）→ ProcessModel；非法/空返回 null */
function parseGraphModel(raw: unknown): ProcessModel | null {
  if (raw == null) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && typeof obj === "object" && Array.isArray((obj as { nodes?: unknown }).nodes)) {
      return obj as ProcessModel
    }
    return null
  } catch {
    return null
  }
}

/** 模型缓存（按 defCode）：同一方向多次开合详情不重复拉取 */
const modelCache = new Map<string, ProcessModel>()

type TrackState = "loading" | "ready" | "offline" | "empty"

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-105 flex-col items-center justify-center gap-2 text-muted-foreground">
      <GitBranch className="size-8 opacity-30" />
      <span className="max-w-xs text-center text-sm">{text}</span>
    </div>
  )
}

export function DocFlowTrack({ doc }: { doc: GwDoc }) {
  const defCode = doc.direction === "SEND" ? "gw_send" : "gw_recv"
  const [model, setModel] = useState<ProcessModel | null>(() => modelCache.get(defCode) ?? null)
  const [state, setState] = useState<TrackState>(() => (modelCache.get(defCode) ? "ready" : "loading"))

  useEffect(() => {
    const cached = modelCache.get(defCode)
    if (cached) {
      setModel(cached)
      setState("ready")
      return
    }
    let disposed = false
    setState("loading")
    api<ProcessDefItem>(`/api/wf/process-defs/${defCode}/latest`)
      .then((row) => {
        if (disposed) return
        const m = parseGraphModel(row.designerJson)
        if (m) {
          modelCache.set(defCode, m)
          setModel(m)
          setState("ready")
        } else {
          setState("empty")
        }
      })
      .catch((err) => {
        if (!disposed) setState(err instanceof NetworkError ? "offline" : "empty")
      })
    return () => {
      disposed = true
    }
  }, [defCode])

  if (state === "loading") {
    return (
      <div className="flex h-105 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">加载流程图…</span>
      </div>
    )
  }
  if (state === "offline") {
    return <Placeholder text={`后端未连接，启动 server/ 后展示 ${defCode} 流程图`} />
  }
  if (state === "empty" || !model) {
    return <Placeholder text="暂无流程图（流程定义未发布或解析失败）" />
  }

  // 后端 highlight 优先；缺省按当前环节派生（后端未就绪时仍高亮当前节点）
  const highlight = doc.highlight ?? deriveHighlight(doc)
  return <FlowViewer model={model} highlight={highlight} heightClass="h-105" />
}
