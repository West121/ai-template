/** 表单 widgets → 流程设计器可绑定字段选项 */
import type { FormFieldOption } from "@/pages/workflow/designer/dingtalk/process-designer"
import { isContainerType, isLayoutType, isSubformType, widgetKeyOf, type FormWidget } from "./model"

/** 递归收集可作为条件/绑定字段的数据控件（容器透明下钻，跳过布局/容器/子表单本身） */
export function widgetsToFields(widgets: FormWidget[]): FormFieldOption[] {
  const out: FormFieldOption[] = []
  const walk = (list: FormWidget[]) => {
    for (const w of list) {
      if (isLayoutType(w.type)) continue
      if (isContainerType(w.type)) {
        if (Array.isArray(w.children)) walk(w.children)
        continue
      }
      if (isSubformType(w.type)) continue
      out.push({ key: widgetKeyOf(w), label: w.label, isUser: w.type === "user" })
    }
  }
  walk(widgets)
  return out
}
