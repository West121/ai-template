/**
 * BizDoc 模板 JSON v2 用例（bizdoc-design.md §9.1 文档流块级契约）：
 * 往返/双版本判别、路径插值（_approvals）、块树操作、失效检测、样例数据、@page CSS。
 */
import { describe, expect, it } from "vitest"
import { getByPath, interpolate, type BdRenderCtx } from "./model"
import {
  buildPrintPageCss,
  buildSampleData,
  calcIssues,
  calcVarFields,
  evalCalcDemo,
  cloneBlock,
  collectTokens,
  cssPageContent,
  emptyTemplateV2,
  findBlock,
  formatPageNo,
  insertBlock,
  isV2,
  moveBlock,
  newBlock,
  newPageBand,
  numberToChinese,
  pageSizeMm,
  parseAnyTemplate,
  removeBlock,
  staleTokensV2,
  type BdBlock,
  type BdCalc,
  type BdRowBlock,
  type BdTemplateV2,
} from "./model-v2"

const TPL: BdTemplateV2 = {
  schemaVersion: 2,
  page: {
    size: "A4",
    landscape: false,
    margin: [20, 18, 20, 18],
    fontFamily: "宋体",
    pageNumber: { show: true, position: "footer", align: "center", format: "第 {page} 页 / 共 {total} 页", fontSize: 10 },
  },
  blocks: [
    { id: "b1", type: "title", text: "车辆申请", style: { fontSize: 18, bold: true, align: "center" } },
    {
      id: "b2",
      type: "docInfo",
      items: [
        { label: "单据编号", value: "{{docNo}}" },
        { label: "日期", value: "{{createdAt}}" },
      ],
    },
    {
      id: "b3",
      type: "infoTable",
      columnsPerRow: 2,
      cells: [
        { label: "用车人", value: "{{applicant}}" },
        { label: "部门", value: "{{deptName}}" },
      ],
      style: { fontSize: 10.5, labelWidth: 28 },
    },
    { id: "b4", type: "detailTable", field: "items", columns: [{ field: "name", label: "事项", w: 40 }, { field: "amount", label: "金额", w: 25 }] },
    {
      id: "b5",
      type: "approvalTable",
      steps: [{ label: "审批人", value: "{{_approvals.0.assigneeName}}" }],
    },
    {
      id: "b6",
      type: "row",
      children: [
        [{ id: "b6a", type: "signature", label: "签章", align: "left" }],
        [{ id: "b6b", type: "qrcode", value: "{{docNo}}", size: 20, align: "right" }],
      ],
    },
  ],
}

const CTX: BdRenderCtx = {
  data: {
    docNo: "CL〔2026〕003",
    createdAt: "2026-07-11",
    applicant: "张伟",
    deptName: "综合办公室",
    items: [{ name: "接机", amount: 100 }],
    _approvals: [{ nodeName: "部门审批", assigneeName: "王经理", opinion: "同意", time: "2026-07-11 10:00" }],
  },
  fields: { applicant: "用车人" },
}

describe("v2 契约：解析与双版本判别", () => {
  it("parseAnyTemplate：v2 JSON 字符串往返一致", () => {
    const parsed = parseAnyTemplate(JSON.stringify(TPL))
    expect(parsed).toEqual(TPL)
    expect(parsed && isV2(parsed)).toBe(true)
  })

  it("parseAnyTemplate：v1（elements）仍可读；非法回 null", () => {
    const v1 = parseAnyTemplate(JSON.stringify({ schemaVersion: 1, paper: "A4", landscape: false, margin: [10, 10, 10, 10], elements: [] }))
    expect(v1 && !isV2(v1)).toBe(true)
    expect(parseAnyTemplate("{ bad json")).toBeNull()
    expect(parseAnyTemplate({ schemaVersion: 2 })).toBeNull()
  })

  it("pageSizeMm：Letter/横向交换宽高", () => {
    expect(pageSizeMm({ size: "Letter", landscape: false })).toEqual({ w: 215.9, h: 279.4 })
    expect(pageSizeMm({ size: "A5", landscape: true })).toEqual({ w: 210, h: 148 })
  })
})

