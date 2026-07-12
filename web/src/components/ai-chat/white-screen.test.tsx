// @vitest-environment jsdom
/**
 * 防白屏回归(用户两次实测崩溃的复现用例):
 *  1) form 卡 schema 为对象/字符串/垃圾形状 → 渲染降级,不抛错(曾致发起年假白屏)
 *  2) 消息含坏 part → CardBoundary 隔离,消息流仍渲染(结构性防线)
 */
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
// 顶部静态 import:模块在收集阶段加载,不计入单测 5s 超时(测试内 await import 曾致全量并发下 flaky)
import { FormCard } from "./cards/form-card"
import { ChatView } from "./chat-view"

afterEach(cleanup)
vi.spyOn(console, "error").mockImplementation(() => {})

describe("防白屏回归", () => {
  it("form 卡 schema 非数组形状(对象/字符串/垃圾)渲染不抛错", () => {
    for (const schema of [{ widgets: [] }, "not-json{", 123, null] as unknown[]) {
      const { unmount } = render(
        <MemoryRouter>
          <FormCard card={{ type: "form", defCode: "leave", defName: "请假", formType: "ONLINE", schema } as never} />
        </MemoryRouter>,
      )
      // 非法 schema 走"发起页填写"降级分支,页面存活
      expect(screen.getAllByText(/请假/).length).toBeGreaterThan(0)
      unmount()
    }
  })

  it("消息含坏卡时 CardBoundary 隔离,其余内容仍渲染", () => {
    // 故意传非法 message/card 形状触发 CardBoundary → 宽松 cast 绕过严格 props 类型
    const CV = ChatView as unknown as (p: Record<string, unknown>) => ReactNode
    render(
      <MemoryRouter>
        <CV
          messages={[
            {
              role: "ASSISTANT",
              content: "正常文本",
              // schema 传对象会让 FormRenderer 前的归一兜住;这里用彻底垃圾 card 触发 CardBoundary
              cards: [{ type: "form", defCode: null, defName: null, schema: { boom: true } }],
              createdAt: new Date().toISOString(),
            },
          ]}
          sending={false}
          toolStatuses={[]}
          sendError={null}
          offline={false}
          models={[]}
          modelId={null}
          onModelChange={() => {}}
          onSend={() => {}}
          onRetry={() => {}}
          focusSignal={0}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText("正常文本")).toBeTruthy()
  })
})
