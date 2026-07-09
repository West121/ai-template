/**
 * CODE 表单登记表（设计文档第二部分 2.2 / 2.3）。
 *
 * 本仓库手写的 react-hook-form 表单，在组件旁静态导出字段清单并 `registerForm` 登记；
 * 流程「节点字段权限编辑器」与 `HostedForm` 通过 `getForm` / `getFormManifest` 取用。
 *
 * 取数策略（`getFormManifest`）：
 *  - CODE：命中本地 registry → 直接返回登记的 manifest（后端对 CODE 返回 404，不依赖）。
 *  - ONLINE：未登记 → `GET /api/wf/forms/{formKey}/fields`（后端从 schemaJson 派生）。
 *  - 皆不可得 → 抛清晰错误。
 */
import type { ComponentType } from "react"
import { ApiError, NetworkError, api } from "@/lib/api"
import type { FieldPolicyMap, FormFieldManifest } from "@/lib/form-manifest"

/**
 * 注册的手写表单组件契约（设计文档 2.4）：接收 `formData` + 可选 `fieldPolicy` + `onChange`。
 * 组件遵守此契约即获得节点级 visible/editable/required 联动能力（见 `fieldStateOf`）。
 */
export interface HostedFormComponentProps {
  formData: Record<string, unknown>
  /** 节点级字段策略：字段 key → { visible, editable, required } */
  fieldPolicy?: FieldPolicyMap
  onChange?: (data: Record<string, unknown>) => void
}

/** registry 条目：组件 + 其字段清单。 */
export interface RegisteredForm {
  component: ComponentType<HostedFormComponentProps>
  manifest: FormFieldManifest
}

const registry = new Map<string, RegisteredForm>()

/** 登记一个 CODE 表单（组件 + manifest）。重复 key 覆盖。 */
export function registerForm(formKey: string, entry: RegisteredForm): void {
  registry.set(formKey, entry)
}

/** 取登记的 CODE 表单（组件 + manifest）；未登记返回 undefined。 */
export function getForm(formKey: string): RegisteredForm | undefined {
  return registry.get(formKey)
}

/** 是否已登记为 CODE 表单。 */
export function isCodeForm(formKey: string): boolean {
  return registry.has(formKey)
}

/** 已登记的全部 formKey（调试 / 选择器用）。 */
export function registeredFormKeys(): string[] {
  return [...registry.keys()]
}

/**
 * 取字段清单：CODE（registry 本地）优先，否则 ONLINE 走后端端点。
 * 找不到时抛出清晰错误，区分「后端未连接」与「表单不存在」。
 */
export async function getFormManifest(formKey: string): Promise<FormFieldManifest> {
  const local = registry.get(formKey)
  if (local) return local.manifest

  try {
    return await api<FormFieldManifest>(`/api/wf/forms/${encodeURIComponent(formKey)}/fields`)
  } catch (err) {
    if (err instanceof NetworkError) {
      throw new Error(`无法加载表单「${formKey}」的字段清单：后端未连接`)
    }
    if (err instanceof ApiError) {
      throw new Error(
        `未找到表单「${formKey}」的字段清单：既未在前端 registry 登记（CODE），后端也无对应在线表单（${err.message}）`,
      )
    }
    throw err
  }
}