describe("插值：点路径与审批数据（§9.1/§9.3）", () => {
  it("getByPath / interpolate 解析 _approvals.0.assigneeName", () => {
    expect(getByPath(CTX.data, "_approvals.0.assigneeName")).toBe("王经理")
    expect(interpolate("审批人：{{_approvals.0.assigneeName}}（{{_approvals.0.time}}）", CTX.data)).toBe("审批人：王经理（2026-07-11 10:00）")
  })

  it("缺失路径输出空串（未办审批步骤）", () => {
    expect(interpolate("{{_approvals.5.opinion}}", CTX.data)).toBe("")
  })

  it("formatPageNo 替换 {page}/{total}", () => {
    expect(formatPageNo("第 {page} 页 / 共 {total} 页", 2, 3)).toBe("第 2 页 / 共 3 页")
  })
})

describe("块树操作（设计器）", () => {
  it("newBlock 全类型有合法缺省；cloneBlock 深拷贝重发号（含 row 子块）", () => {
    const types = ["title", "docInfo", "infoTable", "labelField", "text", "detailTable", "approvalTable", "row", "signature", "qrcode", "barcode", "image", "divider", "spacer"] as const
    const ids = new Set<string>()
    for (const t of types) {
      const b = newBlock(t)
      expect(b.type).toBe(t)
      expect(b.id).toBeTruthy()
      ids.add(b.id)
    }
    expect(ids.size).toBe(types.length)

    const row = TPL.blocks.find((b) => b.id === "b6") as BdRowBlock
    const copy = cloneBlock(row) as BdRowBlock
    expect(copy.id).not.toBe(row.id)
    expect(copy.children[0][0].id).not.toBe(row.children[0][0].id)
    expect(copy.children[1][0].type).toBe("qrcode")
  })

  it("findBlock 可寻址 row 栏内块；insert/move/remove 纯函数不改原数组", () => {
    const hit = findBlock(TPL.blocks, "b6b")
    expect(hit?.path).toEqual({ parent: "b6", col: 1, index: 0 })

    const spacer = newBlock("spacer")
    const inserted = insertBlock(TPL.blocks, spacer, { parent: null, col: 0, index: 1 })
    expect(inserted[1].id).toBe(spacer.id)
    expect(TPL.blocks[1].id).toBe("b2")

    // 移动 b1 到根级末尾
    const moved = moveBlock(inserted, "b1", { parent: null, col: 0, index: inserted.length })
    expect(moved[moved.length - 1].id).toBe("b1")

    // 移进 row 第 0 栏
    const intoRow = moveBlock(TPL.blocks, "b1", { parent: "b6", col: 0, index: 0 })
    expect(findBlock(intoRow, "b1")?.path.parent).toBe("b6")

    const removed = removeBlock(TPL.blocks, "b6a")
    expect(findBlock(removed, "b6a")).toBeNull()
    expect(findBlock(TPL.blocks, "b6a")).not.toBeNull()
  })

  it("row 不允许嵌 row（insert/move 原样返回）", () => {
    const row2 = newBlock("row")
    expect(insertBlock(TPL.blocks, row2, { parent: "b6", col: 0, index: 0 })).toBe(TPL.blocks)
    const withRow = insertBlock(TPL.blocks, row2, { parent: null, col: 0, index: 0 })
    expect(moveBlock(withRow, row2.id, { parent: "b6", col: 0, index: 0 })).toBe(withRow)
  })
})

