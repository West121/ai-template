/**
 * 高级公式编辑器（飞书 / 宜搭级体验）。编辑区基于 **CodeMirror 6**（通过 `@uiw/react-codemirror`
 * 承载），全部语言能力由纯逻辑内核 `@/lib/formula-highlight` 驱动、经
 * `@/lib/formula-codemirror` 装配成 CodeMirror 扩展：
 *  1. **语法高亮**：`StreamLanguage` 每行复用 `tokenize` 着色（亮 / 暗两套配色匹配站点 token）。
 *  2. **自动补全**：`autocompletion({ override })` 复用 `currentIdentifier` + `matchCompletions`
 *     （函数 + 字段模糊），函数补全插模板并把光标落到第一个参数。
 *  3. **实时校验**：`linter` 把 `validate` 的错误区间画成波浪红下划线。
 *  4. **参数提示**：CodeMirror 无内置——监听选区变化取 caret，仍用 `findActiveCall` +
 *     `parseSignatureParams` 驱动底部提示条。
 *  5. **实时预览**：传 `evaluate` 显示求值结果 / 类型；否则显示「解析结构」摘要。
 *  6. **可搜索函数文档**：左侧带搜索框的函数列表，点选看签名 / 说明 / 示例并插入。
 *
 * 对外 props / 导出保持不变；两套编辑器（取人 formula-editor / 计算 formula-designer）各传自己的
 * functions / validate / evaluate 复用本组件，产出串格式不变。
 */
import { useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, FunctionSquare, Maximize2, Search } from "lucide-react"
import ReactCodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/modal"
import { Input } from "@/components/ui/input"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { createFormulaExtensions } from "@/lib/formula-codemirror"
import {
  analyzeStructure,
  findActiveCall,
  fuzzyScore,
  parseSignatureParams,
  type EvaluateResult,
  type FieldRef,
  type FnDoc,
  type ValidateResult,
} from "@/lib/formula-highlight"

export type { FnDoc, FieldRef, ValidateResult, EvaluateResult } from "@/lib/formula-highlight"

export interface AdvancedFormulaEditorProps {
  value: string
  onChange: (v: string) => void
  /** 函数目录（取人 / 计算各传自己的，已适配成 FnDoc 形状） */
  functions: readonly FnDoc[]
  /** 可插入 / 补全的字段 */
  fields: readonly FieldRef[]
  /** 校验器（尽量返回错误区间） */
  validate: (expr: string) => ValidateResult
  /** 求值器（仅计算公式传；有则显示实时预览） */
  evaluate?: (expr: string) => EvaluateResult
  /** 样例数据（仅展示用，提示预览基于哪些字段） */
  sampleContext?: Record<string, unknown>
  /** 额外关键字 / 字面量（如取人的 true/false / 操作符）——高亮着色用 */
  keywords?: readonly string[]
  placeholder?: string
  className?: string
  /** 右上角「放大到弹窗」编辑（默认开）；弹窗内的实例传 false 防递归 */
  expandable?: boolean
}

