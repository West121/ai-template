/**
 * 脚本编辑器 · 上下文代码提示（后端 `GET /api/wf/script/context-manifest` 驱动，四语言通用）。
 *
 * 三类候选（启发式，正则识别光标前文，不做精确类型推断）：
 *  a) 顶层标识符：vars / form / execution / spring / log（detail=类型，info=说明）；
 *  b) `spring.bean("` 字符串内：bean 名（info=className + desc）；
 *  c) 方法补全：`spring.bean("xxx").` 后 → 该 bean 的 methods（label=name(params)，detail=returnType，info=doc）；
 *     以及门面方法：`spring.` → bean()/has()、`log.` → info()/warn()/error()（契约稳定，manifest 不单列）。
 *
 * 挂法：`EditorState.languageData.of(() => [{autocomplete}])` —— 语言无关叠加，不覆盖 lang 包自带补全。
 * manifest 拉取带模块级缓存；404/网络失败静默降级（无上下文补全，编辑器照常）。
 */
import { EditorState, type Extension } from "@codemirror/state"
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete"
import { api } from "@/lib/api"

/* ============================ manifest 契约 ============================ */

export interface ScriptCtxVar {
  name: string
  type: string
  desc?: string
}
export interface ScriptCtxLang {
  lang: string
  returnSemantics?: string
}
export interface ScriptCtxMethod {
  name: string
  params: { name?: string; type: string }[]
  returnType: string
  doc?: string
}
export interface ScriptCtxBean {
  name: string
  className?: string
  desc?: string
  methods: ScriptCtxMethod[]
}
export interface ScriptContextManifest {
  vars: ScriptCtxVar[]
  langs: ScriptCtxLang[]
  beans: ScriptCtxBean[]
}

/** 归一：字段缺省/非数组一律兜底（防白屏） */
function normalizeManifest(raw: unknown): ScriptContextManifest {
  const o = (raw ?? {}) as Partial<ScriptContextManifest>
  return {
    vars: Array.isArray(o.vars) ? o.vars : [],
    langs: Array.isArray(o.langs) ? o.langs : [],
    beans: Array.isArray(o.beans)
      ? o.beans.map((b) => ({ ...b, methods: Array.isArray(b?.methods) ? b.methods : [] }))
      : [],
  }
}

/* ============================ 拉取（模块级缓存，静默降级） ============================ */

let manifestCache: Promise<ScriptContextManifest | null> | null = null

/** 拉取 manifest（缓存共享；404/无权/网络失败 → null，静默降级无补全） */
export function fetchScriptContextManifest(): Promise<ScriptContextManifest | null> {
  if (!manifestCache) {
    manifestCache = api<ScriptContextManifest>("/api/wf/script/context-manifest")
      .then((d) => normalizeManifest(d))
      .catch(() => null)
  }
  return manifestCache
}

/** 测试用：清空缓存 */
export function resetScriptContextManifestCache(): void {
  manifestCache = null
}

/* ============================ 补全源 ============================ */

/** 方法 → 补全项：label=name(params)，apply=name()（光标落在括号内） */
function methodCompletion(m: ScriptCtxMethod): Completion {
  const params = m.params.map((p) => (p.name ? `${p.name}: ${p.type}` : p.type)).join(", ")
  return {
    label: `${m.name}(${params})`,
    type: "method",
    detail: m.returnType,
    info: m.doc || undefined,
    apply: (view, _c, from, to) => {
      const insert = `${m.name}()`
      // 有参：光标落括号内；无参：落括号后
      const anchor = from + m.name.length + (m.params.length > 0 ? 1 : 2)
      view.dispatch({ changes: { from, to, insert }, selection: { anchor } })
    },
  }
}