describe("token 收集与失效检测", () => {
  it("collectTokens 覆盖 docInfo/infoTable/approvalTable/qrcode", () => {
    const exprs = collectTokens(TPL).map((t) => t.expr)
    expect(exprs).toContain("docNo")
    expect(exprs).toContain("applicant")
    expect(exprs).toContain("_approvals.0.assigneeName")
  })

  it("staleTokensV2：系统字段/_approvals/字段清单内不算失效；未知键算", () => {
    expect(staleTokensV2(TPL, CTX)).toEqual([])
    const bad: BdTemplateV2 = {
      ...TPL,
      blocks: [
        { id: "x1", type: "labelField", label: "神秘", value: "{{ghostField}}" } as BdBlock,
        { id: "x2", type: "detailTable", field: "ghostRows", columns: [{ field: "a", label: "A" }] } as BdBlock,
      ],
    }
    const stale = staleTokensV2(bad, { data: {}, fields: {} })
    expect(stale.map((s) => s.expr).sort()).toEqual(["ghostField", "ghostRows"])
  })
})

describe("预览样例与打印 @page CSS", () => {
  it("buildSampleData：字段取「label示例」、明细给 2 行、_approvals 就位", () => {
    const data = buildSampleData(TPL, { applicant: "用车人" })
    expect(data.applicant).toBe("用车人示例")
    expect(Array.isArray(data.items) && (data.items as unknown[]).length).toBe(2)
    expect(Array.isArray(data._approvals)).toBe(true)
    expect(interpolate("{{_approvals.0.assigneeName}}", data)).toBe("王经理")
  })

  it("cssPageContent：{page}/{total} → counter，字面量加引号", () => {
    expect(cssPageContent("第 {page} 页 / 共 {total} 页")).toBe('"第 " counter(page) " 页 / 共 " counter(pages) " 页"')
    expect(cssPageContent("- {page} -")).toBe('"- " counter(page) " -"')
  })

  it("buildPrintPageCss：v2 出纸张/边距/页码 margin box（缺省 muted 灰）；v1 margin 0", () => {
    const css = buildPrintPageCss(TPL)
    expect(css).toContain("size: A4 portrait")
    expect(css).toContain("margin: 20mm 18mm 20mm 18mm")
    expect(css).toContain("@bottom-center")
    expect(css).toContain("counter(pages)")
    expect(css).toContain("color: #9ca3af")

    const noPn: BdTemplateV2 = { ...TPL, page: { ...TPL.page, pageNumber: { ...TPL.page.pageNumber, show: false } } }
    expect(buildPrintPageCss(noPn)).not.toContain("@bottom")

    const v1 = { schemaVersion: 1 as const, paper: "A5" as const, landscape: true, margin: [10, 10, 10, 10] as [number, number, number, number], elements: [] }
    expect(buildPrintPageCss(v1)).toBe("@page { size: A5 landscape; margin: 0; }")
  })

  it("emptyTemplateV2 缺省：A4/20mm 边距/宋体/页脚居中页码", () => {
    const t = emptyTemplateV2()
    expect(t.schemaVersion).toBe(2)
    expect(t.page.margin).toEqual([20, 20, 20, 20])
    expect(t.page.pageNumber.show).toBe(true)
    expect(t.blocks).toEqual([])
  })
})

