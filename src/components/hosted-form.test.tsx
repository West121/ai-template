import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { fieldStateOf, type FieldPolicyMap } from "@/lib/form-manifest"
import { registerForm, type HostedFormComponentProps } from "@/lib/form-registry"
import { HostedForm } from "@/components/hosted-form"

/** 极简注册组件：逐字段用 fieldStateOf 套用策略（visible 隐藏 / editable=false disabled / required）。 */
const FIELDS = ["name", "amount", "secret"] as const
function ProbeForm({ fieldPolicy }: HostedFormComponentProps) {
  return (
    <div>
      {FIELDS.map((key) => {
        const st = fieldStateOf(fieldPolicy, key)
        if (st.hidden) return null
        return <input key={key} name={key} disabled={st.disabled} required={st.required} defaultValue="" />
      })}
    </div>
  )
}

registerForm("__probe__", {
  component: ProbeForm,
  manifest: {
    formKey: "__probe__",
    formType: "CODE",
    fields: FIELDS.map((k) => ({ key: k, label: k, type: "input" })),
  },
})

describe("fieldStateOf", () => {
  it("缺省策略全放行", () => {
    expect(fieldStateOf(undefined, "x")).toEqual({ hidden: false, disabled: false, required: false })
  })
  it("visible=false → hidden；editable=false → disabled；required=true → required", () => {
    const policy: FieldPolicyMap = {
      a: { visible: false, editable: true, required: false },
      b: { visible: true, editable: false, required: false },
      c: { visible: true, editable: true, required: true },
    }
    expect(fieldStateOf(policy, "a")).toEqual({ hidden: true, disabled: false, required: false })
    expect(fieldStateOf(policy, "b")).toEqual({ hidden: false, disabled: true, required: false })
    expect(fieldStateOf(policy, "c")).toEqual({ hidden: false, disabled: false, required: true })
  })
})

describe("HostedForm 套用 fieldPolicy", () => {
  it("visible=false 不渲染字段；editable=false 字段 disabled", () => {
    const policy: FieldPolicyMap = {
      name: { visible: true, editable: false, required: false }, // 只读
      amount: { visible: true, editable: true, required: true },
      secret: { visible: false, editable: false, required: false }, // 隐藏
    }
    const html = renderToStaticMarkup(
      <HostedForm formKey="__probe__" formData={{}} fieldPolicy={policy} />,
    )
    // 逐个 <input> 元素拆开判定，避免依赖属性输出顺序
    const inputs = html.match(/<input[^>]*>/g) ?? []
    const byName = (n: string) => inputs.find((el) => el.includes(`name="${n}"`))
    // secret 隐藏 → 不渲染
    expect(byName("secret")).toBeUndefined()
    // name 只读 → disabled
    expect(byName("name")).toMatch(/disabled/)
    // amount 可编辑 → required 且非 disabled
    expect(byName("amount")).toMatch(/required/)
    expect(byName("amount")).not.toMatch(/disabled/)
  })

  it("未登记 formKey 给出清晰占位", () => {
    const html = renderToStaticMarkup(<HostedForm formKey="__missing__" formData={{}} />)
    expect(html).toContain("__missing__")
    expect(html).toContain("registerForm")
  })
})
