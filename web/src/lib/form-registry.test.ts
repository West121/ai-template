import { afterEach, describe, expect, it, vi } from "vitest"
import type { FunctionComponent } from "react"
import type { FormFieldManifest } from "@/lib/form-manifest"
import {
  getForm,
  getFormManifest,
  isCodeForm,
  registerForm,
  registeredFormKeys,
  type HostedFormComponentProps,
} from "@/lib/form-registry"

const Dummy: FunctionComponent<HostedFormComponentProps> = () => null

const codeManifest: FormFieldManifest = {
  formKey: "demo_code",
  formType: "CODE",
  fields: [{ key: "a", label: "字段A", type: "input" }],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("formRegistry", () => {
  it("registerForm / getForm 注册与取用", () => {
    registerForm("demo_code", { component: Dummy, manifest: codeManifest })
    const entry = getForm("demo_code")
    expect(entry?.component).toBe(Dummy)
    expect(entry?.manifest).toEqual(codeManifest)
    expect(isCodeForm("demo_code")).toBe(true)
    expect(registeredFormKeys()).toContain("demo_code")
  })

  it("getForm 未登记返回 undefined", () => {
    expect(getForm("__nope__")).toBeUndefined()
    expect(isCodeForm("__nope__")).toBe(false)
  })

  it("getFormManifest：CODE 命中本地 registry，不发请求", async () => {
    registerForm("demo_code", { component: Dummy, manifest: codeManifest })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const m = await getFormManifest("demo_code")
    expect(m).toEqual(codeManifest)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("getFormManifest：ONLINE 未登记 → 走后端端点", async () => {
    const online: FormFieldManifest = {
      formKey: "leave_online",
      formType: "ONLINE",
      fields: [{ key: "days", label: "天数", type: "number" }],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 0, message: "ok", data: online }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    const m = await getFormManifest("leave_online")
    expect(m).toEqual(online)
  })

  it("getFormManifest：ONLINE formKey 带版本(leave:1) → 后端用纯 code(leave) 查", async () => {
    const online: FormFieldManifest = {
      formKey: "leave",
      formType: "ONLINE",
      fields: [{ key: "days", label: "请假天数", type: "number" }],
    }
    const fetchSpy = vi.fn(async (_url?: unknown) =>
      new Response(JSON.stringify({ code: 0, message: "ok", data: online }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchSpy)
    const m = await getFormManifest("leave:1")
    expect(m).toEqual(online)
    // 关键:请求的是 /api/wf/forms/leave/fields,不是 leave:1(去掉版本后缀)
    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "")
    expect(url).toContain("/api/wf/forms/leave/fields")
    expect(url).not.toContain("leave:1")
  })

  it("getFormManifest：CODE formKey 带版本 → registry 按纯 code 兜底命中，不发请求", async () => {
    registerForm("demo_code", { component: Dummy, manifest: codeManifest })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const m = await getFormManifest("demo_code:3")
    expect(m).toEqual(codeManifest)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("getFormManifest：ONLINE 404 → 抛清晰错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 404, message: "表单不存在", data: null }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    await expect(getFormManifest("__ghost__")).rejects.toThrow(/未找到表单/)
  })
})