function typeLabel(v: unknown): string {
  if (v === null) return "null"
  if (v === undefined) return "空"
  if (Array.isArray(v)) return "数组"
  return typeof v === "number" ? "数字" : typeof v === "boolean" ? "布尔" : typeof v === "string" ? "文本" : "对象"
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "（空）"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/** 模板插入后光标落点：第一个 `(` 之后，无则末尾（与补全一致）。 */
function templateCaret(tpl: string): number {
  const p = tpl.indexOf("(")
  return p >= 0 ? p + 1 : tpl.length
}

export function AdvancedFormulaEditor({
  value,
  onChange,
  functions,
  fields,
  validate,
  evaluate,
  sampleContext,
  keywords,
  placeholder,
  className,
  expandable = true,
}: AdvancedFormulaEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null)

  const [caret, setCaret] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)
  const [docQuery, setDocQuery] = useState("")
  const [selectedFn, setSelectedFn] = useState<FnDoc | null>(functions[0] ?? null)

  const dark = isDarkMode(useAppStore((s) => s.themeMode))

  const fnNames = useMemo(() => functions.map((f) => f.name), [functions])
  const fnByName = useMemo(() => new Map(functions.map((f) => [f.name, f])), [functions])
  const fieldKeys = useMemo(() => fields.map((f) => f.key), [fields])
  const tokenizeOpts = useMemo(() => ({ fieldKeys, keywords }), [fieldKeys, keywords])

  const extensions = useMemo(
    () => createFormulaExtensions({ functions, fields, validate, keywords, dark }),
    [functions, fields, validate, keywords, dark],
  )

  const trimmed = value.trim()

  const validation = useMemo<ValidateResult>(
    () => (trimmed === "" ? { ok: true } : validate(value)),
    [value, trimmed, validate],
  )

  // 参数提示（监听 CodeMirror 选区变化取 caret）
  const activeCall = useMemo(() => findActiveCall(value, caret, fnNames), [value, caret, fnNames])
  const activeDoc = activeCall ? fnByName.get(activeCall.name) : undefined
  const sigParts = activeDoc ? parseSignatureParams(activeDoc.signature) : null

  // 预览：有 evaluate → 求值；否则解析结构摘要
  const preview = useMemo(() => {
    if (trimmed === "") return null
    if (evaluate) {
      if (!validation.ok) return null
      const r = evaluate(value)
      return { mode: "eval" as const, result: r }
    }
    return { mode: "struct" as const, summary: analyzeStructure(value, tokenizeOpts) }
  }, [value, trimmed, evaluate, validation.ok, tokenizeOpts])

  /** 从函数库 / 字段面板点击插入（插到当前光标处，替换选区；无 view 则退化追加） */
  const insertFromPanel = (text: string, isTemplate: boolean) => {
    const view = cmRef.current?.view
    if (!view) {
      onChange(value + text)
      return
    }
    const sel = view.state.selection.main
    const caretPos = sel.from + (isTemplate ? templateCaret(text) : text.length)
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: caretPos } })
    view.focus()
  }

  // 函数库搜索过滤 + 分类
  const filteredFns = useMemo(() => {
    const q = docQuery.trim()
    const list =
      q === ""
        ? functions
        : functions.filter(
            (f) => fuzzyScore(q, f.name) !== null || f.description.includes(q) || f.signature.includes(q),
          )
    const byCat = new Map<string, FnDoc[]>()
    for (const f of list) {
      const arr = byCat.get(f.category) ?? []
      arr.push(f)
      byCat.set(f.category, arr)
    }
    return [...byCat.entries()]
  }, [docQuery, functions])

  return (
    <>
    <div className={cn("@container flex h-full min-h-0 flex-col gap-2.5", className)}>
      {/* 主区：函数库侧栏 + 编辑器列——弹性铺满可用高度 */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* 左：可搜索函数库（满高，内部列表独立滚动，不裁分类） */}
        <div className="flex h-full w-36 shrink-0 flex-col overflow-hidden rounded-md border @sm:w-48 @lg:w-56 @2xl:w-64">
          <div className="shrink-0 border-b p-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={docQuery}
                onChange={(e) => setDocQuery(e.target.value)}
                placeholder="搜索函数"
                className="h-6 pl-6 text-[11px]"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {filteredFns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">无匹配函数</p>
            ) : (
              filteredFns.map(([cat, fns]) => (
                <div key={cat} className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">{cat}</div>
                  <div className="flex flex-wrap gap-1">
                    {fns.map((fn) => (
                      <button
                        key={fn.name}
                        type="button"
                        title={fn.description}
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary hover:text-primary",
                          selectedFn?.name === fn.name && "border-primary/50 bg-primary/5 text-primary",
                        )}
                        onClick={() => {
                          setSelectedFn(fn)
                          insertFromPanel(fn.insertTemplate, true)
                        }}
                      >
                        {fn.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右：CodeMirror 编辑区（主角，撑满剩余空间）+ 参数提示 + 字段插入 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div
            className={cn(
              "relative min-h-[8rem] flex-1 overflow-hidden rounded-md border bg-background transition-colors",
              focused ? "border-ring ring-[3px] ring-ring/50" : "border-input",
            )}
          >
            {/* 右上角：放大按钮 + 「公式代码区」标识 */}
            <div className="absolute right-1.5 top-1.5 z-20 flex select-none items-center gap-1">
              {expandable && (
                <button
                  type="button"
                  aria-label="放大编辑"
                  title="放大编辑"
                  onClick={() => setExpanded(true)}
                  className="grid size-6 place-items-center rounded-md border border-border/60 bg-background/70 text-muted-foreground opacity-60 backdrop-blur-sm transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100"
                >
                  <Maximize2 className="size-3.5" />
                </button>
              )}
              <span className="pointer-events-none flex items-center gap-1 rounded bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <span className="font-mono italic text-primary">fx</span>
                公式
              </span>
            </div>
            <ReactCodeMirror
              ref={cmRef}
              className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
              value={value}
              height="100%"
              theme="none"
              basicSetup={false}
              extensions={extensions}
              placeholder={placeholder}
              onChange={onChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onUpdate={(u) => {
                if (u.selectionSet || u.docChanged || u.focusChanged) {
                  setCaret(u.state.selection.main.head)
                }
              }}
            />
          </div>

          {/* 参数提示（常驻编辑区下方，不挤占编辑高度） */}
          {sigParts && (
            <div className="shrink-0 rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]">
              <span className="text-muted-foreground">{sigParts.head}(</span>
              {sigParts.params.map((p, i) => (
                <span key={i}>
                  <span
                    className={cn(
                      i === Math.min(activeCall?.argIndex ?? 0, sigParts.params.length - 1)
                        ? "font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {p}
                  </span>
                  {i < sigParts.params.length - 1 && <span className="text-muted-foreground">, </span>}
                </span>
              ))}
              <span className="text-muted-foreground">)</span>
            </div>
          )}

          {/* 字段插入（字段多时自身滚动，不无限撑高） */}
          <div className="max-h-28 shrink-0 overflow-y-auto">
            {fields.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">未绑定表单，无可引用字段</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    title={f.key}
                    className="rounded border px-1.5 py-0.5 text-[11px] transition-colors hover:border-primary hover:text-primary"
                    onClick={() => insertFromPanel(f.key, false)}
                  >
                    {f.label}
                    {f.isUser && <span className="ml-0.5 text-sky-500">·人</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部信息条：校验 / 实时预览 / 选中函数说明——shrink-0 常驻，沉在编辑区下方 */}
      <div className="shrink-0 space-y-2">
        {/* 校验状态 */}
        {trimmed === "" ? (
          <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
            <FunctionSquare className="size-3.5" /> 未配置公式
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px]",
              validation.ok
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                : "border-amber-500/30 bg-amber-500/5 text-amber-600",
            )}
          >
            {validation.ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {validation.ok ? "语法校验通过" : (validation.message ?? "语法有误")}
          </div>
        )}

        {/* 实时预览 / 解析结构 */}
        {preview?.mode === "eval" && (
          <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px]">
            {preview.result.backendOnly ? (
              <span className="text-muted-foreground">含后端函数，前端不预览——提交后由后端求值</span>
            ) : preview.result.ok ? (
              <span>
                预览结果：
                <span className="font-mono text-foreground">{formatValue(preview.result.value)}</span>
                <span className="ml-1 text-muted-foreground">（{typeLabel(preview.result.value)}）</span>
              </span>
            ) : (
              <span className="text-amber-600">预览求值失败：{preview.result.error}</span>
            )}
            {sampleContext && (
              <span className="ml-2 text-muted-foreground">
                样例字段：{Object.keys(sampleContext).slice(0, 6).join("、") || "无"}
              </span>
            )}
          </div>
        )}
        {preview?.mode === "struct" && (
          <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
            解析结构：命中函数{" "}
            <span className="font-mono text-foreground">
              {preview.summary.functions.length ? preview.summary.functions.join("、") : "无"}
            </span>
            ，引用字段{" "}
            <span className="font-mono text-foreground">
              {preview.summary.fields.length ? preview.summary.fields.join("、") : "无"}
            </span>
          </div>
        )}

        {/* 选中函数说明 */}
        {selectedFn && (
          <div className="space-y-0.5 rounded-md border bg-muted/40 px-2 py-1.5 text-[11px]">
            <div className="flex items-center gap-1 font-mono font-medium">
              <FunctionSquare className="size-3.5 text-primary" />
              {selectedFn.signature}
            </div>
            <div className="text-muted-foreground">{selectedFn.description}</div>
            <div className="text-muted-foreground">
              示例：<span className="font-mono">{selectedFn.example}</span>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* 放大：项目高级弹窗（拖拽/全屏/伸缩）里是**完整**公式编辑器——复用同一套 createFormulaExtensions
        （字段补全/校验/参数提示/函数库/预览不降级）+ 同 value/onChange 实时同步；autoFocus=false 放行
        CodeMirror 焦点（否则无法输入）；内层 expandable=false 防递归 */}
    {expandable && (
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title="编辑公式 · fx"
        width={typeof window === "undefined" ? 960 : Math.min(1080, Math.round(window.innerWidth * 0.82))}
        height={typeof window === "undefined" ? 640 : Math.min(760, Math.round(window.innerHeight * 0.82))}
        autoFocus={false}
        bodyClassName="flex flex-col p-3"
        footer={<Button onClick={() => setExpanded(false)}>完成</Button>}
      >
        <div className="min-h-0 flex-1">
          <AdvancedFormulaEditor
            value={value}
            onChange={onChange}
            functions={functions}
            fields={fields}
            validate={validate}
            evaluate={evaluate}
            sampleContext={sampleContext}
            keywords={keywords}
            placeholder={placeholder}
            className="h-full"
            expandable={false}
          />
        </div>
      </Modal>
    )}
    </>
  )
}
