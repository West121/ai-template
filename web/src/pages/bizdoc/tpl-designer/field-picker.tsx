/**
 * 字段选择器（§9.2：弹选择器插 `{{}}` token）。
 * 分组：表单字段 / 系统字段 / 审批数据（第 N 步 × 子项）/ 计算变量（§12，有则显示）。
 * 目录数据与单元格「插入变量」浮层同源（token-vars.ts）。onPick 回插值表达式。
 */
import { useEffect, useRef, useState } from "react"
import { Braces } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { APPROVAL_SUBS, DISPLAY_ATTRS, SYS_FIELD_OPTIONS_V2, type FieldOption } from "./token-vars"

export type { FieldOption }

export function FieldPicker({
  fields,
  calcVars,
  onPick,
  size = "sm",
}: {
  fields: FieldOption[]
  /** §12 计算变量（有则出「计算」组） */
  calcVars?: FieldOption[]
  onPick: (expr: string) => void
  /** 触发按钮尺寸 */
  size?: "sm" | "icon"
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState("form")
  const [step, setStep] = useState(0)

  const pick = (expr: string) => {
    onPick(expr)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {size === "icon" ? (
          <Button variant="ghost" size="icon" className="size-7 shrink-0 text-primary" title="插入字段">
            <Braces className="size-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs text-primary">
            <Braces className="size-3.5" /> 字段
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7 w-full">
            <TabsTrigger value="form" className="h-6 flex-1 text-xs">
              表单
            </TabsTrigger>
            <TabsTrigger value="sys" className="h-6 flex-1 text-xs">
              系统
            </TabsTrigger>
            <TabsTrigger value="approval" className="h-6 flex-1 text-xs">
              审批
            </TabsTrigger>
            {calcVars && calcVars.length > 0 && (
              <TabsTrigger value="calc" className="h-6 flex-1 text-xs">
                计算
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {tab === "form" &&
            (fields.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">暂无表单字段（先在定义里设计字段）</p>
            ) : (
              fields.map((f) => {
                const attrs = f.type ? DISPLAY_ATTRS[f.type] : undefined
                return (
                  <div key={f.key}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => pick(f.key)}
                    >
                      <span>{f.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{f.key}</span>
                    </button>
                    {attrs && (
                      <div className="mb-0.5 ml-3 flex flex-wrap gap-1 border-l pl-2">
                        {attrs.map((a) => (
                          <button
                            key={a.sub}
                            type="button"
                            title={`{{${f.key}.${a.sub}}}`}
                            className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary"
                            onClick={() => pick(`${f.key}.${a.sub}`)}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            ))}
          {tab === "sys" &&
            SYS_FIELD_OPTIONS_V2.map((f) => (
              <button
                key={f.key}
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => pick(f.key)}
              >
                <span>{f.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{f.key}</span>
              </button>
            ))}
          {tab === "approval" && (
            <div className="space-y-1.5 px-1 py-1">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">审批步骤</span>
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`rounded border px-1.5 py-0.5 text-[11px] ${step === n ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
                    onClick={() => setStep(n)}
                  >
                    {n + 1}
                  </button>
                ))}
              </div>
              {APPROVAL_SUBS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => pick(`_approvals.${step}.${s.key}`)}
                >
                  <span>
                    第{step + 1}步·{s.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">.{s.key}</span>
                </button>
              ))}
              <p className="text-[10px] leading-snug text-muted-foreground">审批数据来自流程办理记录（_approvals），按办理顺序取第 N 条。</p>
            </div>
          )}
          {tab === "calc" &&
            (calcVars ?? []).map((f) => (
              <button
                key={f.key}
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => pick(f.key)}
              >
                <span>{f.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{f.key}</span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * 值输入 + 插字段按钮（属性面板通用行）。
 * 内部态编辑、失焦才 onCommit —— 一次编辑一步撤销（undo 栈不被逐键淹没）；
 * 外部值变化（undo/redo/换选中块）且未聚焦时同步回显。
 */
export function TokenInput({
  value,
  onCommit,
  fields,
  calcVars,
  placeholder,
  multiline = false,
}: {
  value: string
  onCommit: (v: string) => void
  fields: FieldOption[]
  calcVars?: FieldOption[]
  placeholder?: string
  multiline?: boolean
}) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setV(value)
  }, [value])
  const commit = (next: string) => {
    setV(next)
    if (next !== value) onCommit(next)
  }
  return (
    <div className="flex items-start gap-1">
      {multiline ? (
        <textarea
          ref={(el) => void (ref.current = el)}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => commit(v)}
          placeholder={placeholder}
          rows={3}
          className="min-h-16 w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      ) : (
        <input
          ref={(el) => void (ref.current = el)}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => commit(v)}
          onKeyDown={(e) => e.key === "Enter" && commit(v)}
          placeholder={placeholder}
          className="h-7 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      )}
      <FieldPicker size="icon" fields={fields} calcVars={calcVars} onPick={(expr) => commit(`${v}{{${expr}}}`)} />
    </div>
  )
}
