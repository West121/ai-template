/**
 * form 卡（§3.3）：在线表单（schema widgets）内嵌 FormRenderer 提交起流程（前端直调
 * /api/wf/instances，不经 LLM）；CODE 表单（submitPath）给跳转 CTA。
 * 提交成功替换为「已发起」结果条 + 实例链接（§10 返回 instId）。.ai-form 两列压一列。
 */
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, CheckCircle2, ExternalLink, FileText, XCircle } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError } from "@/lib/api"
import { FormRenderer } from "@/components/form-renderer"
import { Button } from "@/components/ui/button"
import type { WfFormData } from "@/types/workflow"
import type { AiFormCard } from "../types"

/**
 * schema 归一(防白屏根因):后端 Part 化后 schema 可能是 widgets 数组 / {widgets:[...]} 对象 /
 * JSON 字符串——统一收敛为数组;非法形状回 [](走 CODE 分支的"发起页填写"提示,不崩)。
 */
function normalizeSchema(raw: unknown): AiFormCard["schema"] {
  let v = raw
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    v = (v as { widgets?: unknown }).widgets
  }
  return Array.isArray(v) ? (v as AiFormCard["schema"]) : []
}

/** 预填归一（防白屏）：仅接受对象 {fieldKey: value}，其它形状 → undefined（不预填，不崩） */
function normalizePrefill(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  return undefined
}

export function FormCard({ card }: { card: AiFormCard }) {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [instId, setInstId] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const schema = normalizeSchema(card.schema)
  // 预填：后端从话语提取的 knownValues（如"请10天年假"→{leaveType:"年假",days:10}），用户只补余下字段
  const prefill = useMemo(() => normalizePrefill(card.prefill), [card.prefill])

  // B：CODE 表单（无 schema，跳发起页）
  if (!schema || schema.length === 0) {
    return (
      <div className="flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <FileText className="size-4.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{card.defName}</p>
          <p className="text-xs text-muted-foreground">该表单需在发起页填写</p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1"
          disabled={!card.submitPath}
          onClick={() => card.submitPath && navigate(card.submitPath)}
        >
          去填写 <ArrowRight className="size-3.5" />
        </Button>
      </div>
    )
  }

  // A：在线表单内嵌
  const handleSubmit = async (data: WfFormData) => {
    setSubmitting(true)
    try {
      const res = await api<{ id?: number; instId?: number }>("/api/wf/instances", {
        method: "POST",
        body: JSON.stringify({ defCode: card.defCode, formData: data }),
      })
      setInstId(res.id ?? res.instId ?? null)
      setSubmitted(true)
    } catch (err) {
      // 后端未接入时演示提交成功（mock 口径与助手其余能力一致）
      if (err instanceof NetworkError) {
        setInstId(null)
        setSubmitted(true)
        toast.info("后端未连接：已演示提交（未真实落库）")
      } else {
        toast.error(err instanceof Error ? err.message : "提交失败")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <FileText className="size-4 text-primary" />
        <p className="text-sm font-semibold">{card.defName}</p>
      </div>

      {submitted ? (
        <div aria-live="polite" className="flex flex-col items-start gap-2 px-3.5 py-4">
          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> 已发起「{card.defName}」
          </div>
          {instId != null ? (
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => navigate(`/workflow/instances/${instId}`)}>
              查看实例 <ExternalLink className="size-3.5" />
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => navigate("/workflow/tasks?tab=mine")}>
              去「我发起」查看 <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
      ) : cancelled ? (
        // 取消：本地收起表单，不提交不起流程（用户可重新发起对话）
        <div aria-live="polite" className="flex items-center gap-1.5 px-3.5 py-4 text-sm text-muted-foreground">
          <XCircle className="size-4 shrink-0" /> 已取消填写
        </div>
      ) : (
        <div className="ai-form px-3.5 py-3">
          <FormRenderer
            widgets={schema}
            initialValues={prefill}
            submitLabel="提交并发起"
            cancelLabel="取消"
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={() => {
              setCancelled(true)
              toast.message("已取消填写")
            }}
          />
        </div>
      )}
    </div>
  )
}
