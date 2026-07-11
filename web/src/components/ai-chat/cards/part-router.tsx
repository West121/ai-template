/**
 * V2 消息 Part 路由（§9.3/§10/§16.3）：按 partType **白名单**渲染；
 * 未知 partType / 超出支持的 schemaVersion / 形状非法 → 降级组件（不空白不报错）。
 * navigate/form/confirm/list/chart 经 partToCard 适配后复用现有卡片组件（渐进替换，行为兼容）；
 * status/error/approval 为 V2 新增轻量卡。
 */
import { AlertTriangle, CheckCircle2, ExternalLink, Info, PackageX } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { partToCard, resolvePart, resolveFeaturePath, type AiMessagePart } from "../protocol"
import { CardRouter } from "./card-router"

/** 降级组件（§16.3：未知 schemaVersion / partType） */
function UnknownPart({ part, reason }: { part: AiMessagePart; reason: string }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <PackageX className="size-4 shrink-0" />
      <span className="min-w-0">
        暂不支持的内容（{part.partType || "未知类型"}
        {typeof part.schemaVersion === "number" ? ` · v${part.schemaVersion}` : ""}，{reason}），请刷新或升级客户端后查看。
      </span>
    </div>
  )
}

/** status 卡：工具/动作状态一行（§10.1） */
function StatusPart({ part }: { part: AiMessagePart }) {
  const p = part.payload
  const state = String(p.state ?? p.status ?? "")
  const failed = /fail|error/i.test(state)
  return (
    <div className={`flex w-full min-w-0 items-center gap-1.5 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>
      {failed ? <AlertTriangle className="size-3.5 shrink-0" /> : <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />}
      <span className="min-w-0 truncate">{String(p.text ?? p.displayName ?? "状态更新")}</span>
    </div>
  )
}

/** error 卡：可恢复错误反馈（§10.1） */
function ErrorPart({ part }: { part: AiMessagePart }) {
  const p = part.payload
  return (
    <div className="flex w-full min-w-0 items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{String(p.title ?? "处理失败")}</p>
        {typeof p.message === "string" && p.message && <p className="break-words">{p.message}</p>}
      </div>
    </div>
  )
}

/** approval 卡：流程实例结果（§10.1）——标题 + 状态 + 实例详情入口 */
function ApprovalPart({ part }: { part: AiMessagePart }) {
  const navigate = useNavigate()
  const p = part.payload
  const path =
    typeof p.instanceId === "string" || typeof p.instanceId === "number"
      ? resolveFeaturePath("WF_INSTANCE_DETAIL", { instanceId: p.instanceId })
      : null
  return (
    <div className="w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Info className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{String(p.title ?? "流程实例")}</p>
        {typeof p.status === "string" && (
          <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600">{p.status}</span>
        )}
      </div>
      {typeof p.summary === "string" && p.summary && <p className="mb-2 text-xs text-muted-foreground">{p.summary}</p>}
      {path && (
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(path)}>
          查看流程 <ExternalLink className="size-3" />
        </Button>
      )}
    </div>
  )
}

export function PartRouter({ part }: { part: AiMessagePart }) {
  const res = resolvePart(part)
  if (res.status === "degraded") {
    const reason = res.reason === "unsupported-version" ? "版本过新" : res.reason === "unknown-type" ? "未知类型" : "数据不完整"
    return <UnknownPart part={part} reason={reason} />
  }
  switch (res.type) {
    case "text":
      // text part 由消息层拼进正文（content），此处兜底为空
      return null
    case "status":
      return <StatusPart part={part} />
    case "error":
      return <ErrorPart part={part} />
    case "approval":
      return <ApprovalPart part={part} />
    case "navigate":
    case "form":
    case "confirm":
    case "list":
    case "chart": {
      const card = partToCard(part)
      if (!card) return <UnknownPart part={part} reason="无法映射（如未知 featureCode）" />
      return <CardRouter card={card} />
    }
    default:
      return null
  }
}
