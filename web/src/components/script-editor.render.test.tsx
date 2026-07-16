// @vitest-environment jsdom
/**
 * 脚本编辑器精简布局 冒烟：
 *  - 安全警告一行常显（治理红线不可删）+ 语言 Tab + CodeEditor 主视觉
 *  - 「测试运行 / 调试」默认收起（上下文/样例变量/测试运行折进去）；展开后功能齐全
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"
import { useAppStore } from "@/stores/app-store"
import { resetScriptContextManifestCache } from "@/lib/script-context-completion"
import { ScriptEditor } from "./script-editor"

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
})
beforeEach(() => {
  // afterEach 会 unstubAllGlobals，这里每用例重挂 matchMedia
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetScriptContextManifestCache() // manifest 模块级缓存跨用例清空
})
vi.spyOn(console, "error").mockImplementation(() => {})

const renderEditor = () => {
  useAuthStore.setState({ permissions: null, offline: false, token: "t" }) // permissions=null → wf:script:write 视为放行
  useAppStore.setState({ themeMode: "light" })
  return render(
    <TooltipProvider>
      <ScriptEditor value={{ lang: "groovy", code: "return true" }} onChange={() => {}} />
    </TooltipProvider>,
  )
}

describe("ScriptEditor 精简布局", () => {
  it("安全警告一行常显 + CodeEditor 主视觉 + 调试区默认收起", () => {
    const { container } = renderEditor()
    // 治理红线：非沙箱 + 完整权限一行必可见
    expect(screen.getByText(/脚本以应用完整权限运行 · 非沙箱/)).toBeTruthy()
    // 主视觉：语言 Tab + 代码编辑器
    expect(screen.getByRole("tab", { name: "Groovy" })).toBeTruthy()
    expect(container.querySelector(".cm-editor")).toBeTruthy()
    // 调试区折叠：触发器在、但「测试运行」按钮/上下文默认不渲染
    expect(screen.getByRole("button", { name: /测试运行 \/ 调试/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "测试运行" })).toBeNull()
    expect(screen.queryByText("可用上下文（后端注入）")).toBeNull()
  })

  it("展开「测试运行 / 调试」→ 上下文 + 样例变量 + 测试运行按钮齐全", async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole("button", { name: /测试运行 \/ 调试/ }))
    expect(await screen.findByText("可用上下文（后端注入）")).toBeTruthy()
    expect(screen.getByRole("button", { name: "测试运行" })).toBeTruthy()
    expect(screen.getByText(/样例流程变量/)).toBeTruthy()
  })

  it("placeholder 为单行提示（多行假代码会被误当成真内容），空文档时可见", () => {
    useAuthStore.setState({ permissions: null, offline: false, token: "t" })
    useAppStore.setState({ themeMode: "light" })
    const { container } = render(
      <TooltipProvider>
        <ScriptEditor value={{ lang: "groovy", code: "" }} onChange={() => {}} />
      </TooltipProvider>,
    )
    const ph = container.querySelector(".cm-placeholder")
    expect(ph).toBeTruthy()
    expect(ph!.textContent ?? "").not.toContain("\n") // 单行
    expect(ph!.textContent).toContain("插入示例") // 引导到真插入
    expect(ph!.textContent).not.toContain("log.info") // 不再是假代码
  })

  it("插入示例：空文档点击 → 示例真正写入 value（可编辑真文本），不需确认", async () => {
    useAuthStore.setState({ permissions: null, offline: false, token: "t" })
    useAppStore.setState({ themeMode: "light" })
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <ScriptEditor value={{ lang: "groovy", code: "" }} onChange={onChange} />
      </TooltipProvider>,
    )
    await user.click(screen.getByRole("button", { name: /插入示例/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as { lang: string; code: string }
    expect(next.lang).toBe("groovy")
    expect(next.code).toContain("log.info") // 示例成为真 value
    expect(screen.queryByText(/替换当前脚本/)).toBeNull()
  })

  it("插入示例：已有内容 → 弹确认，确认后替换为示例", async () => {
    useAuthStore.setState({ permissions: null, offline: false, token: "t" })
    useAppStore.setState({ themeMode: "light" })
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <ScriptEditor value={{ lang: "java", code: "return null;" }} onChange={onChange} />
      </TooltipProvider>,
    )
    await user.click(screen.getByRole("button", { name: /插入示例/ }))
    expect(onChange).not.toHaveBeenCalled() // 先确认，不直接覆盖
    expect(await screen.findByText(/用 Java 示例替换当前脚本/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "替换为示例" }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((onChange.mock.calls[0][0] as { code: string }).code).toContain("hello from java")
  })

  it("Java Tab 渲染 + lang=java 时显示方法体 returnHint", () => {
    useAuthStore.setState({ permissions: null, offline: false, token: "t" })
    useAppStore.setState({ themeMode: "light" })
    render(
      <TooltipProvider>
        <ScriptEditor value={{ lang: "java", code: "return null;" }} onChange={() => {}} />
      </TooltipProvider>,
    )
    // Java Tab 在（第四语言）且选中态；returnHint 为方法体语义
    expect(screen.getByRole("tab", { name: "Java" }).getAttribute("data-state")).toBe("active")
    expect(screen.getByText(/方法体语义/)).toBeTruthy()
    expect(screen.getByText(/import java\.util\.\*/)).toBeTruthy()
  })

  it("manifest 拉到 → 三层速查：推荐 API 展开 / 全部服务折叠+搜索 / 工具类重名区分 / imports 行", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/api/wf/script/context-manifest")) {
        return {
          status: 200,
          json: async () => ({
            code: 0,
            data: {
              vars: [{ name: "vars", type: "Map<String,Object>", desc: "流程变量读写" }],
              langs: [],
              beans: [
                { name: "scriptOrgApi", className: "x.ScriptOrgApi", desc: "组织查询", tier: "api", methods: [{ name: "deptName", params: [{ name: "deptId", type: "Long" }], returnType: "String", doc: "部门名" }] },
                { name: "sysUserService", className: "x.SysUserService", desc: "SysUserService", tier: "service", methods: [{ name: "assignments", params: [{ name: "userId", type: "Long" }], returnType: "List" }] },
                { name: "otherService", className: "x.OtherService", desc: "OtherService", tier: "service", methods: [{ name: "doThing", params: [], returnType: "void" }] },
              ],
              statics: [
                { simpleName: "StringUtils", className: "org.springframework.util.StringUtils", methods: [{ name: "hasText", params: [{ name: "str", type: "String" }], returnType: "boolean" }] },
                { simpleName: "StringUtils", className: "org.apache.commons.lang3.StringUtils", methods: [{ name: "abbreviate", params: [], returnType: "String" }] },
              ],
              imports: ["java.util.*", "org.springframework.util.*"],
            },
          }),
        } as unknown as Response
      }
      return { status: 200, json: async () => ({ code: 0, data: null }) } as unknown as Response
    })
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole("button", { name: /测试运行 \/ 调试/ }))
    // vars 带类型 + imports 行
    expect(await screen.findByText("vars: Map<String,Object>")).toBeTruthy()
    expect(screen.getByText(/Java 预置 import/)).toBeTruthy()
    // 推荐 API 默认展开：方法 + doc 直接可见
    expect(screen.getByText(/推荐 API（1）/)).toBeTruthy()
    expect(screen.getByText(/deptName\(deptId: Long\): String/)).toBeTruthy()
    expect(screen.getByText("部门名")).toBeTruthy()
    // 全部服务折叠：折叠态不渲染 bean（性能）；展开后搜索过滤 + 方法按需渲染
    expect(screen.queryByText("sysUserService")).toBeNull()
    await user.click(screen.getByText(/全部服务（2）/))
    expect(await screen.findByText("sysUserService")).toBeTruthy()
    expect(screen.queryByText(/assignments\(userId: Long\)/)).toBeNull() // 未展开条目不渲染方法
    await user.type(screen.getByPlaceholderText("搜索服务名 / 方法名"), "assignments")
    expect(await screen.findByText(/assignments\(userId: Long\): List/)).toBeTruthy() // 方法名命中 → 自动展开
    expect(screen.queryByText("otherService")).toBeNull() // 未命中的被过滤
    // 工具类折叠：展开后两个 StringUtils 以 className 区分
    await user.click(screen.getByText(/工具类（2）/))
    expect(await screen.findByText("org.springframework.util.StringUtils")).toBeTruthy()
    expect(screen.getByText("org.apache.commons.lang3.StringUtils")).toBeTruthy()
  })

  it("manifest 404 → 静默降级：回退硬编码速查，不炸", async () => {
    vi.stubGlobal("fetch", async () => ({ status: 404, json: async () => ({ code: 404, message: "Not Found" }) }) as unknown as Response)
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole("button", { name: /测试运行 \/ 调试/ }))
    expect(await screen.findByText("可用上下文（后端注入）")).toBeTruthy()
    expect(screen.getByText("vars")).toBeTruthy() // 硬编码兜底项
    expect(screen.queryByText(/受信 Spring Beans/)).toBeNull()
  })

  it("放大 → Modal 里是完整 ScriptEditor（语言 Tab 在弹窗内可切）+ 防递归 + 可全屏", async () => {
    const user = userEvent.setup()
    renderEditor()
    // 内嵌：语言 Tab 4 个（groovy/js/python/java）+ 一个「放大」按钮
    expect(screen.getAllByRole("tab")).toHaveLength(4)
    await user.click(screen.getByRole("button", { name: "放大编辑" }))
    // Modal：标题 + 完整 ScriptEditor（语言 Tab 变 4×2=8，安全警告两份）
    expect(await screen.findByText("编辑脚本")).toBeTruthy()
    await waitFor(() => expect(document.querySelectorAll('[role="tab"]').length).toBe(8))
    expect(document.querySelectorAll(".cm-editor").length).toBe(2)
    // 防递归：弹窗内实例无放大按钮（全局仍 1 个）
    expect(document.querySelectorAll('[aria-label="放大编辑"]')).toHaveLength(1)
    // 项目高级弹窗：带「全屏」按钮（fullscreenable）
    expect(document.querySelector('[aria-label="全屏"]')).toBeTruthy()
  })
})