describe("页眉/页脚 band 与页码颜色（对齐参考编辑器四项差距）", () => {
  it("buildPrintPageCss：band 按数据插值出 @top/@bottom；页码自定义色生效", () => {
    const withBands: BdTemplateV2 = {
      ...TPL,
      page: {
        ...TPL.page,
        pageNumber: { ...TPL.page.pageNumber, align: "center", color: "#1d4ed8" },
        header: { text: "涵韬科技", align: "left", fontSize: 8.5 },
        footer: { text: "编号 {{docNo}}", align: "right", fontSize: 8.5 },
      },
    }
    const css = buildPrintPageCss(withBands, { docNo: "CL〔2026〕003" })
    expect(css).toContain('@top-left { content: "涵韬科技"')
    expect(css).toContain('@bottom-right { content: "编号 CL〔2026〕003"')
    expect(css).toContain("@bottom-center")
    expect(css).toContain("color: #1d4ed8")
  })

  it("band 与页码同边同槽 → 并排合并到一个 margin box（全角空格分隔）", () => {
    const merged: BdTemplateV2 = {
      ...TPL,
      page: {
        ...TPL.page,
        pageNumber: { ...TPL.page.pageNumber, position: "footer", align: "center" },
        footer: { text: "机密", align: "center", fontSize: 9 },
      },
    }
    const css = buildPrintPageCss(merged, {})
    expect(css.match(/@bottom-center/g)?.length).toBe(1)
    expect(css).toContain('"机密" "　" "第 " counter(page)')
  })

  it("collectTokens / buildSampleData 覆盖 band token", () => {
    const withBands: BdTemplateV2 = {
      ...TPL,
      page: {
        ...TPL.page,
        header: { text: "{{orgName}}", align: "left", fontSize: 8.5 },
        footer: { text: "编号 {{docNo}}", align: "right", fontSize: 8.5 },
      },
    }
    const exprs = collectTokens(withBands).map((t) => t.expr)
    expect(exprs).toContain("orgName")
    const data = buildSampleData(withBands, {})
    expect(data.orgName).toBe("orgName示例")
  })

  it("关联字段显示属性：{{handler.name}} 走对象子键（磐石解析 user/dept 为对象）", () => {
    expect(
      interpolate("经办：{{handler.name}}（{{handler.username}}）", { handler: { id: 5, name: "李文", username: "liwen" } }),
    ).toBe("经办：李文（liwen）")
    // 根 token 落对象 → formatValue 取 name
    expect(interpolate("{{handler}}", { handler: { name: "李文" } })).toBe("李文")
  })

  it("v2 往返：header/footer/pageNumber.color 序列化不丢", () => {
    const t: BdTemplateV2 = {
      ...TPL,
      page: {
        ...TPL.page,
        pageNumber: { ...TPL.page.pageNumber, color: "#000000" },
        header: newPageBand("header"),
        footer: { text: "自定义页脚", align: "left", fontSize: 10 },
      },
    }
    expect(parseAnyTemplate(JSON.stringify(t))).toEqual(t)
  })
})

/* ============================ §12 计算配置 ============================ */

const CALC: BdCalc = {
  aggregates: [
    { name: "total_amount", label: "合计金额", source: "items", field: "amount", fn: "SUM", format: "number", scale: 2 },
    { name: "total_cn", label: "合计大写", source: "items", field: "amount", fn: "SUM", format: "chinese", scale: 2 },
    { name: "item_count", label: "条目数", source: "items", field: "", fn: "COUNT", format: "number", scale: 0 },
    { name: "max_amount", label: "单笔最大", source: "items", field: "amount", fn: "MAX", format: "number", scale: 1 },
  ],
  computed: [
    { name: "amount_with_tax", label: "含税合计", expr: "round(total_amount * 1.06, 2)", format: "number", scale: 2 },
    { name: "tax_cn", label: "含税大写", expr: "numberToChinese(total_amount * 1.06)", format: "chinese", scale: 2 },
    { name: "broken", label: "坏公式", expr: "amount *", format: "number", scale: 2 },
  ],
}

const CALC_DATA = { items: [{ amount: 620.5 }, { amount: 1560 }, { amount: 200 }], quantity: 3 }

