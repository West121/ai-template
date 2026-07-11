/**
 * 单据字段源（bizdoc-design.md §10 范式修正二）：
 * INLINE（内置设计，主路径）→ 从 def.formSchema **本地派生**，不调 /api/wf/forms/{key}/fields；
 * CODE / 存量 ONLINE → 维持统一字段清单（getFormManifest：CODE 前端 registry / ONLINE 后端派生）。
 * 纯函数（deriveSchemaFields / schemaKeyIssues）供台账配置、模板设计器字段树、单测共用。
 */
import { isContainerType, isLayoutType, isSubformType } from "@/pages/workflow/designer/form/model"
import { getFormManifest } from "@/lib/form-registry"
import type { FormWidget, WidgetType } from "@/types/workflow"
import type { BizDocDef } from "./mock"

export interface DefField {
  key: string
  label: string
  /** widget/字段类型（user/dept 等关联类字段在字段选择器展开「显示属性」用） */
  type?: string
}

/**
 * 私有 schema → 字段清单（纯，口径同表单设计器 widgetsToFields）：
 * 容器 grid/group/tabs/collapse 透明下钻、跳过 divider/note 布局件与 subform 本身、
 * key 缺省回退 id；额外携带 widget type（关联字段显示属性判断用）。
 */
export function deriveSchemaFields(widgets: FormWidget[] | null | undefined): DefField[] {
  if (!Array.isArray(widgets) || widgets.length === 0) return []
  const out: DefField[] = []
  const walk = (list: FormWidget[]) => {
    for (const w of list) {
      const t = w.type as WidgetType
      if (isLayoutType(t)) continue
      if (isContainerType(t)) {
        if (Array.isArray(w.children)) walk(w.children)
        continue
      }
      if (isSubformType(t)) continue
      out.push({ key: w.key?.trim() || w.id, label: w.label, type: w.type })
    }
  }
  walk(widgets)
  return out
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
    return manifest.fields.map((f) => ({ key: f.key, label: f.label, type: f.type }))
  } catch {
    return []
  }
}
