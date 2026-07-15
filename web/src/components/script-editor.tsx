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
import { useState } from "react"
import { AlertTriangle, Loader2, Play, ShieldAlert } from "lucide-react"
import { api, ApiError, NetworkError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHasPerm } from "@/stores/auth-store"
import { CodeEditor, type CodeLanguage } from "@/components/code-editor"
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
  placeholder: string
}

const LANGS: LangMeta[] = [
  {
    value: "groovy",
    label: "Groovy",
    returnHint: "支持 return；返回最后一条 return 或末表达式的值。语法最接近 Java。",
    placeholder: 'log.info("hello from groovy")\nvars.approved = form.days <= 3\nreturn vars.approved',
  },
  {
    value: "js",
    label: "JavaScript",
    returnHint: "GraalJS：以最后一条表达式/语句的值作为返回，不支持顶层 return。",
    placeholder: 'log.info("hello from graaljs")\nvars.approved = form.days <= 3\nvars.approved',
  },
  {
    value: "python",
    label: "Python",
    returnHint: "Jython / Python 2：支持 return；无 C 扩展（numpy/pandas 不可用）。",
    placeholder: 'log.info("hello from jython")\nvars["approved"] = form["days"] <= 3\nreturn vars["approved"]',
  },
]

/** 脚本上下文速查（所有语言通用；后端注入） */
const CONTEXT_HINTS: { name: string; desc: string }[] = [
  { name: "vars", desc: "读写流程变量" },
  { name: "form", desc: "表单数据（只读）" },
  { name: "execution", desc: "执行上下文（可空）" },
  { name: 'spring.bean("名"|类.class)', desc: "取 Spring Bean" },
  { name: 'spring.has("名")', desc: "判断 Bean 是否存在" },
  { name: "log.info / warn / error", desc: "写日志" },
]

export interface ScriptEditorProps {
  value: ScriptConfig
  onChange: (next: ScriptConfig) => void
  className?: string
}

export function ScriptEditor({ value, onChange, className }: ScriptEditorProps) {
  const canWrite = useHasPerm("wf:script:write")
  const readOnly = !canWrite

  const [sampleVarsText, setSampleVarsText] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ScriptTestRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const langMeta = LANGS.find((l) => l.value === value.lang) ?? LANGS[0]

  const setLang = (lang: string) => onChange({ ...value, lang: lang as ScriptLang })
  const setCode = (code: string) => onChange({ ...value, code })

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
      {/* 诚实标注：非沙箱、完整权限、仅受信管理员可写（治理 §3.3） */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        <div className="space-y-0.5">
          <div className="font-medium">脚本以应用完整权限运行 · 非沙箱</div>
          <div>
            后端脚本可读写流程变量、调用任意 Spring Bean，等同受信代码；仅平台管理员（
            <code className="font-mono">wf:script:write</code>）可编写与测试运行。请勿粘贴不可信脚本。
          </div>
        </div>
      </div>

      {/* 语言切换 */}
      <Tabs value={value.lang} onValueChange={setLang}>
        <TabsList className="h-8">
          {LANGS.map((l) => (
            <TabsTrigger key={l.value} value={l.value} disabled={readOnly} className="text-xs">
              {l.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* return 语义提示（随语言变化） */}
      <p className="text-[11px] text-muted-foreground">{langMeta.returnHint}</p>

      {/* 代码编辑区（统一 CodeEditor：行号 + 语法高亮 + 缩进/括号匹配，语言随 lang 切换） */}
      <CodeEditor
        value={value.code}
        onChange={setCode}
        language={toCodeLanguage(value.lang)}
        readOnly={readOnly}
        placeholder={langMeta.placeholder}
        minHeight="10rem"
        maxHeight="24rem"
        ariaLabel="脚本代码"
      />

      {/* 上下文变量/函数速查 */}
      <div className="space-y-1 rounded-md border bg-muted/40 px-2.5 py-2">
        <div className="text-[11px] font-medium text-muted-foreground">可用上下文（后端注入）</div>
        <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
          {CONTEXT_HINTS.map((h) => (
            <li key={h.name} className="flex items-baseline gap-1.5 text-[11px]">
              <code className="shrink-0 font-mono text-foreground">{h.name}</code>
              <span className="text-muted-foreground">{h.desc}</span>
            </li>
          ))}
        </ul>
      </div>

      {readOnly && (
        <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="size-3.5" /> 只读：编写/测试运行脚本需 <code className="font-mono">wf:script:write</code> 权限（仅受信管理员）
        </div>
      )}

      {/* 测试运行 */}
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

      {/* 错误 */}
      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-600">
          {error}
        </div>
      )}

      {/* 结果 */}
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
    </div>
  )
}

function formatValue(v: unknown): string {
  if (v === undefined) return "（无返回值）"
  if (v === null) return "null"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}
