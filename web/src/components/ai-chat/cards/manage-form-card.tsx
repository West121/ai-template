/**
 * manage_form 卡（AI 受控管理操作框架，docs/design/ai-managed-actions.md §2/§4；**对齐后端批M1 实况**）。
 *
 * 后端实况（已核对 ai/managed/*）：
 *  - manage_prepare 工具 → SSE part `partType:"manage_form"`，payload = 整卡
 *    `{ type:"manage_form", actionCode, action, module, entityLabel, title, schema(widgets[]), prefill?, targetId?, submitPath }`。
 *  - 提交：`POST /api/ai/manage/submit` body **`{ actionCode, values, targetId }`**（.update 操作带 targetId）
 *    → 后端暂存动作草稿(PENDING_CONFIRM) 并回 **confirm 卡** `{type:"confirm", actionId, title, summary, params, danger}`。
 *  - 确认执行：100% 复用批A `ConfirmCard`（`POST /api/ai/actions/{id}/confirm` → AiManagedGateway 反射执行）。
 * 权限：后端按 requiredAuthority 过滤，无权的操作根本不会出现在 list / prepare（403）。密码 params 后端脱敏 ******。
 *
 * 防白屏：整卡包 ErrorBoundary；schema/prefill 归一（array|{widgets}|JSON 串 都兜，非法不崩）；
 * 后端未连接(NetworkError) → 演示确认卡降级（ConfirmCard 离线走 mock 成功，闭环可见）。
 */
import { useMemo, useState } from "react"
import { CheckCircle2, Settings2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError } from "@/lib/api"
import { FormRenderer } from "@/components/form-renderer"
import { ErrorBoundary } from "@/components/error-boundary"
import type { WfFormData } from "@/types/workflow"
import type { AiMessagePart } from "../protocol"
import type { AiConfirmCard, AiFormCard } from "../types"
import { ConfirmCard } from "./confirm-card"
import { getAiActionOutcome, recordAiActionOutcome } from "@/stores/ai-action-outcomes"

/** schema 归一（同 form-card 根因防白屏）：widgets 数组 / {widgets} / JSON 串 → 数组；非法 → [] */
function normalizeSchema(raw: unknown): AiFormCard["schema"] {
  let v = raw
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as { widgets?: unknown }).widgets
  return Array.isArray(v) ? (v as AiFormCard["schema"]) : []
}
function normalizePrefill(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  return undefined
}

/** submit 响应 → AiConfirmCard（容 part 形状 {payload} 或裸卡；无 actionId → null，不误渲染） */
function toConfirmCard(raw: unknown): AiConfirmCard | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const src = (o.payload && typeof o.payload === "object" ? o.payload : o) as Record<string, unknown>
  const actionId = src.actionId
  if (typeof actionId !== "string" && typeof actionId !== "number") return null
  return {
    type: "confirm",
    actionId: String(actionId),
    title: typeof src.title === "string" ? src.title : "确认执行",
    summary: typeof src.summary === "string" ? src.summary : undefined,
    params: Array.isArray(src.params) ? (src.params as AiConfirmCard["params"]) : undefined,
    danger: !!src.danger,
    expiresAt: typeof src.expiresAt === "string" ? src.expiresAt : undefined,
  }
}

/** 演示降级用敏感字段脱敏（真实由后端脱敏） */
function maskValue(key: string, value: unknown): string {
  if (/pass|pwd|secret/i.test(key)) return "******"
  return value == null ? "" : String(value)
}

function ManageFormInner({ part }: { part: AiMessagePart }) {
  const p = part.payload
  const schema = useMemo(() => normalizeSchema(p.schema), [p.schema])
  const prefill = useMemo(() => normalizePrefill(p.prefill), [p.prefill])
  const actionCode = typeof p.actionCode === "string" ? p.actionCode : ""
  const targetId = typeof p.targetId === "string" && p.targetId ? p.targetId : undefined
  const title = typeof p.title === "string" && p.title ? p.title : "管理操作"
  const submitPath = typeof p.submitPath === "string" && p.submitPath ? p.submitPath : "/api/ai/manage/submit"

  // 重挂不复活：按本卡稳定 partId 记「已提交(带 confirm 卡快照)/已取消」，关面板重开不回到可再次提交的表单
  const partKey = part.partId
  const prior = getAiActionOutcome(partKey)
  const [submitting, setSubmitting] = useState(false)
  const [confirmCard, setConfirmCard] = useState<AiConfirmCard | null>(
    prior?.status === "submitted" && prior.snapshot ? (prior.snapshot as AiConfirmCard) : null,
  )
  const [cancelled, setCancelled] = useState(prior?.status === "cancelled")

  const handleSubmit = async (data: WfFormData) => {
    setSubmitting(true)
    try {
      // 后端实况 body：{ actionCode, values, targetId }
      const res = await api<unknown>(submitPath, { method: "POST", body: JSON.stringify({ actionCode, values: data, targetId }) })
      const card = toConfirmCard(res)
      if (card) {
        setConfirmCard(card)
        recordAiActionOutcome(partKey, { status: "submitted", snapshot: card })
      } else toast.error("提交未返回可确认的操作，请重试")
    } catch (err) {
      if (err instanceof NetworkError) {
        toast.info("后端未连接：已演示提交")
        const demoCard: AiConfirmCard = {
          type: "confirm",
          actionId: `demo_${Date.now()}`,
          title: `确认${title}`,
          summary: "演示：后端未连接，确认为模拟执行（未真实落库）。",
          params: Object.entries(data).map(([k, v]) => ({ label: k, value: maskValue(k, v) })),
          danger: false,
        }
        setConfirmCard(demoCard)
        recordAiActionOutcome(partKey, { status: "submitted", snapshot: demoCard })
      } else {
        toast.error(err instanceof Error ? err.message : "提交失败")
      }
    } finally {
      setSubmitting(false)
    }
  }

  // 提交后 → 100% 复用批A confirm 卡（确认执行走同一端点/组件）
  if (confirmCard) return <ConfirmCard card={confirmCard} />

  // schema 非法/空 → 不崩，提示
  if (!schema || schema.length === 0) {
    return (
      <div className="flex w-full min-w-0 items-center gap-2 rounded-xl border bg-card px-3.5 py-3 text-sm text-muted-foreground shadow-sm">
        <Settings2 className="size-4 shrink-0 text-primary" />
        {title}：表单字段缺失，暂无法填写
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <Settings2 className="size-4 text-primary" />
        <p className="text-sm font-semibold">{title}</p>
        <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">管理操作</span>
      </div>
      {cancelled ? (
        <div aria-live="polite" className="flex items-center gap-1.5 px-3.5 py-4 text-sm text-muted-foreground">
          <XCircle className="size-4 shrink-0" /> 已取消
        </div>
      ) : (
        <div className="ai-form px-3.5 py-3">
          <FormRenderer
            widgets={schema}
            initialValues={prefill}
            submitLabel="提交"
            cancelLabel="取消"
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={() => {
              setCancelled(true)
              recordAiActionOutcome(partKey, { status: "cancelled" })
              toast.message("已取消")
            }}
          />
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3 text-emerald-500" /> 提交后需二次确认才会真正执行
          </p>
        </div>
      )}
    </div>
  )
}

export function ManageFormPart({ part }: { part: AiMessagePart }) {
  return (
    <ErrorBoundary label="manage-form">
      <ManageFormInner part={part} />
    </ErrorBoundary>
  )
}
