/**
 * §11 独立单据模板：卡片筛选 / 实例匹配 纯函数用例。
 */
import { describe, expect, it } from "vitest"
import { emptyTemplateV2 } from "@/components/bizdoc/model-v2"
import { filterTpls, matchTplsForInstance, type BizDocTpl } from "./tpls"

const tpl = (over: Partial<BizDocTpl>): BizDocTpl => ({
  id: 1,
  code: "t1",
  name: "模板",
  bindType: "FLOW",
  bindCode: "leave_flow",
  status: "PUBLISHED",
  version: 1,
  paper: "A4",
  landscape: false,
  content: emptyTemplateV2(),
  ...over,
})

const LIST: BizDocTpl[] = [
  tpl({ id: 1, code: "leave_print", name: "请假条", category: "人事", bindType: "FLOW", bindCode: "leave_flow" }),
  tpl({ id: 2, code: "gw_send_sheet", name: "发文审批单", category: "公文", bindType: "FLOW", bindCode: "gw_send" }),
  tpl({ id: 3, code: "expense_form_print", name: "报销申请打印", category: "财务", bindType: "FORM", bindCode: "expense_form", status: "DRAFT", version: 0 }),
  tpl({ id: 4, code: "biz_only", name: "业务单据模板", bindType: "BIZDOC", bindCode: null, defId: 1 }),
]

describe("filterTpls（卡片列表筛选）", () => {
  it("关键词命中名称或编码（大小写不敏感）", () => {
    expect(filterTpls(LIST, { keyword: "请假" }).map((t) => t.id)).toEqual([1])
    expect(filterTpls(LIST, { keyword: "GW_SEND" }).map((t) => t.id)).toEqual([2])
  })

  it("分类 / 绑定类型精确筛选，可叠加", () => {
    expect(filterTpls(LIST, { category: "财务" }).map((t) => t.id)).toEqual([3])
    expect(filterTpls(LIST, { bindType: "FLOW" }).map((t) => t.id)).toEqual([1, 2])
    expect(filterTpls(LIST, { bindType: "FLOW", category: "公文" }).map((t) => t.id)).toEqual([2])
  })

  it("空筛选返回全部", () => {
    expect(filterTpls(LIST, {}).length).toBe(4)
  })
})

describe("matchTplsForInstance（for-instance 口径）", () => {
  it("FLOW：已发布 + bindCode===defCode", () => {
    expect(matchTplsForInstance(LIST, { defCode: "leave_flow" }).map((t) => t.id)).toEqual([1])
    expect(matchTplsForInstance(LIST, { defCode: "gw_send" }).map((t) => t.id)).toEqual([2])
  })

  it("FORM：需已发布——DRAFT 不命中；发布后命中", () => {
    expect(matchTplsForInstance(LIST, { formCode: "expense_form" })).toEqual([])
    const published = LIST.map((t) => (t.id === 3 ? { ...t, status: "PUBLISHED" as const, version: 1 } : t))
    expect(matchTplsForInstance(published, { formCode: "expense_form" }).map((t) => t.id)).toEqual([3])
  })

  it("无提示 / 不匹配 → 空（按钮隐藏口径）；BIZDOC 绑定不参与实例匹配", () => {
    expect(matchTplsForInstance(LIST, {})).toEqual([])
    expect(matchTplsForInstance(LIST, { defCode: "unknown_flow" })).toEqual([])
  })
})
