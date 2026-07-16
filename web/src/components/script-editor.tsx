/**
 * 脚本编辑器（Tier 2 脚本 · scriptTask / 监听器 / 高级条件）。
 *
 * 语言：Groovy（LiteFlow Groovy）/ JavaScript（GraalJS）/ Python（Jython Py2）。
 * 产出一个 `ScriptConfig`（lang + code）；序列化落为
 *   `{ type:"serviceTask", service:{ impl:"script" }, script:{ lang, code } }`（对齐后端 FlowNodeDto.script）。
 *
 * 诚实标注（治理 §3.3 第 4 条「不撒谎」）：后端脚本以应用完整权限运行、**非沙箱**、等同受信代码，
 * 仅 `wf:script:write`（受信管理员）可写/测试运行。无该权限者本组件只读、禁用测试运行。
 *
 * 「测试运行」调后端 `POST /api/wf/script/test-run`（同权限、同审计），展示 result/resultType/vars/耗时/error。
 *
 * 绝不在前端 eval/new Function 执行后端脚本——脚本只在后端受控执行；前端只做编辑与联调。
 * 禁 any；类型导入一律 import type。
 */
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, FileCode2, FlaskConical, Loader2, Maximize2, Play, ShieldAlert } from "lucide-react"
import { api, ApiError, NetworkError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Modal } from "@/components/modal"
import { useHasPerm } from "@/stores/auth-store"
import { CodeEditor, type CodeLanguage } from "@/components/code-editor"
import { Input } from "@/components/ui/input"
import {
  fetchScriptContextManifest,
  scriptContextCompletionExt,
  type ScriptContextManifest,
  type ScriptCtxMethod,
} from "@/lib/script-context-completion"
import type { ScriptConfig, ScriptLang } from "@/pages/workflow/designer/flow/model"

/** 脚本语言（ScriptLang）→ 统一编辑器语言（js 走 javascript，groovy/python 同名） */
function toCodeLanguage(lang: ScriptLang): CodeLanguage {
  return lang === "js" ? "javascript" : lang
}

/** test-run 端点响应体（api<T> 已拆 R<> 信封，此处是 data 部分） */
interface ScriptTestRunResult {
  success: boolean
  result?: unknown
  resultType?: string
  vars: Record<string, unknown>
  costMs: number
  error?: string
}

interface LangMeta {
  value: ScriptLang
  label: string
  /** return 语义与运行时限制（诚实标注给用户） */
  returnHint: string
  /** 占位提示：**一行**（多行假代码会被误当成真内容点击编辑，用户以为编辑器坏了） */
  placeholder: string
  /** 示例代码：经「插入示例」按钮真正写入 value（可编辑真文本），不做占位 */
  sample: string
}

const LANGS: LangMeta[] = [
  {
    value: "groovy",
    label: "Groovy",
    returnHint: "支持 return；返回最后一条 return 或末表达式的值。语法最接近 Java。",
    placeholder: "在此输入 Groovy 脚本（支持 return）——可点「插入示例」",
    sample: 'log.info("hello from groovy")\nvars.approved = form.days <= 3\nreturn vars.approved',
  },
  {
    value: "js",
    label: "JavaScript",
    returnHint: "GraalJS：以最后一条表达式/语句的值作为返回，不支持顶层 return。",
    placeholder: "在此输入 JavaScript 脚本（末表达式即返回值）——可点「插入示例」",
    sample: 'log.info("hello from graaljs")\nvars.approved = form.days <= 3\nvars.approved',
  },
  {
    value: "python",
    label: "Python",
    returnHint: "Jython / Python 2：支持 return；无 C 扩展（numpy/pandas 不可用）。",
    placeholder: "在此输入 Python 脚本（支持 return）——可点「插入示例」",
    sample: 'log.info("hello from jython")\nvars["approved"] = form["days"] <= 3\nreturn vars["approved"]',
  },
  {
    value: "java",
    label: "Java",
    returnHint:
      "真 Java（javax.tools 编译）：方法体语义——语句 + 显式 return（无返回写 return null;）。上下文带类型注入，已预置 import java.util.*，其它类型用全限定名。",
    placeholder: "在此输入 Java 方法体（语句 + 显式 return）——可点「插入示例」",
    sample:
      'log.info("hello from java");\nint days = ((Number) form.getOrDefault("days", 0)).intValue();\nvars.put("approved", days <= 3);\nreturn vars.get("approved");',
  },
]

