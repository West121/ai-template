/**
 * 脚本上下文补全源 单测（CompletionContext 直测补全函数，不用真 DOM）：
 * a) 顶层标识符 → vars/form/spring/log/execution；b) spring.bean(" → bean 名；
 * c) spring.bean("xxx"). → 该 bean 方法；门面 spring./log. 固定成员；manifest 归一降级不炸。
 */
import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete"
import { makeScriptContextCompletion, type ScriptContextManifest } from "./script-context-completion"

const MANIFEST: ScriptContextManifest = {
  vars: [
    { name: "vars", type: "Map<String,Object>", desc: "流程变量读写" },
    { name: "form", type: "Map<String,Object>", desc: "表单快照" },
    { name: "execution", type: "DelegateExecution", desc: "执行体（可空）" },
    { name: "spring", type: "SpringBeanFacade", desc: "容器门面" },
    { name: "log", type: "ScriptLogHelper", desc: "日志门面" },
  ],
  langs: [{ lang: "java", returnSemantics: "方法体+显式 return" }],
  beans: [
    {
      name: "scriptOrgApi",
      className: "com.xingchen.oa.workflow.engine.script.ScriptOrgApi",
      desc: "组织查询",
      methods: [
        { name: "deptLeaderId", params: [{ name: "deptId", type: "Long" }], returnType: "Long", doc: "部门→负责人" },
        { name: "deptName", params: [{ name: "deptId", type: "Long" }], returnType: "String" },
        { name: "userName", params: [{ name: "userId", type: "Long" }], returnType: "String" },
      ],
    },
    { name: "regionService", className: "com.xingchen.oa.infra.service.RegionService", desc: "IP 归属地", methods: [{ name: "resolve", params: [{ name: "ip", type: "String" }], returnType: "String" }] },
  ],
}

const source = makeScriptContextCompletion(MANIFEST)

function complete(doc: string, explicit = false, pos = doc.length): CompletionResult | null {
  const state = EditorState.create({ doc })
  // 本源是同步实现（CompletionSource 类型含 Promise 分支，直测收窄）
  return source(new CompletionContext(state, pos, explicit)) as CompletionResult | null
}

const labels = (r: CompletionResult | null) => (r ? r.options.map((o) => o.label) : [])

describe("脚本上下文补全源", () => {
  it("a) 顶层标识符：输入 va → vars/form/spring/log/execution 候选", () => {
    const r = complete("va")
    expect(r).not.toBeNull()
    expect(labels(r)).toEqual(expect.arrayContaining(["vars", "form", "execution", "spring", "log"]))
    expect(r!.from).toBe(0)
  })

  it("a) 空文档非 explicit → null（不弹）；explicit → 给候选", () => {
    expect(complete("")).toBeNull()
    expect(labels(complete("", true))).toContain("vars")
  })

  it('b) spring.bean(" 内 → bean 名候选（含前缀过滤起点）', () => {
    const r = complete('spring.bean("scr')
    expect(labels(r)).toEqual(expect.arrayContaining(["scriptOrgApi", "regionService"]))
    expect(r!.from).toBe('spring.bean("'.length)
  })

  it("b) 单引号（groovy/js/python）同样命中", () => {
    expect(labels(complete("spring.bean('"))).toContain("scriptOrgApi")
  })

  it('c) spring.bean("scriptOrgApi"). → 该 bean 方法（label=名(参数)，detail=返回类型）', () => {
    const r = complete('spring.bean("scriptOrgApi").dep')
    expect(r).not.toBeNull()
    const ls = labels(r)
    expect(ls.some((l) => l.startsWith("deptLeaderId("))).toBe(true)
    expect(ls.some((l) => l.startsWith("userName("))).toBe(true)
    const dept = r!.options.find((o) => o.label.startsWith("deptLeaderId("))!
    expect(dept.detail).toBe("Long")
    expect(dept.label).toContain("deptId: Long")
  })

  it("c) 未知 bean 名 . → null（不误报）", () => {
    expect(complete('spring.bean("nope").x')).toBeNull()
  })

  it("c') 门面成员：spring. → bean/has；log. → info/warn/error", () => {
    expect(labels(complete("spring.")).join()).toMatch(/bean\(/)
    expect(labels(complete("spring.h")).join()).toMatch(/has\(/)
    const lg = labels(complete("log."))
    expect(lg.some((l) => l.startsWith("info("))).toBe(true)
    expect(lg.some((l) => l.startsWith("error("))).toBe(true)
  })

  it("普通成员访问（如 form.）→ null，交给语言自带补全", () => {
    expect(complete("form.ge")).toBeNull()
  })

  it("Java 语句里同样工作（分号/类型声明前文不干扰）", () => {
    const r = complete('int d = 1; spring.bean("reg')
    expect(labels(r)).toContain("regionService")
  })
})
