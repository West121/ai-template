/**
 * 单据字段源（bizdoc-design.md §10 范式修正二）：
 * INLINE（内置设计，主路径）→ 从 def.formSchema **本地派生**，不调 /api/wf/forms/{key}/fields；
 * CODE / 存量 ONLINE → 维持统一字段清单（getFormManifest：CODE 前端 registry / ONLINE 后端派生）。
 * 纯函数（deriveSchemaFields / schemaKeyIssues）供台账配置、模板设计器字段树、单测共用。
 */
import { widgetsToFields } from "@/pages/workflow/designer/form/fields"
import type { FormWidget as DesignerWidget } from "@/pages/workflow/designer/form/model"
import { getFormManifest } from "@/lib/form-registry"
import type { FormWidget } from "@/types/workflow"
import type { BizDocDef } from "./mock"

export interface DefField {
  key: string
  label: string
}

/**
 * 私有 schema → 字段清单（纯）：复用表单设计器的 widgetsToFields
 * （容器 grid/group/tabs/collapse 透明下钻、跳过 divider/note 布局件与 subform 本身、key 缺省回退 id）。
 */
export function deriveSchemaFields(widgets: FormWidget[] | null | undefined): DefField[] {
  if (!Array.isArray(widgets) || widgets.length === 0) return []
  // 运行时 FormWidget 全可选，结构上是设计器模型的宽化；派生只读 key/label/type/children，安全收窄
  return widgetsToFields(widgets as unknown as DesignerWidget[]).map((f) => ({ key: f.key, label: f.label }))
}

/**
 * 发布校验（§10）：INLINE 要求 schema 非空且字段 key 唯一。
 * 返回问题清单（空数组 = 通过）。
 */
export function schemaKeyIssues(widgets: FormWidget[] | null | undefined): string[] {
  const fields = deriveSchemaFields(widgets)
  if (fields.length === 0) return ["表单为空：请先设计至少一个数据字段"]
  const seen = new Map<string, number>()
  for (const f of fields) seen.set(f.key, (seen.get(f.key) ?? 0) + 1)
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => `字段标识「${k}」重复（${seen.get(k)} 处），请在字段设计器里改唯一`)
}

/** 统一字段源：INLINE=本地派生（同步）；CODE/存量 ONLINE=统一清单（失败回空，由调用方兜底提示） */
export async function fieldsForDef(def: Pick<BizDocDef, "formType" | "formCode" | "formSchema">): Promise<DefField[]> {
  if (def.formType === "INLINE") return deriveSchemaFields(def.formSchema)
  if (!def.formCode) return []
  try {
    const manifest = await getFormManifest(def.formCode)
    return manifest.fields.map((f) => ({ key: f.key, label: f.label }))
  } catch {
    return []
  }
}
