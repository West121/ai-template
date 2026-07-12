/**
 * 批E 平台联动草稿卡（⑦⑧）——永不直接发布，一律"去设计器继续编辑"：
 *  - FlowDraftPart（编排草稿）：名称 + 触发描述 + 节点链缩略；「确认创建」→ POST 建 DRAFT 流 → 跳编排设计器。
 *  - TemplateDraftPart（单据模板草稿）：版式块缩略；「去设计器编辑」→ 跳模板设计器。
 *  - FormDraftPart（表单草稿）：字段缩略；「去设计器编辑」→ 跳表单定义（设计器）。
 * 非法草稿由后端置 error 卡（此处仅渲染合法草稿；payload 字段做健壮兜底）。
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, CheckCircle2, FileText, GitBranch, Loader2, PenSquare, Workflow } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createFlowFromDraft } from "../api"
import { friendlyAiError, resolveFeaturePath, type AiMessagePart } from "../protocol"

/** "草稿·需在设计器确认启用" 徽标 */
function DraftBadge({ text = "草稿" }: { text?: string }) {
  return <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{text}</span>
}

/** 缩略节点/块链：chip →（箭头分隔）；空则省 */
function ChipChain({ items }: { items: { label: string; sub?: string }[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px]">
            <span className="min-w-0 truncate">{it.label}</span>
            {it.sub && <span className="shrink-0 text-[9px] text-muted-foreground">{it.sub}</span>}
          </span>
          {i < items.length - 1 && <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />}
        </span>
      ))}
    </div>
  )
}

function asChain(raw: unknown, labelKey = "label", subKey?: string): { label: string; sub?: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((n) => {
      const o = (n ?? {}) as Record<string, unknown>
      const label = String(o[labelKey] ?? o.label ?? o.name ?? "").trim()
      const sub = subKey ? (o[subKey] != null ? String(o[subKey]) : undefined) : undefined
      return { label, sub }
    })
    .filter((x) => x.label)
}

/** 草稿卡外壳：图标 + 名称 + 草稿徽标 + 内容 + 动作条 */
function DraftShell({
  icon,
  name,
  badge,
  note,
  children,
  action,
}: {
  icon: React.ReactNode
  name: string
  badge?: string
  note?: string
  children: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <div className="w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{name || "未命名草稿"}</p>
        <DraftBadge text={badge} />
      </div>
      <div className="space-y-2">{children}</div>
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
      <div className="mt-3 flex justify-end">{action}</div>
    </div>
  )
}

/** ⑦ 编排草稿卡 */
export function FlowDraftPart({ part }: { part: AiMessagePart }) {
  const navigate = useNavigate()
  const p = part.payload
  const draftId = typeof p.draftId === "string" ? p.draftId : ""
  const name = String(p.name ?? "自动化编排草稿")
  const triggerDesc = typeof p.triggerDesc === "string" ? p.triggerDesc : ""
  const nodes = asChain(p.nodes, "label")
  const [state, setState] = useState<"idle" | "creating" | "created">("idle")

  const onCreate = async () => {
    if (!draftId || state !== "idle") return
    setState("creating")
    try {
      const res = await createFlowFromDraft(draftId)
      const code = res.data.flowCode ?? res.data.flowId
      const path = code ? resolveFeaturePath("AUTOMATION_DESIGNER", { code }) : null
      setState("created")
      toast.success("已创建草稿编排，正在打开设计器…")
      if (path) navigate(path)
      else toast.message("编排已创建，请在自动化列表中打开")
    } catch (err) {
      toast.error(friendlyAiError(err, "创建失败，请重试"))
      setState("idle")
    }
  }

  return (
    <DraftShell
      icon={<Workflow className="size-4" />}
      name={name}
      note="草稿 · 建成后为未启用状态，需在设计器确认后启用"
      action={
        state === "created" ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> 已创建
          </span>
        ) : (
          <Button size="sm" className="h-8 gap-1" disabled={!draftId || state === "creating"} onClick={() => void onCreate()}>
            {state === "creating" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {state === "creating" ? "创建中…" : "确认创建"}
          </Button>
        )
      }
    >
      {triggerDesc && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" /> 触发：{triggerDesc}
        </p>
      )}
      {nodes.length > 0 && <ChipChain items={nodes} />}
    </DraftShell>
  )
}

/** ⑧ 单据模板草稿卡 */
export function TemplateDraftPart({ part }: { part: AiMessagePart }) {
  const navigate = useNavigate()
  const p = part.payload
  const draftId = typeof p.draftId === "string" ? p.draftId : ""
  const name = String(p.name ?? "单据模板草稿")
  const blocks = asChain(p.blocks, "label")
  const path = draftId ? resolveFeaturePath("BIZDOC_TPL_DESIGNER", { tplId: draftId }) : null

  return (
    <DraftShell
      icon={<FileText className="size-4" />}
      name={name}
      note="草稿 · 去设计器继续编辑，确认后再发布"
      action={
        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={!path} onClick={() => path && navigate(path)}>
          <PenSquare className="size-3.5" /> 去设计器编辑
        </Button>
      }
    >
      {blocks.length > 0 ? <ChipChain items={blocks} /> : <p className="text-xs text-muted-foreground">版式块将在设计器中展开编辑。</p>}
    </DraftShell>
  )
}

/** ⑧ 表单草稿卡 */
export function FormDraftPart({ part }: { part: AiMessagePart }) {
  const navigate = useNavigate()
  const p = part.payload
  const name = String(p.name ?? "表单草稿")
  const fields = asChain(p.fields, "label", "type")
  // 无 id 化表单设计器路由：跳表单定义页继续编辑（对账点）
  const path = resolveFeaturePath("WORKFLOW_FORM_DEFS")

  return (
    <DraftShell
      icon={<FileText className="size-4" />}
      name={name}
      note="草稿 · 去表单设计器继续编辑，永不直接发布"
      action={
        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={!path} onClick={() => path && navigate(path)}>
          <PenSquare className="size-3.5" /> 去设计器编辑
        </Button>
      }
    >
      {fields.length > 0 ? (
        <ChipChain items={fields} />
      ) : (
        <p className="text-xs text-muted-foreground">字段将在设计器中展开编辑。</p>
      )}
    </DraftShell>
  )
}