/** 脚本上下文速查（所有语言通用；后端注入）——manifest 拉不到时的硬编码兜底 */
const CONTEXT_HINTS: { name: string; desc: string }[] = [
  { name: "vars", desc: "读写流程变量" },
  { name: "form", desc: "表单数据（只读）" },
  { name: "execution", desc: "执行上下文（可空）" },
  { name: 'spring.bean("名"|类.class)', desc: "取 Spring Bean" },
  { name: 'spring.has("名")', desc: "判断 Bean 是否存在" },
  { name: "log.info / warn / error", desc: "写日志" },
]

/** 方法签名列表（速查区）：仅在条目展开时挂载（78 服务 × N 方法的渲染成本按需付） */
function MethodList({ methods }: { methods: ScriptCtxMethod[] }) {
  return (
    <ul className="space-y-0.5 pl-4">
      {methods.map((m, i) => (
        <li key={`${m.name}-${i}`} className="text-[11px]">
          <code className="font-mono text-foreground">
            {m.name}({m.params.map((pp) => (pp.name ? `${pp.name}: ${pp.type}` : pp.type)).join(", ")}): {m.returnType}
          </code>
          {m.doc && <span className="ml-1.5 text-muted-foreground">{m.doc}</span>}
        </li>
      ))}
    </ul>
  )
}

/** 惰性条目：折叠时不渲染 children（性能）；搜索命中方法名时 forceOpen 直接展开 */
function LazyEntry({
  title,
  sub,
  forceOpen = false,
  children,
}: {
  title: string
  sub?: string
  forceOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen || open
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline gap-1.5 rounded px-0.5 text-left text-[11px] hover:bg-muted/60"
      >
        <ChevronDown className={cn("size-3 shrink-0 self-center text-muted-foreground transition-transform", isOpen && "rotate-180")} />
        <code className="shrink-0 font-mono font-medium text-foreground">{title}</code>
        {sub && <span className="min-w-0 truncate text-muted-foreground">{sub}</span>}
      </button>
      {isOpen && children}
    </div>
  )
}

export interface ScriptEditorProps {
  value: ScriptConfig
  onChange: (next: ScriptConfig) => void
  className?: string
  /** 「放大到弹窗」按钮（语言 Tab 旁），默认开；弹窗内实例传 false 防递归 */
  expandable?: boolean
  /** 弹窗内大号编辑区（代码区更高） */
  large?: boolean
}

