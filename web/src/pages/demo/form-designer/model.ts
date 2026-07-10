/**
 * 表单设计器 demo 模型：核心 widget 模型已抽至
 * src/pages/workflow/designer/form/model.ts 复用（工作流表单定义共用），
 * 这里保留 re-export 与 demo 专属的示例数据。
 */
import { createWidget, type FormWidget } from "@/pages/workflow/designer/form/model"

export {
  FORM_USERS,
  WIDGET_CATEGORIES,
  WIDGET_META,
  createWidget,
  newWidgetId,
  type FormWidget,
  type WidgetType,
} from "@/pages/workflow/designer/form/model"

export function initialWidgets(): FormWidget[] {
  const type = createWidget("select")
  type.label = "请假类型"
  type.options = ["年假", "事假", "病假", "调休"]
  type.placeholder = "请选择请假类型"
  type.required = true
  type.width = "half"

  const days = createWidget("number")
  days.label = "请假天数"
  days.placeholder = "请输入天数"
  days.required = true
  days.width = "half"

  const start = createWidget("date")
  start.label = "开始日期"
  start.required = true
  start.width = "half"

  const end = createWidget("date")
  end.label = "结束日期"
  end.required = true
  end.width = "half"

  const urgent = createWidget("radio")
  urgent.label = "紧急程度"
  urgent.options = ["普通", "紧急"]
  urgent.width = "half"

  const cc = createWidget("user")
  cc.label = "抄送人"
  cc.width = "half"

  // 联动示例：仅当「紧急程度 = 紧急」时显示并必填
  const urgentReason = createWidget("input")
  urgentReason.label = "紧急原因"
  urgentReason.placeholder = "请说明紧急原因"
  urgentReason.visibleWhen = { logic: "AND", conditions: [{ field: urgent.id, operator: "eq", value: "紧急" }] }
  urgentReason.requiredWhen = { logic: "AND", conditions: [{ field: urgent.id, operator: "eq", value: "紧急" }] }

  const reason = createWidget("textarea")
  reason.label = "请假事由"
  reason.placeholder = "请填写请假事由"
  reason.required = true
  reason.description = "请如实填写，将作为审批依据"

  // 子表单示例：行程/交接明细
  const handover = createWidget("subform")
  handover.label = "工作交接明细"
  handover.props = { mode: "table" }
  handover.children = [
    { ...createWidget("input"), label: "事项" },
    { ...createWidget("user"), label: "交接人" },
    { ...createWidget("date"), label: "完成日期" },
  ]

  const note = createWidget("note")
  note.content = "提交后将按「部门主管 → 人事」流程审批，3 天以上需总经理加签。"

  // 第二波控件展示：金额 / 附件 / 省市区 / 关联表单 / 手写签名
  const showcase = createWidget("divider")
  showcase.content = "第二波控件预览"

  const amount = createWidget("amount")
  amount.label = "补贴金额"
  amount.width = "half"

  const address = createWidget("address")
  address.label = "常住地址"
  address.width = "half"

  const attach = createWidget("upload")
  attach.label = "证明附件"

  const relation = createWidget("relation")
  relation.label = "关联项目"
  relation.width = "half"

  const sign = createWidget("signature")
  sign.label = "本人签名"
  sign.width = "half"

  return [
    type, days, start, end, urgent, cc, urgentReason, reason, handover, note,
    showcase, amount, address, attach, relation, sign,
  ]
}
