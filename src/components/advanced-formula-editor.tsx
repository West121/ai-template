/**
 * 高级公式编辑器（飞书 / 宜搭级体验，零重依赖 —— 不引 monaco / codemirror / prism）。
 *
 * 用 React + Tailwind 自造：
 *  1. **语法高亮**：彩色 `<pre>` 高亮层垫底 + 透明 `<textarea>` 盖顶（编辑 / 光标真发生处），滚动同步；
 *     另有一层透明文字的错误层，把校验区间画波浪红下划线。
 *  2. **自动补全**：输入标识符时在光标处弹下拉（模糊匹配函数 + 字段，↑↓ / Enter / Esc）。
 *  3. **参数提示**：光标落在某函数括号内时，底部显示该函数签名并高亮当前参数位。
 *  4. **实时校验**：`validate` 报错则精确标红并显示消息（空表达式中性提示，不报错）。
 *  5. **实时预览**：传 `evaluate` 显示求值结果 / 类型；否则显示「解析结构」摘要。
 *  6. **可搜索函数文档**：左侧带搜索框的函数列表，点选看签名 / 说明 / 示例并插入。
 *
 * 纯逻辑内核在 `@/lib/formula-highlight`（可单测）；本文件只负责 DOM / 交互装配。
 * 两套编辑器（取人 formula-editor / 计算 formula-designer）各传自己的
 * functions / validate / evaluate 复用本组件，产出串格式不变。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react"
import { AlertCircle, CheckCircle2, FunctionSquare, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  analyzeStructure,
  currentIdentifier,
  findActiveCall,
  fuzzyScore,
  matchCompletions,
  parseSignatureParams,
  tokenize,
  type Completion,
  type EvaluateResult,
  type FieldRef,
  type FnDoc,
  type Token,
  type TokenKind,
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
}

/** 两层（高亮 pre / textarea）必须字字对齐——共享同一套排版类。 */
const EDITOR_TYPO = "font-mono text-xs leading-5 tracking-normal"
const EDITOR_BOX = "px-3 py-2 whitespace-pre-wrap break-words"

const TOKEN_CLASS: Record<TokenKind, string> = {
  fn: "text-violet-600 dark:text-violet-400 font-medium",
  field: "text-sky-600 dark:text-sky-400",
  keyword: "text-amber-600 dark:text-amber-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-orange-600 dark:text-orange-400",
  operator: "text-pink-600 dark:text-pink-400",
  paren: "text-muted-foreground",
  comma: "text-muted-foreground",
  ident: "text-foreground",
  space: "",
}

interface CaretCoords {
  top: number
  left: number
}