export function ScriptEditor({ value, onChange, className, expandable = true, large = false }: ScriptEditorProps) {
  const canWrite = useHasPerm("wf:script:write")
  const readOnly = !canWrite

  const [sampleVarsText, setSampleVarsText] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ScriptTestRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnOpen, setWarnOpen] = useState(false) // 安全警告详情（一行常显 + 可展开）
  const [debugOpen, setDebugOpen] = useState(false) // 测试运行/调试折叠区（默认收起）
  const [expanded, setExpanded] = useState(false) // 整个脚本编辑体验放大到弹窗
  const [sampleConfirm, setSampleConfirm] = useState(false) // 已有内容时插入示例的替换确认

  // 上下文补全 manifest（wf:script:write 才拉——readOnly 不拉；模块级缓存；失败静默 null 降级）
  const [manifest, setManifest] = useState<ScriptContextManifest | null>(null)
  useEffect(() => {
    if (readOnly) return
    let alive = true
    void fetchScriptContextManifest().then((m) => {
      if (alive) setManifest(m)
    })
    return () => {
      alive = false
    }
  }, [readOnly])
  const contextExtensions = useMemo(() => (manifest ? [scriptContextCompletionExt(manifest)] : undefined), [manifest])

  // 三层分层：api=精选推荐（无 tier 的旧 manifest 也归此层）/ service=全量业务 Service
  const apiBeans = useMemo(() => (manifest?.beans ?? []).filter((b) => b.tier !== "service"), [manifest])
  const serviceBeans = useMemo(() => (manifest?.beans ?? []).filter((b) => b.tier === "service"), [manifest])
  const [svcQuery, setSvcQuery] = useState("")
  const filteredService = useMemo(() => {
    const q = svcQuery.trim().toLowerCase()
    if (!q) return serviceBeans.map((bean) => ({ bean, byMethod: false }))
    const out: { bean: (typeof serviceBeans)[number]; byMethod: boolean }[] = []
    for (const bean of serviceBeans) {
      const inName =
        bean.name.toLowerCase().includes(q) ||
        (bean.desc ?? "").toLowerCase().includes(q) ||
        (bean.className ?? "").toLowerCase().includes(q)
      const byMethod = bean.methods.some((m) => m.name.toLowerCase().includes(q))
      if (inName || byMethod) out.push({ bean, byMethod })
    }
    return out
  }, [serviceBeans, svcQuery])

  const langMeta = LANGS.find((l) => l.value === value.lang) ?? LANGS[0]

  const setLang = (lang: string) => onChange({ ...value, lang: lang as ScriptLang })
  const setCode = (code: string) => onChange({ ...value, code })

  /** 插入示例：空 → 直接写入；已有内容 → 确认后替换 */
  const insertSample = () => {
    if (value.code.trim() !== "") {
      setSampleConfirm(true)
      return
    }
    onChange({ ...value, code: langMeta.sample })
  }

  const runTest = async () => {
    setError(null)
    setResult(null)

    // 可选样例变量：允许空；非空必须是合法 JSON 对象
    let sampleVars: Record<string, unknown> | undefined
    const trimmed = sampleVarsText.trim()
    if (trimmed !== "") {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setError("样例变量必须是 JSON 对象，例如 {\"days\": 2}")
          return
        }
        sampleVars = parsed as Record<string, unknown>
      } catch {
        setError("样例变量不是合法 JSON")
        return
      }
    }

    setRunning(true)
    try {
      const body: { lang: ScriptLang; code: string; sampleVars?: Record<string, unknown> } = {
        lang: value.lang,
        code: value.code,
      }
      if (sampleVars) body.sampleVars = sampleVars
      const data = await api<ScriptTestRunResult>("/api/wf/script/test-run", {
        method: "POST",
        body: JSON.stringify(body),
      })
      setResult(data)
    } catch (err) {
      if (err instanceof ApiError && err.code === 403) {
        setError("无权测试运行脚本（需 wf:script:write，仅受信管理员）")
      } else if (err instanceof NetworkError) {
        setError("无法连接后端，测试运行需要后端脚本引擎在线")
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* 诚实标注（治理 §3.3「不撒谎」红线）：非沙箱 + 完整权限一行常显，详情可展开——警告必可见，压成一行不占版面 */}
      <Collapsible open={warnOpen} onOpenChange={setWarnOpen}>
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
            <ShieldAlert className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">
              脚本以应用完整权限运行 · 非沙箱（仅 <code className="font-mono">wf:script:write</code> 受信管理员可写）
            </span>
            <span className="shrink-0 text-[10px] opacity-80">{warnOpen ? "收起" : "详情"}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", warnOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-2 pl-7 pr-2.5 leading-relaxed">
            后端脚本可读写流程变量、调用任意 Spring Bean，等同受信代码；前端绝不 eval/new Function，脚本只在后端受控执行、同权限同审计。请勿粘贴不可信脚本。
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* 语言切换 + 放大（整个脚本编辑体验进弹窗：语言 Tab / 编辑器 / 调试全套） */}
      <div className="flex items-center justify-between gap-2">
        <Tabs value={value.lang} onValueChange={setLang}>
          <TabsList className="h-8">
            {LANGS.map((l) => (
              <TabsTrigger key={l.value} value={l.value} disabled={readOnly} className="text-xs">
                {l.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1.5">
          {/* 插入示例：示例代码写入 value 成真文本（placeholder 只留一行提示，多行假代码会被误当成真内容） */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            disabled={readOnly}
            title={`插入 ${langMeta.label} 示例代码（已有内容时需确认替换）`}
            onClick={insertSample}
          >
            <FileCode2 className="size-3.5" /> 插入示例
          </Button>
          {expandable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              aria-label="放大编辑"
              title="放大到弹窗编辑"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="size-3.5" /> 放大
            </Button>
          )}
        </div>
      </div>

      {/* return 语义提示（随语言变化） */}
      <p className="text-[11px] text-muted-foreground">{langMeta.returnHint}</p>

      {/* 代码编辑区（统一 CodeEditor：行号 + 语法高亮 + 缩进/括号匹配，语言随 lang 切换；
          extraExtensions=上下文补全：vars/form/spring/log 顶层 + spring.bean("…") bean 名/方法，四语言通用） */}
      <CodeEditor
        value={value.code}
        onChange={setCode}
        language={toCodeLanguage(value.lang)}
        readOnly={readOnly}
        placeholder={langMeta.placeholder}
        minHeight={large ? "20rem" : "10rem"}
        maxHeight={large ? "52vh" : "24rem"}
        extraExtensions={contextExtensions}
        ariaLabel="脚本代码"
      />

      {readOnly && (
        <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="size-3.5" /> 只读：编写/测试运行脚本需 <code className="font-mono">wf:script:write</code> 权限（仅受信管理员）
        </div>
      )}

      {/* 测试运行 / 调试（默认收起）：上下文速查 + 样例变量 + 测试运行 + 结果，全部功能保留、不占主版面 */}
      <Collapsible open={debugOpen} onOpenChange={setDebugOpen} className="rounded-md border">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium">
          <FlaskConical className="size-3.5 text-muted-foreground" />
          <span className="flex-1">测试运行 / 调试</span>
          {result && (
            <span className={cn("text-[10px]", result.success ? "text-emerald-600" : "text-rose-600")}>
              {result.success ? "上次成功" : "上次失败"}
            </span>
          )}
          <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", debugOpen && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 border-t px-2.5 py-2">
          {/* 可用上下文速查：manifest 驱动（vars 五项 + beans 折叠列表）；拉不到时回退硬编码 */}
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">可用上下文（后端注入）</div>
            <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
              {(manifest?.vars.length
                ? manifest.vars.map((v) => ({ name: `${v.name}: ${v.type}`, desc: v.desc ?? "" }))
                : CONTEXT_HINTS
              ).map((h) => (
                <li key={h.name} className="flex items-baseline gap-1.5 text-[11px]">
                  <code className="shrink-0 font-mono text-foreground">{h.name}</code>
                  <span className="text-muted-foreground">{h.desc}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Java 预置 import（manifest.imports）：包下类可写简名，其余全限定名 */}
          {manifest && manifest.imports.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Java 预置 import：<code className="font-mono text-foreground">{manifest.imports.join("、")}</code>
              ——这些包下类可直接写简名；commons/hutool 等用全限定名（见工具类列表 className）。
            </p>
          )}

          {/* 三层清单（manifest 驱动）：推荐 API 置顶展开 / 全部服务折叠+搜索 / 工具类折叠。
              折叠态不渲染方法（Radix 关闭即卸载 + LazyEntry 按需），78 服务不全渲染。 */}
          {manifest && apiBeans.length > 0 && (
            <Collapsible defaultOpen className="rounded-md border bg-muted/30">
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium text-muted-foreground [&[data-state=open]>svg:last-child]:rotate-180">
                推荐 API（{apiBeans.length}）— spring.bean("名称") 取用
                <ChevronDown className="ml-auto size-3 shrink-0 transition-transform" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 border-t px-2 py-1.5">
                {apiBeans.map((b) => (
                  <div key={b.name} className="space-y-0.5">
                    <div className="flex items-baseline gap-1.5 text-[11px]">
                      <code className="font-mono font-medium text-foreground">{b.name}</code>
                      {b.desc && <span className="min-w-0 truncate text-muted-foreground">{b.desc}</span>}
                    </div>
                    <MethodList methods={b.methods} />
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {manifest && serviceBeans.length > 0 && (
            <Collapsible className="rounded-md border bg-muted/30">
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium text-muted-foreground [&[data-state=open]>svg:last-child]:rotate-180">
                全部服务（{serviceBeans.length}）— 业务 Service 全量，spring.bean("名称") 取用
                <ChevronDown className="ml-auto size-3 shrink-0 transition-transform" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 border-t px-2 py-1.5">
                <Input
                  value={svcQuery}
                  onChange={(e) => setSvcQuery(e.target.value)}
                  placeholder="搜索服务名 / 方法名"
                  className="h-6 text-[11px]"
                />
                {filteredService.length === 0 ? (
                  <p className="py-1 text-[11px] text-muted-foreground">无匹配服务</p>
                ) : (
                  filteredService.map(({ bean, byMethod }) => (
                    <LazyEntry
                      key={bean.name}
                      title={bean.name}
                      sub={bean.desc}
                      forceOpen={svcQuery.trim() !== "" && byMethod}
                    >
                      <MethodList methods={bean.methods} />
                      {bean.truncated && <p className="pl-4 text-[10px] text-muted-foreground">（方法列表已截断）</p>}
                    </LazyEntry>
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {manifest && manifest.statics.length > 0 && (
            <Collapsible className="rounded-md border bg-muted/30">
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium text-muted-foreground [&[data-state=open]>svg:last-child]:rotate-180">
                工具类（{manifest.statics.length}）— Java 简名直呼（预置 import 内）/ 其余全限定名
                <ChevronDown className="ml-auto size-3 shrink-0 transition-transform" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 border-t px-2 py-1.5">
                {manifest.statics.map((s, i) => (
                  <LazyEntry key={`${s.className}-${i}`} title={s.simpleName} sub={s.className}>
                    <MethodList methods={s.methods} />
                  </LazyEntry>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {!readOnly && (
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground">样例流程变量（可选，JSON 对象；测试运行时注入 vars）</div>
                <Textarea
                  value={sampleVarsText}
                  onChange={(e) => setSampleVarsText(e.target.value)}
                  placeholder={'{ "days": 2, "amount": 500 }'}
                  spellCheck={false}
                  rows={2}
                  className="font-mono text-[11px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={running || value.code.trim() === ""}
                  onClick={runTest}
                >
                  {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  测试运行
                </Button>
                <span className="text-[11px] text-muted-foreground">调用后端脚本引擎（同权限、同审计）</span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-600">
              {error}
            </div>
          )}

          {result && (
            <div
              className={cn(
                "space-y-1.5 rounded-md border px-2.5 py-2 text-[11px]",
                result.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={result.success ? "font-medium text-emerald-600" : "font-medium text-rose-600"}>
                  {result.success ? "运行成功" : "运行失败"}
                </span>
                <span className="text-muted-foreground">耗时 {result.costMs}ms</span>
              </div>
              {result.error && <div className="whitespace-pre-wrap font-mono text-rose-600">{result.error}</div>}
              {result.success && (
                <div>
                  返回值
                  {result.resultType && <span className="text-muted-foreground">（{result.resultType}）</span>}：
                  <span className="font-mono text-foreground"> {formatValue(result.result)}</span>
                </div>
              )}
              <div>
                <div className="text-muted-foreground">运行后流程变量 vars：</div>
                <pre className="mt-0.5 max-h-40 overflow-auto rounded border bg-background px-2 py-1.5 font-mono">
                  {JSON.stringify(result.vars, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* 放大：项目高级弹窗（拖拽/全屏/伸缩）里是**完整 ScriptEditor**（安全警告/语言 Tab/编辑器/调试全套，
          同一受控 value/onChange 实时同步）；autoFocus=false 放行 CodeMirror 焦点；内层 expandable=false 防递归 */}
      {expandable && (
        <Modal
          open={expanded}
          onOpenChange={setExpanded}
          title="编辑脚本"
          width={typeof window === "undefined" ? 960 : Math.min(1080, Math.round(window.innerWidth * 0.82))}
          autoFocus={false}
          footer={<Button onClick={() => setExpanded(false)}>完成</Button>}
        >
          <ScriptEditor value={value} onChange={onChange} expandable={false} large />
        </Modal>
      )}

      {/* 插入示例 · 已有内容时的替换确认 */}
      <AlertDialog open={sampleConfirm} onOpenChange={setSampleConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>用 {langMeta.label} 示例替换当前脚本？</AlertDialogTitle>
            <AlertDialogDescription>当前编辑器已有内容，插入示例会覆盖它（可 Ctrl+Z 撤销）。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onChange({ ...value, code: langMeta.sample })
                setSampleConfirm(false)
              }}
            >
              替换为示例
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function formatValue(v: unknown): string {
  if (v === undefined) return "（无返回值）"
  if (v === null) return "null"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}