/** 门面方法（契约稳定，manifest 不单列）：spring./log. 的固定成员 */
const SPRING_FACADE: Completion[] = [
  { label: 'bean("名称")', type: "method", detail: "Object", info: "按 Spring bean 名称取受信 Bean", apply: (v, _c, from, to) => v.dispatch({ changes: { from, to, insert: 'bean("")' }, selection: { anchor: from + 6 } }) },
  { label: 'has("名称")', type: "method", detail: "boolean", info: "判断 Bean 是否存在", apply: (v, _c, from, to) => v.dispatch({ changes: { from, to, insert: 'has("")' }, selection: { anchor: from + 5 } }) },
]
const LOG_FACADE: Completion[] = ["info", "warn", "error"].map((n) => ({
  label: `${n}(msg)`,
  type: "method",
  detail: "void",
  info: `写应用日志（[wf-script] 前缀）`,
  apply: (v, _c, from, to) => v.dispatch({ changes: { from, to, insert: `${n}("")` }, selection: { anchor: from + n.length + 2 } }),
}))

/** 构建补全源（纯函数，可直测：new CompletionContext(state, pos, explicit) 调用） */
export function makeScriptContextCompletion(manifest: ScriptContextManifest): CompletionSource {
  const topLevel: Completion[] = manifest.vars.map((v) => ({
    label: v.name,
    type: "variable",
    detail: v.type,
    info: v.desc || undefined,
  }))

  return (context: CompletionContext): CompletionResult | null => {
    // b) spring.bean(" 字符串内 → bean 名
    const inBeanStr = context.matchBefore(/spring\s*\.\s*bean\s*\(\s*["'][\w$]*/)
    if (inBeanStr) {
      const q = /["']([\w$]*)$/.exec(inBeanStr.text)
      const partial = q?.[1] ?? ""
      return {
        from: context.pos - partial.length,
        options: manifest.beans.map((b) => ({
          label: b.name,
          type: "class",
          detail: b.className?.split(".").pop(),
          info: [b.className, b.desc].filter(Boolean).join(" · ") || undefined,
        })),
        validFor: /^[\w$]*$/,
      }
    }

    // c) spring.bean("xxx"). 后 → 该 bean 的方法
    const afterBean = context.matchBefore(/spring\s*\.\s*bean\s*\(\s*["']([\w$]+)["']\s*\)\s*\.\s*[\w$]*/)
    if (afterBean) {
      const m = /spring\s*\.\s*bean\s*\(\s*["']([\w$]+)["']\s*\)\s*\.\s*([\w$]*)$/.exec(afterBean.text)
      if (m) {
        const bean = manifest.beans.find((b) => b.name === m[1])
        if (bean && bean.methods.length > 0) {
          return { from: context.pos - m[2].length, options: bean.methods.map(methodCompletion), validFor: /^[\w$]*$/ }
        }
      }
    }

    // c') 门面成员：spring. / log.
    const afterSpring = context.matchBefore(/spring\s*\.\s*[\w$]*/)
    if (afterSpring && !/bean\s*\($/.test(afterSpring.text)) {
      const partial = /\.\s*([\w$]*)$/.exec(afterSpring.text)?.[1] ?? ""
      return { from: context.pos - partial.length, options: SPRING_FACADE, validFor: /^[\w$]*$/ }
    }
    const afterLog = context.matchBefore(/\blog\s*\.\s*[\w$]*/)
    if (afterLog) {
      const partial = /\.\s*([\w$]*)$/.exec(afterLog.text)?.[1] ?? ""
      return { from: context.pos - partial.length, options: LOG_FACADE, validFor: /^[\w$]*$/ }
    }

    // 任意 `.` 成员访问（非上述已知门面）→ 不掺和，交给语言自带补全
    if (context.matchBefore(/\.\s*[\w$]*/)) return null

    // a) 顶层标识符：vars/form/execution/spring/log
    const word = context.matchBefore(/[\w$]+/)
    if (!word && !context.explicit) return null
    return { from: word ? word.from : context.pos, options: topLevel, validFor: /^[\w$]*$/ }
  }
}

/** 补全源 → 语言无关扩展（叠加，不覆盖 lang 包自带补全） */
export function scriptContextCompletionExt(manifest: ScriptContextManifest): Extension {
  const source = makeScriptContextCompletion(manifest)
  return EditorState.languageData.of(() => [{ autocomplete: source }])
}