/** 镜像 div 法测量 textarea 中某字符位置的像素坐标（补全下拉定位用）。 */
function getCaretCoords(el: HTMLTextAreaElement, pos: number): CaretCoords {
  const doc = el.ownerDocument
  const mirror = doc.createElement("div")
  const cs = window.getComputedStyle(el)
  const copy = [
    "boxSizing",
    "width",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "tabSize",
  ] as const
  for (const p of copy) mirror.style[p] = cs[p]
  mirror.style.position = "absolute"
  mirror.style.visibility = "hidden"
  mirror.style.whiteSpace = "pre-wrap"
  mirror.style.overflowWrap = "break-word"
  mirror.style.overflow = "hidden"
  mirror.style.top = "0"
  mirror.style.left = "0"

  mirror.textContent = el.value.slice(0, pos)
  const marker = doc.createElement("span")
  marker.textContent = el.value.slice(pos) || "."
  mirror.appendChild(marker)
  doc.body.appendChild(mirror)
  const top = marker.offsetTop - el.scrollTop
  const left = marker.offsetLeft - el.scrollLeft
  doc.body.removeChild(mirror)
  return { top, left }
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
}: AdvancedFormulaEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const errRef = useRef<HTMLPreElement>(null)
  /** 待应用的选区（受控 value 更新后于 layout effect 落位） */
  const pendingSel = useRef<[number, number] | null>(null)

  const [caret, setCaret] = useState(0)
  const [docQuery, setDocQuery] = useState("")
  const [selectedFn, setSelectedFn] = useState<FnDoc | null>(functions[0] ?? null)

  // 自动补全状态
  const [acOpen, setAcOpen] = useState(false)
  const [acItems, setAcItems] = useState<Completion[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acAnchor, setAcAnchor] = useState<CaretCoords>({ top: 0, left: 0 })
  const acRange = useRef<[number, number]>([0, 0])

  const fnNames = useMemo(() => functions.map((f) => f.name), [functions])
  const fnByName = useMemo(() => new Map(functions.map((f) => [f.name, f])), [functions])
  const fieldKeys = useMemo(() => fields.map((f) => f.key), [fields])
  const tokenizeOpts = useMemo(() => ({ fieldKeys, keywords }), [fieldKeys, keywords])

  const tokens: Token[] = useMemo(() => tokenize(value, tokenizeOpts), [value, tokenizeOpts])
  const trimmed = value.trim()

  const validation = useMemo<ValidateResult>(
    () => (trimmed === "" ? { ok: true } : validate(value)),
    [value, trimmed, validate],
  )
  const hasError = trimmed !== "" && !validation.ok
  const errStart = validation.errorStart
  const errEnd = validation.errorEnd

  // 参数提示
  const activeCall = useMemo(() => findActiveCall(value, caret, fnNames), [value, caret, fnNames])
  const activeDoc = activeCall ? fnByName.get(activeCall.name) : undefined

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

  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (errRef.current) {
      errRef.current.scrollTop = ta.scrollTop
      errRef.current.scrollLeft = ta.scrollLeft
    }
  }, [])

  // 受控 value 变化后落位待应用选区（仅插入 / 补全会预置 pendingSel）+ 同步滚动
  useLayoutEffect(() => {
    const ta = taRef.current
    if (ta && pendingSel.current) {
      const [s, e] = pendingSel.current
      pendingSel.current = null
      ta.focus()
      ta.setSelectionRange(s, e)
      setCaret(e)
      syncScroll()
    }
  }, [value, syncScroll])

  /** 刷新补全下拉（依据光标处标识符） */
  const refreshCompletion = (nextValue: string, pos: number) => {
    const ta = taRef.current
    const ident = currentIdentifier(nextValue, pos)
    if (!ta || !ident) {
      setAcOpen(false)
      return
    }
    const items = matchCompletions(ident.text, functions, fields)
    if (items.length === 0) {
      setAcOpen(false)
      return
    }
    acRange.current = [ident.start, ident.end]
    setAcItems(items)
    setAcIndex(0)
    setAcAnchor(getCaretCoords(ta, ident.start))
    setAcOpen(true)
  }

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    const pos = e.target.selectionStart
    onChange(next)
    setCaret(pos)
    refreshCompletion(next, pos)
    syncScroll()
  }

  const syncCaret = () => {
    const ta = taRef.current
    if (!ta) return
    setCaret(ta.selectionStart)
  }

  /** 插入文本，替换 [start,end)；caretOffset 为插入后光标相对插入串起点的偏移 */
  const insertAt = (start: number, end: number, text: string, caretOffset: number) => {
    const next = value.slice(0, start) + text + value.slice(end)
    const cursor = start + caretOffset
    pendingSel.current = [cursor, cursor]
    onChange(next)
    setAcOpen(false)
  }

  /** 计算模板插入后光标位置：落到第一个 `(` 之后（无则末尾） */
  const templateCaret = (tpl: string): number => {
    const p = tpl.indexOf("(")
    return p >= 0 ? p + 1 : tpl.length
  }

  const acceptCompletion = (c: Completion) => {
    const [s, e] = acRange.current
    if (c.kind === "fn" && c.fn) {
      insertAt(s, e, c.fn.insertTemplate, templateCaret(c.fn.insertTemplate))
    } else {
      insertAt(s, e, c.insert, c.insert.length)
    }
  }

  /** 从函数库 / 字段面板点击插入（插到当前光标处，替换选区） */
  const insertFromPanel = (text: string, isTemplate: boolean) => {
    const ta = taRef.current
    const s = ta ? ta.selectionStart : value.length
    const eSel = ta ? ta.selectionEnd : value.length
    insertAt(s, eSel, text, isTemplate ? templateCaret(text) : text.length)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!acOpen) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setAcIndex((i) => (i + 1) % acItems.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setAcIndex((i) => (i - 1 + acItems.length) % acItems.length)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      acceptCompletion(acItems[acIndex])
    } else if (e.key === "Escape") {
      e.preventDefault()
      setAcOpen(false)
    }
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

  // 错误层三段切片
  const errorSlices = useMemo(() => {
    if (!hasError || errStart === undefined || errEnd === undefined || errEnd <= errStart) return null
    return {
      before: value.slice(0, errStart),
      mid: value.slice(errStart, errEnd),
      after: value.slice(errEnd),
    }
  }, [hasError, errStart, errEnd, value])

  const sigParts = activeDoc ? parseSignatureParams(activeDoc.signature) : null

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="grid grid-cols-[150px_1fr] gap-2">
        {/* 左：可搜索函数库 */}
        <div className="flex max-h-64 flex-col rounded-md border">
          <div className="border-b p-1.5">
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
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
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

        {/* 右：高亮编辑器 + 字段插入 */}
        <div className="space-y-2">
          <div className="relative h-32 overflow-hidden rounded-md border bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            {/* 高亮层 */}
            <pre
              ref={preRef}
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 m-0 h-full w-full overflow-auto",
                EDITOR_TYPO,
                EDITOR_BOX,
              )}
            >
              {tokens.map((t, i) => (
                <span key={i} className={TOKEN_CLASS[t.kind]}>
                  {t.value}
                </span>
              ))}
              {"\n"}
            </pre>
            {/* 错误下划线层（透明文字，仅显下划线） */}
            {errorSlices && (
              <pre
                ref={errRef}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 m-0 h-full w-full overflow-auto text-transparent",
                  EDITOR_TYPO,
                  EDITOR_BOX,
                )}
              >
                {errorSlices.before}
                <span className="underline decoration-red-500 decoration-wavy underline-offset-2">
                  {errorSlices.mid}
                </span>
                {errorSlices.after}
                {"\n"}
              </pre>
            )}
            {/* 真编辑层（透明文字 + 实体 caret） */}
            <textarea
              ref={taRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onSelect={syncCaret}
              onScroll={syncScroll}
              onBlur={() => window.setTimeout(() => setAcOpen(false), 120)}
              spellCheck={false}
              placeholder={placeholder}
              className={cn(
                "absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground",
                EDITOR_TYPO,
                EDITOR_BOX,
              )}
            />

            {/* 自动补全下拉 */}
            {acOpen && (
              <div
                className="absolute z-20 max-h-48 w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                style={{ top: acAnchor.top + 20, left: Math.min(acAnchor.left, 240) }}
              >
                {acItems.map((it, i) => (
                  <button
                    key={`${it.kind}-${it.label}-${i}`}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px]",
                      i === acIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      acceptCompletion(it)
                    }}
                    onMouseEnter={() => setAcIndex(i)}
                  >
                    <span className="flex items-center gap-1 font-mono">
                      <span
                        className={cn(
                          "inline-block w-3 text-center",
                          it.kind === "fn" ? "text-violet-500" : "text-sky-500",
                        )}
                      >
                        {it.kind === "fn" ? "ƒ" : "＃"}
                      </span>
                      {it.label}
                    </span>
                    <span className="truncate text-muted-foreground">{it.detail}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 参数提示 */}
          {sigParts && (
            <div className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]">
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

          {/* 字段插入 */}
          <div className="space-y-1">
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
          {preview.result.ok ? (
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
  )
}