describe("§12 计算配置：往返 / 求值 / 校验", () => {
  it("calc 段随 v2 模板序列化往返不丢", () => {
    const t: BdTemplateV2 = { ...TPL, calc: CALC }
    const back = parseAnyTemplate(JSON.stringify(t))
    expect(back).toEqual(t)
    expect((back as BdTemplateV2).calc?.aggregates.length).toBe(4)
  })

  it("numberToChinese：人民币大写（元/角/分/整/负数/跨组零）", () => {
    expect(numberToChinese(0)).toBe("零元整")
    expect(numberToChinese(2380.5)).toBe("贰仟叁佰捌拾元伍角")
    expect(numberToChinese(1002.03)).toBe("壹仟零贰元零叁分")
    expect(numberToChinese(-45.67)).toBe("负肆拾伍元陆角柒分")
  })

  it("evalCalcDemo：聚合 SUM/COUNT/MAX + 格式化（定点/中文大写）", () => {
    const out = evalCalcDemo(CALC, CALC_DATA)
    expect(out.total_amount).toBe("2380.50")
    expect(out.item_count).toBe("3")
    expect(out.max_amount).toBe("1560.0")
    expect(out.total_cn).toBe("贰仟叁佰捌拾元伍角")
  })

  it("evalCalcDemo：computed 引聚合名、numberToChinese 包裹；坏公式置 - 不阻断", () => {
    const out = evalCalcDemo(CALC, CALC_DATA)
    expect(out.amount_with_tax).toBe("2523.33")
    expect(out.tax_cn).toContain("元")
    expect(out.broken).toBe("-")
  })

  it("evalCalcDemo：数据源缺失/非数组 → 该变量置 -", () => {
    const out = evalCalcDemo(CALC, { quantity: 1 })
    expect(out.total_amount).toBe("-")
  })

  it("calcIssues：重名/公式空/聚合未选子表/非法名 全拦；合法配置通过", () => {
    // 合法配置（剔除演示用坏公式）通过；坏公式被语法校验拦
    const okCalc: BdCalc = { ...CALC, computed: CALC.computed.filter((c) => c.name !== "broken") }
    expect(calcIssues(okCalc, { quantity: "数量" })).toEqual([])
    expect(calcIssues(CALC, { quantity: "数量" }).some((s) => s.includes("语法错误"))).toBe(true)
    // 与表单字段重名
    expect(calcIssues(okCalc, { total_amount: "合计" }).some((s) => s.includes("重名"))).toBe(true)
    // 与系统字段重名
    const sysClash: BdCalc = { aggregates: [], computed: [{ name: "docNo", label: "", expr: "1+1", format: "number", scale: 0 }] }
    expect(calcIssues(sysClash, {}).some((s) => s.includes("重名"))).toBe(true)
    // 内部重复
    const dup: BdCalc = {
      aggregates: [{ name: "a", label: "", source: "items", field: "x", fn: "SUM", format: "number", scale: 0 }],
      computed: [{ name: "a", label: "", expr: "1", format: "number", scale: 0 }],
    }
    expect(calcIssues(dup, {}).some((s) => s.includes("重复"))).toBe(true)
    // 公式空 / 未选子表 / 非法名
    const bad: BdCalc = {
      aggregates: [{ name: "agg1", label: "", source: "", field: "x", fn: "SUM", format: "number", scale: 0 }],
      computed: [
        { name: "c1", label: "", expr: "  ", format: "number", scale: 0 },
        { name: "1bad", label: "", expr: "1", format: "number", scale: 0 },
      ],
    }
    const issues = calcIssues(bad, {})
    expect(issues.some((s) => s.includes("数据源"))).toBe(true)
    expect(issues.some((s) => s.includes("公式为空"))).toBe(true)
    expect(issues.some((s) => s.includes("非法"))).toBe(true)
  })

  it("calcVarFields：字段树「计算变量」组（label 缺省回退 name）", () => {
    expect(calcVarFields(CALC).map((f) => f.key)).toEqual([
      "total_amount",
      "total_cn",
      "item_count",
      "max_amount",
      "amount_with_tax",
      "tax_cn",
      "broken",
    ])
    expect(calcVarFields({ aggregates: [], computed: [{ name: "x", label: "", expr: "1", format: "number", scale: 0 }] })[0].label).toBe("x")
    expect(calcVarFields(undefined)).toEqual([])
  })

  it("staleTokensV2：计算变量 token 不算失效", () => {
    const t: BdTemplateV2 = {
      ...TPL,
      calc: CALC,
      blocks: [...TPL.blocks, { id: "c1", type: "labelField", label: "合计", value: "{{total_cn}}" } as BdBlock],
    }
    expect(staleTokensV2(t, CTX).filter((s) => s.expr === "total_cn")).toEqual([])
  })
})
