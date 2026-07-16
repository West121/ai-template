/**
 * 脚本编辑器 · 上下文代码提示（后端 `GET /api/wf/script/context-manifest` 驱动，四语言通用）。
 *
 * 候选（启发式，正则识别光标前文，不做精确类型推断）：
 *  a) 顶层标识符：vars / form / execution / spring / log（detail=类型，info=说明）+ **statics 工具类简名**
 *     （detail=工具类，info=className；两个 StringUtils 重名都出、info 区分）；
 *  b) `spring.bean("` 字符串内：**全量 bean 名**（api 层置前 + boost，detail 标「推荐」；service 层也全出）；
 *  c) 方法补全：`spring.bean("xxx").` 后 → 该 bean 的 methods（label=name(params)，detail=returnType，info=doc）；
 *     `工具类简名.` 后 → 该类 public static 方法（重名简名优先取**预置 import 覆盖**的那个，如 spring StringUtils）；
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
  /** 分层：api=精选门面（带 doc，补全置前）/ service=全量业务 Service（desc=类简名） */
  tier?: "api" | "service"
  /** 方法列表被截断（>80 方法） */
  truncated?: boolean
  methods: ScriptCtxMethod[]
}
/** 静态工具类（Java 直呼简名/全限定名调用；注意有两个 StringUtils，以 className 区分） */
export interface ScriptCtxStatic {
  simpleName: string
  className: string
  methods: ScriptCtxMethod[]
}
export interface ScriptContextManifest {
  vars: ScriptCtxVar[]
  langs: ScriptCtxLang[]
  beans: ScriptCtxBean[]
  /** 静态工具类（13 个） */
  statics: ScriptCtxStatic[]
  /** Java 预置 import（包下类可写简名；其余用全限定名） */
  imports: string[]
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
    statics: Array.isArray(o.statics)
      ? o.statics.map((s) => ({ ...s, methods: Array.isArray(s?.methods) ? s.methods : [] }))
      : [],
    imports: Array.isArray(o.imports) ? o.imports : [],
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
/** 简名 → 静态类候选集；重名（两个 StringUtils）优先取**预置 import 覆盖**的那个，无覆盖则全给 */
function staticsBySimpleName(manifest: ScriptContextManifest, simpleName: string): ScriptCtxStatic[] {
  const hits = manifest.statics.filter((s) => s.simpleName === simpleName)
  if (hits.length <= 1) return hits
  const covered = hits.filter((s) => {
    const pkg = s.className.slice(0, s.className.lastIndexOf("."))
    return manifest.imports.includes(`${pkg}.*`) || manifest.imports.includes(s.className)
  })
  return covered.length > 0 ? covered : hits
}

export function makeScriptContextCompletion(manifest: ScriptContextManifest): CompletionSource {
  const topLevel: Completion[] = [
    ...manifest.vars.map(
      (v): Completion => ({
        label: v.name,
        type: "variable",
        detail: v.type,
        info: v.desc || undefined,
        boost: 1, // 上下文变量优先于工具类
      }),
    ),
    // 静态工具类简名（重名的两个 StringUtils 都出，info 以 className 区分）
    ...manifest.statics.map(
      (s): Completion => ({
        label: s.simpleName,
        type: "class",
        detail: "工具类",
        info: s.className,
      }),
    ),
  ]

  // bean 名候选：api 层置前 + boost + detail 标「推荐」；service 层也全出（detail=类简名）
  const beanOptions: Completion[] = [...manifest.beans]
    .sort((a, b) => (a.tier === "api" ? 0 : 1) - (b.tier === "api" ? 0 : 1))
    .map((b) => ({
      label: b.name,
      type: "class",
      detail: b.tier === "api" ? `推荐 · ${b.className?.split(".").pop() ?? ""}` : b.className?.split(".").pop(),
      info: [b.className, b.desc, b.truncated ? "（方法列表已截断）" : ""].filter(Boolean).join(" · ") || undefined,
      boost: b.tier === "api" ? 2 : 0,
    }))

  return (context: CompletionContext): CompletionResult | null => {
    // b) spring.bean(" 字符串内 → 全量 bean 名（api 置前）
    const inBeanStr = context.matchBefore(/spring\s*\.\s*bean\s*\(\s*["'][\w$]*/)
    if (inBeanStr) {
      const q = /["']([\w$]*)$/.exec(inBeanStr.text)
      const partial = q?.[1] ?? ""
      return { from: context.pos - partial.length, options: beanOptions, validFor: /^[\w$]*$/ }
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

    // c'') 工具类静态成员：`StringUtils.` 等（大写开头简名 + .）——重名优先预置 import 覆盖的版本
    const afterStatic = context.matchBefore(/\b[A-Z][\w$]*\s*\.\s*[\w$]*/)
    if (afterStatic) {
      const m = /\b([A-Z][\w$]*)\s*\.\s*([\w$]*)$/.exec(afterStatic.text)
      if (m) {
        const classes = staticsBySimpleName(manifest, m[1])
        if (classes.length > 0) {
          const single = classes.length === 1
          const options = classes.flatMap((c) =>
            c.methods.map((mm) => {
              const opt = methodCompletion(mm)
              // 多类同名并存时 info 标明来源类；单类时保留原 doc
              return single ? opt : { ...opt, info: [c.className, mm.doc].filter(Boolean).join(" · ") }
            }),
          )
          return { from: context.pos - m[2].length, options, validFor: /^[\w$]*$/ }
        }
      }
    }

    // 任意 `.` 成员访问（非上述已知来源）→ 不掺和，交给语言自带补全
    if (context.matchBefore(/\.\s*[\w$]*/)) return null

    // a) 顶层标识符：vars/form/execution/spring/log + 工具类简名
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
