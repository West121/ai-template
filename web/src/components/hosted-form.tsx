/**
 * `HostedForm` —— CODE 表单包裹层（设计文档第二部分 2.4）。
 *
 * 按 `formKey` 从 registry 取注册的手写 react-hook-form 表单并渲染，把节点级 `fieldPolicy`
 * 透传给组件。约定：注册组件接收 `fieldPolicy?: Record<string, FieldPolicy>`，逐字段用
 * `fieldStateOf` 派生渲染态，从而**通用地**实现：
 *  - visible=false → 不渲染该字段；
 *  - editable=false → react-hook-form 字段 `disabled`（只读）；
 *  - required=true → 向该字段 rules 注入必填校验。
 *
 * 未登记的 formKey 给出清晰占位（而非空白），避免运行时死胡同。
 */
import type { Ref } from "react"
import { AlertTriangle } from "lucide-react"
import type { FieldPolicyMap } from "@/lib/form-manifest"
import { getForm, type HostedFormHandle } from "@/lib/form-registry"

export interface HostedFormProps {
  formKey: string
  formData: Record<string, unknown>
  /** 节点级字段策略：字段 key → { visible, editable, required } */
  fieldPolicy?: FieldPolicyMap
  onChange?: (data: Record<string, unknown>) => void
  /** 受控提交句柄：办理动作经此校验并取 formData（只读查看可不传）。 */
  formRef?: Ref<HostedFormHandle>
}

export function HostedForm({ formKey, formData, fieldPolicy, onChange, formRef }: HostedFormProps) {
  const entry = getForm(formKey)

  if (!entry) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          未找到已登记的表单「{formKey}」。请确认该 CODE 表单已通过 <code className="font-mono">registerForm</code> 登记。
        </span>
      </div>
    )
  }

  const Component = entry.component
  return (
    <Component formData={formData} fieldPolicy={fieldPolicy} onChange={onChange} formRef={formRef} />
  )
}
