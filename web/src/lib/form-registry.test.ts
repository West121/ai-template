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
