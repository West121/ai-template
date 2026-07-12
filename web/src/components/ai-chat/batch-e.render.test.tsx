// @vitest-environment jsdom
/**
 * 批E 平台联动卡挂载烟测（防白屏第 4 层：新交互"渲染不抛错"）：
 *  1) 三种草稿卡（flowDraft/templateDraft/formDraft）渲染 + 草稿徽标 + 去处按钮
 *  2) confirm 卡内 AI 摘要 + 风险点 + 通过后流转预测链
 *  3) list 卡待办项内 AI 摘要（含"AI 生成仅供参考"顶注）
 *  4) 未知草稿 partType / 垃圾 payload → 降级不炸
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { PartRouter } from "./cards/part-router"
import { ConfirmCard } from "./cards/confirm-card"
import { ListCard } from "./cards/list-card"
import type { AiMessagePart } from "./protocol"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

const part = (over: Partial<AiMessagePart>): AiMessagePart => ({
  partId: "pt_1",
  partType: "flowDraft",
  schemaVersion: 1,
  payload: {},
  sequenceNo: 1,
  ...over,
})

const renderPart = (p: AiMessagePart) =>
  render(
    <MemoryRouter>
      <PartRouter part={p} />
    </MemoryRouter>,
  )

describe("批E 草稿卡挂载", () => {
  it("flowDraft：名称 + 触发 + 节点链 + 确认创建按钮", () => {
    renderPart(
      part({
        partType: "flowDraft",
        payload: { draftId: "fd1", name: "每周审批统计", triggerDesc: "CRON 每周一", nodes: [{ type: "notify", label: "钉钉通知" }] },
      }),
    )
    expect(screen.getByText("每周审批统计")).toBeTruthy()
    expect(screen.getByText(/CRON 每周一/)).toBeTruthy()
    expect(screen.getByText("钉钉通知")).toBeTruthy()
    expect(screen.getByRole("button", { name: /确认创建/ })).toBeTruthy()
    expect(screen.getAllByText("草稿").length).toBeGreaterThan(0)
  })

  it("templateDraft / formDraft：去设计器编辑按钮", () => {
    const { unmount } = renderPart(part({ partType: "templateDraft", payload: { draftId: "td1", name: "采购单模板", blocks: [{ type: "table", label: "明细" }] } }))
    expect(screen.getByText("采购单模板")).toBeTruthy()
    expect(screen.getByRole("button", { name: /去设计器编辑/ })).toBeTruthy()
    unmount()
    renderPart(part({ partType: "formDraft", payload: { draftId: "frm1", name: "报修表", fields: [{ label: "设备", type: "text" }] } }))
    expect(screen.getByText("报修表")).toBeTruthy()
    expect(screen.getByText("设备")).toBeTruthy()
  })

  it("垃圾草稿 payload（缺 draftId）→ 兜底渲染不抛错（默认名 + 按钮禁用）", () => {
    renderPart(part({ partType: "flowDraft", payload: { boom: true } }))
    // 名称回退默认名、确认创建按钮因缺 draftId 禁用
    expect(screen.getByText("自动化编排草稿")).toBeTruthy()
    expect(screen.getByRole("button", { name: /确认创建/ })).toHaveProperty("disabled", true)
  })
})

describe("批E⑨⑩ confirm 卡摘要 + 预测链", () => {
  it("渲染 AI 摘要、风险标签与通过后流转链", () => {
    render(
      <MemoryRouter>
        <ConfirmCard
          card={{
            type: "confirm",
            actionId: "act1",
            title: "同意审批任务",
            aiSummary: { summary: "请假 3 天余额充足", risks: [{ level: "MEDIUM", text: "里程碑周重叠" }] },
            predictChain: [{ stepName: "HR 复核", assigneeName: "李经理" }, { stepName: "归档" }],
          }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("请假 3 天余额充足")).toBeTruthy()
    expect(screen.getByText("里程碑周重叠")).toBeTruthy()
    expect(screen.getByText("通过后流转")).toBeTruthy()
    expect(screen.getByText("HR 复核")).toBeTruthy()
    expect(screen.getByText("李经理")).toBeTruthy()
  })
})

describe("批E⑨ list 卡待办 AI 摘要", () => {
  it("行内摘要 + 风险 + 顶部'AI 生成仅供参考'", () => {
    render(
      <MemoryRouter>
        <ListCard
          card={{
            type: "list",
            title: "我的待办",
            columns: [{ key: "title", label: "标题" }],
            rows: [
              {
                title: "采购申请 ¥42,000",
                link: "/workflow/tasks",
                aiSummary: { summary: "研发服务器采购", risks: [{ level: "HIGH", text: "金额高于部门 90 分位" }] },
              },
            ],
          }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("研发服务器采购")).toBeTruthy()
    expect(screen.getByText("金额高于部门 90 分位")).toBeTruthy()
    expect(screen.getByText("AI 生成仅供参考")).toBeTruthy()
  })
})
