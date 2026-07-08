/**
 * 表单设计器核心（v2）：左组件面板 + 中画布（容器嵌套拖拽/排序）+ 右属性面板（分区）。
 * 顶部工具条：撤销/重做、JSON 导入、预览（真实渲染+联动+校验+事件）、表单设置（事件/变量/标题）。
 * demo 页与 /workflow/form-defs 定义编辑弹窗共用本组件，受控组件。
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type Dispatch,
  type SetStateAction,
} from "react"
import {
  Bold,
  Copy,
  GripVertical,
  Image as ImageIcon,
  Italic,
  LayoutTemplate,
  MousePointerClick,
  PenLine,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Underline,
  Undo2,
  Upload,
  UploadCloud,
  Eye,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { sanitizeHtml } from "@/lib/sanitize"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Modal } from "@/components/modal"
import { FormRenderer } from "@/components/form-renderer"
import type {
  ConditionGroup,
  DataSource,
  FormCondition,
  FormEvents,
  FormWidget as RtFormWidget,
  ValidationRule,
} from "@/types/workflow"
import { REGEX_PRESETS } from "@/lib/form-runtime"
import {
  WIDGET_CATEGORIES,
  WIDGET_META,
  createWidget,
  isContainerType,
  isLayoutType,
  isSubformType,
  newWidgetId,
  widgetKeyOf,
  type FormWidget,
  type WidgetType,
} from "./model"
import {
  BUILTIN_TEMPLATES,
  deleteCustomTemplate,
  loadCustomTemplates,
  saveCustomTemplate,
  type FormTemplate,
} from "./templates"

/* ================= 树操作工具（容器嵌套） ================= */

function updateInTree(list: FormWidget[], id: string, partial: Partial<FormWidget>): FormWidget[] {
  return list.map((w) => {
    if (w.id === id) return { ...w, ...partial }
    if (w.children) return { ...w, children: updateInTree(w.children, id, partial) }
    return w
  })
}

function removeFromTree(list: FormWidget[], id: string): FormWidget[] {
  return list
    .filter((w) => w.id !== id)
    .map((w) => (w.children ? { ...w, children: removeFromTree(w.children, id) } : w))
}

function findInTree(list: FormWidget[], id: string): FormWidget | null {
  for (const w of list) {
    if (w.id === id) return w
    if (w.children) {
      const found = findInTree(w.children, id)
      if (found) return found
    }
  }
  return null
}

function isDescendant(list: FormWidget[], ancestorId: string, targetId: string): boolean {
  const anc = findInTree(list, ancestorId)
  if (!anc?.children) return false
  return !!findInTree(anc.children, targetId)
}

function insertBefore(list: FormWidget[], beforeId: string, widget: FormWidget): FormWidget[] {
  const idx = list.findIndex((w) => w.id === beforeId)
  if (idx >= 0) return [...list.slice(0, idx), widget, ...list.slice(idx)]
  return list.map((w) => (w.children ? { ...w, children: insertBefore(w.children, beforeId, widget) } : w))
}

function insertAfter(list: FormWidget[], afterId: string, widget: FormWidget): FormWidget[] {
  const idx = list.findIndex((w) => w.id === afterId)
  if (idx >= 0) return [...list.slice(0, idx + 1), widget, ...list.slice(idx + 1)]
  return list.map((w) => (w.children ? { ...w, children: insertAfter(w.children, afterId, widget) } : w))
}

function appendTo(list: FormWidget[], parentId: string | null, widget: FormWidget): FormWidget[] {
  if (parentId === null) return [...list, widget]
  return list.map((w) => {
    if (w.id === parentId) return { ...w, children: [...(w.children ?? []), widget] }
    if (w.children) return { ...w, children: appendTo(w.children, parentId, widget) }
    return w
  })
}

/** 深拷贝并重新分配 id（复制控件用） */
function cloneWidget(w: FormWidget): FormWidget {
  return {
    ...w,
    id: newWidgetId(),
    key: undefined,
    children: w.children?.map(cloneWidget),
  }
}

/** 扁平字段列表（联动条件可选字段：排除自身、布局、容器、子表单） */
function flatFieldOptions(list: FormWidget[], selfId: string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  const walk = (l: FormWidget[]) => {
    for (const w of l) {
      if (w.id === selfId) continue
      if (isLayoutType(w.type)) continue
      if (isContainerType(w.type)) {
        if (w.children) walk(w.children)
        continue
      }
      if (isSubformType(w.type)) continue
      out.push({ key: widgetKeyOf(w), label: w.label })
    }
  }
  walk(list)
  return out
}

/* ================= 设计态字段渲染（禁用交互，仅展示样式） ================= */

export function DesignPreview({ widget }: { widget: FormWidget }) {
  switch (widget.type) {
    case "input":
      return <Input disabled placeholder={widget.placeholder} className="h-9" />
    case "textarea":
      return <Textarea disabled placeholder={widget.placeholder} rows={3} />
    case "number":
      return <Input disabled type="number" placeholder={widget.placeholder} className="h-9" />
    case "date":
      return <Input disabled type="date" className="h-9" />
    case "select":
    case "user":
    case "cascade":
      return (
        <div className="flex h-9 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
          {widget.placeholder || "请选择"}
          <span className="text-xs">▾</span>
        </div>
      )
    case "amount":
      return (
        <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
          ￥ {widget.placeholder || "请输入金额"}
        </div>
      )
    case "address":
      return (
        <div className="flex gap-2">
          {["省", "市", "区/县"].map((p) => (
            <div key={p} className="flex h-9 flex-1 items-center justify-between rounded-md border bg-muted/30 px-2 text-xs text-muted-foreground">
              {p}
              <span>▾</span>
            </div>
          ))}
        </div>
      )
    case "relation":
      return (
        <div className="flex h-9 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
          {widget.placeholder || "点击选择关联记录"}
          <Search className="size-3.5" />
        </div>
      )
    case "upload":
      return (
        <div className="flex h-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
          <UploadCloud className="size-4" />
          点击 / 拖拽上传附件
        </div>
      )
    case "image":
      return (
        <div className="flex gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex size-16 items-center justify-center rounded-md border border-dashed bg-muted/20 text-muted-foreground">
              <ImageIcon className="size-5" />
            </div>
          ))}
        </div>
      )
    case "richtext":
      return (
        <div className="rounded-md border">
          <div className="flex gap-1 border-b bg-muted/30 px-2 py-1 text-muted-foreground">
            <Bold className="size-3.5" />
            <Italic className="size-3.5" />
            <Underline className="size-3.5" />
          </div>
          <div className="px-3 py-2 text-xs text-muted-foreground">{widget.placeholder || "富文本编辑区…"}</div>
        </div>
      )
    case "signature":
      return (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
          <PenLine className="mr-1 size-4" /> 手写签名区
        </div>
      )
    case "html":
      return (
        <div
          className="rounded-md border border-dashed bg-muted/10 px-3 py-2 text-sm [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{
            __html: widget.content
              ? sanitizeHtml(widget.content)
              : "<span class='text-muted-foreground'>HTML 内容</span>",
          }}
        />
      )
    case "radio":
      return (
        <div className="flex flex-wrap gap-4">
          {widget.options.map((option) => (
            <span key={option} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="size-3.5 rounded-full border-2 border-muted-foreground/40" />
              {option}
            </span>
          ))}
        </div>
      )
    case "checkbox":
      return (
        <div className="flex flex-wrap gap-4">
          {widget.options.map((option) => (
            <span key={option} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="size-3.5 rounded-[4px] border-2 border-muted-foreground/40" />
              {option}
            </span>
          ))}
        </div>
      )
    case "rating":
      return (
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className="size-4 text-muted-foreground/30" />
          ))}
        </div>
      )
    case "switch":
      return <Switch disabled />
    case "divider":
      return (
        <div className="flex items-center gap-3 py-1">
          <Separator className="flex-1" />
          {widget.content && <span className="text-xs text-muted-foreground">{widget.content}</span>}
          <Separator className="flex-1" />
        </div>
      )
    case "note":
      return (
        <p className="rounded-md bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {widget.content}
        </p>
      )
    default:
      return null
  }
}

/* ================= 预览：直接复用运行时渲染器（联动+校验+事件） ================= */

export function FormPreview({
  widgets,
  onClose,
  onSubmitValues,
  formEvents,
  variables,
}: {
  widgets: FormWidget[]
  onClose: () => void
  onSubmitValues?: (named: Record<string, unknown>) => void
  formEvents?: FormEvents
  variables?: Record<string, unknown>
}) {
  return (
    <FormRenderer
      widgets={widgets as unknown as RtFormWidget[]}
      formEvents={formEvents}
      variables={variables}
      submitLabel="提交"
      cancelLabel="取消"
      onCancel={onClose}
      onSubmit={(data) => {
        onSubmitValues?.(data)
        onClose()
      }}
    />
  )
}

/* ================= 属性面板：小组件 ================= */

const OPERATORS: { value: string; label: string }[] = [
  { value: "eq", label: "等于" },
  { value: "ne", label: "不等于" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
  { value: "contains", label: "包含" },
  { value: "notContains", label: "不包含" },
  { value: "empty", label: "为空" },
  { value: "notEmpty", label: "非空" },
  { value: "in", label: "属于(逗号分隔)" },
]

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-xs font-semibold text-foreground/80">{children}</div>
}

function ConditionEditor({
  group,
  fields,
  onChange,
}: {
  group: ConditionGroup | undefined
  fields: { key: string; label: string }[]
  onChange: (g: ConditionGroup | undefined) => void
}) {
  const g: ConditionGroup = group ?? { logic: "AND", conditions: [] }
  const setConds = (conditions: FormCondition[]) =>
    onChange(conditions.length === 0 ? undefined : { ...g, conditions })
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">满足</span>
        <Select value={g.logic} onValueChange={(v) => onChange({ ...g, logic: v as "AND" | "OR" })}>
          <SelectTrigger className="h-7 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">全部</SelectItem>
            <SelectItem value="OR">任一</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">条件时</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 gap-1 px-1.5 text-xs"
          onClick={() => setConds([...g.conditions, { field: fields[0]?.key ?? "", operator: "eq", value: "" }])}
        >
          <Plus className="size-3" /> 条件
        </Button>
      </div>
      {g.conditions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">无条件（始终成立）</p>
      ) : (
        g.conditions.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <Select
              value={c.field}
              onValueChange={(v) => setConds(g.conditions.map((x, j) => (j === i ? { ...x, field: v } : x)))}
            >
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue placeholder="字段" />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={c.operator}
              onValueChange={(v) => setConds(g.conditions.map((x, j) => (j === i ? { ...x, operator: v } : x)))}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {c.operator !== "empty" && c.operator !== "notEmpty" && (
              <Input
                value={String(c.value ?? "")}
                onChange={(e) => setConds(g.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                className="h-7 w-20 text-xs"
                placeholder="值"
              />
            )}
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500"
              onClick={() => setConds(g.conditions.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function ValidationEditor({
  rules,
  onChange,
}: {
  rules: ValidationRule[] | undefined
  onChange: (r: ValidationRule[] | undefined) => void
}) {
  const list = rules ?? []
  const update = (next: ValidationRule[]) => onChange(next.length === 0 ? undefined : next)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(["required", "regex", "length", "range", "unique", "custom"] as const).map((t) => (
          <Button
            key={t}
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            onClick={() => {
              const rule: ValidationRule =
                t === "regex"
                  ? { type: "regex", pattern: "" }
                  : t === "custom"
                    ? { type: "custom", expr: "" }
                    : t === "unique"
                      ? { type: "unique" }
                      : t === "length" || t === "range"
                        ? { type: t }
                        : { type: "required" }
              update([...list, rule])
            }}
          >
            <Plus className="size-3" />
            {t === "required" ? "必填" : t === "regex" ? "正则" : t === "length" ? "长度" : t === "range" ? "范围" : t === "unique" ? "唯一" : "自定义"}
          </Button>
        ))}
      </div>
      {list.map((rule, i) => (
        <div key={i} className="space-y-1.5 rounded-md border p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">
              {rule.type === "required" ? "必填" : rule.type === "regex" ? "正则匹配" : rule.type === "length" ? "长度限制" : rule.type === "range" ? "数值范围" : rule.type === "unique" ? "唯一" : "自定义表达式"}
            </span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-rose-500"
              onClick={() => update(list.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {rule.type === "regex" && (
            <>
              <div className="flex flex-wrap gap-1">
                {Object.entries(REGEX_PRESETS).map(([k, p]) => (
                  <Button
                    key={k}
                    variant="secondary"
                    size="sm"
                    className="h-5 px-1.5 text-[10px]"
                    onClick={() => update(list.map((r, j) => (j === i ? { ...rule, pattern: p.pattern, preset: k } : r)))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <Input
                value={rule.pattern}
                onChange={(e) => update(list.map((r, j) => (j === i ? { ...rule, pattern: e.target.value } : r)))}
                placeholder="正则表达式"
                className="h-7 font-mono text-xs"
              />
            </>
          )}
          {(rule.type === "length" || rule.type === "range") && (
            <div className="flex gap-1">
              <Input
                type="number"
                value={rule.min ?? ""}
                onChange={(e) =>
                  update(list.map((r, j) => (j === i ? { ...rule, min: e.target.value === "" ? undefined : Number(e.target.value) } : r)))
                }
                placeholder="最小"
                className="h-7 text-xs"
              />
              <Input
                type="number"
                value={rule.max ?? ""}
                onChange={(e) =>
                  update(list.map((r, j) => (j === i ? { ...rule, max: e.target.value === "" ? undefined : Number(e.target.value) } : r)))
                }
                placeholder="最大"
                className="h-7 text-xs"
              />
            </div>
          )}
          {rule.type === "custom" && (
            <Textarea
              value={rule.expr}
              onChange={(e) => update(list.map((r, j) => (j === i ? { ...rule, expr: e.target.value } : r)))}
              placeholder="返回布尔的表达式，可用 value / data，如：value > data.min"
              rows={2}
              className="font-mono text-xs"
            />
          )}
          <Input
            value={rule.message ?? ""}
            onChange={(e) => update(list.map((r, j) => (j === i ? { ...rule, message: e.target.value || undefined } : r)))}
            placeholder="错误提示（可选）"
            className="h-7 text-xs"
          />
        </div>
      ))}
    </div>
  )
}

const SCRIPT_HELP = `可用上下文 API（ctx 已解构）：
data                     当前表单数据快照
get(key) / set(key,val)  读写字段值
setVisible(key,bool)     显隐字段
setRequired(key,bool)    必填切换
setReadonly(key,bool)    只读切换
setOptions(key,options)  动态设置选项
field                    字段事件中=当前字段 {key,value}
variables                表单变量对象
utils.sum/round/formatDate/now/isEmpty

示例（字段 onChange 联动求和）：
set('total', utils.sum([get('a'), get('b')]))

示例（表单 onSubmit 拦截）：
if (utils.isEmpty(get('name'))) return false`

function ScriptField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        rows={3}
        className="font-mono text-xs"
        placeholder="// 受限 JS，见下方说明"
      />
    </div>
  )
}

/* ================= 属性面板 ================= */

function PropertyPanel({
  widget,
  allWidgets,
  showKeyField,
  onUpdate,
}: {
  widget: FormWidget
  allWidgets: FormWidget[]
  showKeyField: boolean
  onUpdate: (partial: Partial<FormWidget>) => void
}) {
  const fields = useMemo(() => flatFieldOptions(allWidgets, widget.id), [allWidgets, widget.id])
  const isLayout = isLayoutType(widget.type)
  const isContainer = isContainerType(widget.type)
  const isSubform = isSubformType(widget.type)
  const isOptionType = widget.type === "radio" || widget.type === "checkbox" || widget.type === "select"
  const props = widget.props ?? {}
  const setProp = (patch: Record<string, unknown>) => onUpdate({ props: { ...props, ...patch } })

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        {(() => {
          const Icon = WIDGET_META[widget.type].icon
          return <Icon className="size-4 text-primary" />
        })()}
        <span className="text-sm font-semibold">{WIDGET_META[widget.type].label}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{widget.id}</span>
      </div>
      <Separator />

      {/* ---- 基础属性 ---- */}
      {!isLayout && (
        <>
          {showKeyField && (
            <div className="space-y-1.5">
              <Label className="text-xs">字段标识（key）</Label>
              <Input
                value={widget.key ?? ""}
                onChange={(e) => onUpdate({ key: e.target.value })}
                placeholder={`默认 ${widget.id}`}
                className="h-8 font-mono text-xs"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                当前生效值：<span className="font-mono">{widgetKeyOf(widget)}</span>
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">{isContainer || isSubform ? "标题" : "字段标签"}</Label>
            <Input value={widget.label} onChange={(e) => onUpdate({ label: e.target.value })} className="h-8 text-sm" />
          </div>
        </>
      )}

      {!isLayout && !isContainer && (
        <>
          {["input", "textarea", "number", "select", "user"].includes(widget.type) && (
            <div className="space-y-1.5">
              <Label className="text-xs">占位提示</Label>
              <Input value={widget.placeholder} onChange={(e) => onUpdate({ placeholder: e.target.value })} className="h-8 text-sm" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">描述说明</Label>
            <Input value={widget.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="展示在字段下方" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">默认值</Label>
            <Input
              value={String(widget.defaultValue ?? "")}
              onChange={(e) => onUpdate({ defaultValue: e.target.value || undefined })}
              placeholder="静态默认值（可选）"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">字段宽度</Label>
            {(() => {
              const isSpan = typeof widget.width === "object"
              const cur = isSpan ? "span" : (widget.width as string)
              return (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: "full", label: "整行" },
                        { value: "half", label: "半行" },
                        { value: "span", label: "栅格跨列" },
                      ] as const
                    ).map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() =>
                          onUpdate({ width: o.value === "span" ? { span: isSpan ? (widget.width as { span: number }).span : 12 } : o.value })
                        }
                        className={cn(
                          "rounded-md border py-1.5 text-xs transition-colors",
                          cur === o.value ? "border-primary/40 bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {isSpan && (
                    <div className="flex items-center gap-2 pt-1">
                      <Label className="text-[11px] text-muted-foreground">跨列（24 栅格）</Label>
                      <Select
                        value={String((widget.width as { span: number }).span)}
                        onValueChange={(v) => onUpdate({ width: { span: Number(v) } })}
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} 列
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
          <div className="flex items-center justify-between py-0.5">
            <Label className="text-xs">必填</Label>
            <Switch checked={widget.required} onCheckedChange={(v) => onUpdate({ required: v })} />
          </div>
          <div className="flex items-center justify-between py-0.5">
            <Label className="text-xs">只读</Label>
            <Switch checked={!!widget.readonly} onCheckedChange={(v) => onUpdate({ readonly: v || undefined })} />
          </div>
          <div className="flex items-center justify-between py-0.5">
            <Label className="text-xs">隐藏</Label>
            <Switch checked={!!widget.hidden} onCheckedChange={(v) => onUpdate({ hidden: v || undefined })} />
          </div>
        </>
      )}

      {/* ---- 布局控件专属 ---- */}
      {isLayout && (
        <div className="space-y-1.5">
          <Label className="text-xs">{widget.type === "note" ? "说明内容" : widget.type === "html" ? "HTML 内容" : "分割线文案"}</Label>
          <Textarea
            value={widget.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            rows={widget.type === "html" ? 6 : 3}
            className={cn("text-sm", widget.type === "html" && "font-mono text-xs")}
          />
        </div>
      )}

      {/* ---- 选项 & 数据源 ---- */}
      {isOptionType && (
        <>
          <Separator />
          <SectionTitle>数据源</SectionTitle>
          <Select
            value={widget.dataSource?.type ?? "static"}
            onValueChange={(v) => {
              const ds: DataSource | undefined =
                v === "static"
                  ? undefined
                  : v === "dict"
                    ? { type: "dict", dictCode: "" }
                    : v === "api"
                      ? { type: "api", url: "", labelField: "label", valueField: "value" }
                      : { type: "form", defCode: "", labelField: "name", valueField: "id" }
              onUpdate({ dataSource: ds })
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="static">静态选项</SelectItem>
              <SelectItem value="dict">字典</SelectItem>
              <SelectItem value="api">远程接口</SelectItem>
              <SelectItem value="form">关联表单</SelectItem>
            </SelectContent>
          </Select>
          {widget.dataSource?.type === "api" && (
            <div className="space-y-1">
              <Input
                value={widget.dataSource.url}
                onChange={(e) => onUpdate({ dataSource: { ...(widget.dataSource as { type: "api"; labelField: string; valueField: string }), type: "api", url: e.target.value } })}
                placeholder="接口地址 /api/..."
                className="h-8 font-mono text-xs"
              />
              <div className="flex gap-1">
                <Input
                  value={widget.dataSource.labelField}
                  onChange={(e) => onUpdate({ dataSource: { ...(widget.dataSource as { type: "api"; url: string; valueField: string }), type: "api", labelField: e.target.value } })}
                  placeholder="labelField"
                  className="h-8 font-mono text-xs"
                />
                <Input
                  value={widget.dataSource.valueField}
                  onChange={(e) => onUpdate({ dataSource: { ...(widget.dataSource as { type: "api"; url: string; labelField: string }), type: "api", valueField: e.target.value } })}
                  placeholder="valueField"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">兼容返回 T[] 或 {"{ list: T[] }"}；无接口时降级为空选项。</p>
            </div>
          )}
          {widget.dataSource?.type === "dict" && (
            <Input
              value={widget.dataSource.dictCode}
              onChange={(e) => onUpdate({ dataSource: { type: "dict", dictCode: e.target.value } })}
              placeholder="字典编码 dictCode"
              className="h-8 font-mono text-xs"
            />
          )}
          {widget.dataSource?.type === "form" && (
            <div className="space-y-1">
              <Input
                value={widget.dataSource.defCode}
                onChange={(e) =>
                  onUpdate({ dataSource: { ...(widget.dataSource as { type: "form"; labelField: string; valueField: string }), type: "form", defCode: e.target.value } })
                }
                placeholder="关联表单编码 defCode"
                className="h-8 font-mono text-xs"
              />
              <div className="flex gap-1">
                <Input
                  value={widget.dataSource.labelField}
                  onChange={(e) =>
                    onUpdate({ dataSource: { ...(widget.dataSource as { type: "form"; defCode: string; valueField: string }), type: "form", labelField: e.target.value } })
                  }
                  placeholder="labelField"
                  className="h-8 font-mono text-xs"
                />
                <Input
                  value={widget.dataSource.valueField}
                  onChange={(e) =>
                    onUpdate({ dataSource: { ...(widget.dataSource as { type: "form"; defCode: string; labelField: string }), type: "form", valueField: e.target.value } })
                  }
                  placeholder="valueField"
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
          )}
          {(!widget.dataSource || widget.dataSource.type === "static") && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">选项</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                  onClick={() => onUpdate({ options: [...widget.options, `选项 ${widget.options.length + 1}`] })}
                >
                  <Plus className="size-3" /> 添加
                </Button>
              </div>
              {widget.options.map((option, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    value={option}
                    onChange={(e) => onUpdate({ options: widget.options.map((o, i) => (i === index ? e.target.value : o)) })}
                    className="h-7 text-xs"
                  />
                  <button
                    type="button"
                    disabled={widget.options.length <= 1}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500 disabled:opacity-30"
                    onClick={() => onUpdate({ options: widget.options.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---- 控件专属 props ---- */}
      {widget.type === "number" && (
        <>
          <Separator />
          <SectionTitle>数字属性</SectionTitle>
          <div className="flex gap-1">
            <Input type="number" value={(props.precision as number) ?? ""} onChange={(e) => setProp({ precision: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="精度" className="h-7 text-xs" />
            <Input value={(props.suffix as string) ?? ""} onChange={(e) => setProp({ suffix: e.target.value || undefined })} placeholder="单位后缀" className="h-7 text-xs" />
          </div>
        </>
      )}
      {widget.type === "date" && (
        <>
          <Separator />
          <SectionTitle>日期属性</SectionTitle>
          <Select value={(props.mode as string) ?? "date"} onValueChange={(v) => setProp({ mode: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="date">日期</SelectItem>
              <SelectItem value="datetime">日期时间</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
      {widget.type === "rating" && (
        <>
          <Separator />
          <SectionTitle>评分属性</SectionTitle>
          <Input type="number" value={(props.max as number) ?? 5} onChange={(e) => setProp({ max: Number(e.target.value) || 5 })} placeholder="最大星数" className="h-7 text-xs" />
        </>
      )}
      {widget.type === "amount" && (
        <>
          <Separator />
          <SectionTitle>金额属性</SectionTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs">前缀符号</Label>
            <Input value={(props.prefix as string) ?? "￥"} onChange={(e) => setProp({ prefix: e.target.value })} className="h-7 w-20 text-xs" />
          </div>
          <p className="text-[11px] text-muted-foreground">运行态自动显示千分位与人民币大写。</p>
        </>
      )}
      {(widget.type === "upload" || widget.type === "image") && (
        <>
          <Separator />
          <SectionTitle>{widget.type === "image" ? "图片属性" : "附件属性"}</SectionTitle>
          <div className="flex items-center justify-between py-0.5">
            <Label className="text-xs">允许多选</Label>
            <Switch checked={props.multiple !== false} onCheckedChange={(v) => setProp({ multiple: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground">存储文件 id 列表；复用分片上传组件（秒传 / 断点续传）。</p>
        </>
      )}
      {widget.type === "user" && (
        <>
          <Separator />
          <SectionTitle>成员属性</SectionTitle>
          <div className="flex items-center justify-between py-0.5">
            <Label className="text-xs">允许多选</Label>
            <Switch checked={props.multiple === true} onCheckedChange={(v) => setProp({ multiple: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground">存储 OrgRef（成员/部门/角色），兼容旧字符串数据。</p>
        </>
      )}
      {widget.type === "relation" && (
        <>
          <Separator />
          <SectionTitle>关联表单</SectionTitle>
          <Input
            value={widget.dataSource?.type === "form" ? widget.dataSource.defCode : ""}
            onChange={(e) =>
              onUpdate({
                dataSource: {
                  type: "form",
                  defCode: e.target.value,
                  labelField: widget.dataSource?.type === "form" ? widget.dataSource.labelField : "name",
                  valueField: widget.dataSource?.type === "form" ? widget.dataSource.valueField : "id",
                },
              })
            }
            placeholder="关联表单编码 defCode"
            className="h-8 font-mono text-xs"
          />
          <div className="flex gap-1">
            <Input
              value={widget.dataSource?.type === "form" ? widget.dataSource.labelField : "name"}
              onChange={(e) =>
                onUpdate({
                  dataSource: {
                    type: "form",
                    defCode: widget.dataSource?.type === "form" ? widget.dataSource.defCode : "",
                    labelField: e.target.value,
                    valueField: widget.dataSource?.type === "form" ? widget.dataSource.valueField : "id",
                  },
                })
              }
              placeholder="labelField（展示）"
              className="h-8 font-mono text-xs"
            />
            <Input
              value={widget.dataSource?.type === "form" ? widget.dataSource.valueField : "id"}
              onChange={(e) =>
                onUpdate({
                  dataSource: {
                    type: "form",
                    defCode: widget.dataSource?.type === "form" ? widget.dataSource.defCode : "",
                    labelField: widget.dataSource?.type === "form" ? widget.dataSource.labelField : "name",
                    valueField: e.target.value,
                  },
                })
              }
              placeholder="valueField（存储）"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="flex items-center justify-between py-0.5">
            <Label className="text-xs">允许多选</Label>
            <Switch checked={props.multiple === true} onCheckedChange={(v) => setProp({ multiple: v })} />
          </div>
          <p className="text-[11px] text-muted-foreground">弹窗选记录：存唯一值、展示名称分离；无接口时用演示数据降级。</p>
        </>
      )}
      {widget.type === "cascade" && (
        <>
          <Separator />
          <SectionTitle>级联数据源</SectionTitle>
          <Select
            value={widget.dataSource?.type === "cascade" && widget.dataSource.preset === "region" ? "region" : "custom"}
            onValueChange={(v) =>
              onUpdate({ dataSource: v === "region" ? { type: "cascade", preset: "region" } : { type: "cascade", tree: [] } })
            }
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="region">内置省市区</SelectItem>
              <SelectItem value="custom">自定义树 JSON</SelectItem>
            </SelectContent>
          </Select>
          {widget.dataSource?.type === "cascade" && widget.dataSource.preset !== "region" && (
            <Textarea
              defaultValue={JSON.stringify(widget.dataSource.tree ?? [], null, 2)}
              onBlur={(e) => {
                try {
                  const tree = JSON.parse(e.target.value || "[]")
                  onUpdate({ dataSource: { type: "cascade", tree } })
                } catch {
                  /* 无效 JSON 忽略 */
                }
              }}
              rows={5}
              className="font-mono text-[11px]"
              placeholder='[{ "label": "一级", "value": "1", "children": [{ "label": "二级", "value": "1-1" }] }]'
            />
          )}
        </>
      )}
      {widget.type === "grid" && (
        <>
          <Separator />
          <SectionTitle>栅格属性</SectionTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs">列数</Label>
            <Input type="number" value={(props.columns as number) ?? 2} onChange={(e) => setProp({ columns: Math.max(1, Number(e.target.value) || 2) })} className="h-7 w-16 text-xs" />
          </div>
        </>
      )}
      {widget.type === "tabs" && (
        <>
          <Separator />
          <SectionTitle>标签页</SectionTitle>
          <ListPropEditor
            items={(props.tabs as { key: string; label: string }[]) ?? []}
            labelKey="label"
            onAdd={() => {
              const arr = (props.tabs as { key: string; label: string }[]) ?? []
              setProp({ tabs: [...arr, { key: `tab${arr.length + 1}`, label: `标签${arr.length + 1}` }] })
            }}
            onUpdate={(idx, label) => {
              const arr = [...((props.tabs as { key: string; label: string }[]) ?? [])]
              arr[idx] = { ...arr[idx], label }
              setProp({ tabs: arr })
            }}
            onRemove={(idx) => setProp({ tabs: ((props.tabs as { key: string; label: string }[]) ?? []).filter((_, i) => i !== idx) })}
          />
          <p className="text-[11px] text-muted-foreground">子控件通过 props.tab 归属某标签（默认第一个）。</p>
        </>
      )}
      {widget.type === "collapse" && (
        <>
          <Separator />
          <SectionTitle>折叠面板</SectionTitle>
          <ListPropEditor
            items={((props.panels as { key: string; title: string }[]) ?? []).map((p) => ({ ...p, label: p.title }))}
            labelKey="label"
            onAdd={() => {
              const arr = (props.panels as { key: string; title: string }[]) ?? []
              setProp({ panels: [...arr, { key: `p${arr.length + 1}`, title: `面板${arr.length + 1}` }] })
            }}
            onUpdate={(idx, label) => {
              const arr = [...((props.panels as { key: string; title: string }[]) ?? [])]
              arr[idx] = { ...arr[idx], title: label }
              setProp({ panels: arr })
            }}
            onRemove={(idx) => setProp({ panels: ((props.panels as { key: string; title: string }[]) ?? []).filter((_, i) => i !== idx) })}
          />
        </>
      )}
      {isSubform && (
        <>
          <Separator />
          <SectionTitle>明细表</SectionTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs">展示形态</Label>
            <Select value={(props.mode as string) ?? "table"} onValueChange={(v) => setProp({ mode: v })}>
              <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="table">表格</SelectItem>
                <SelectItem value="card">卡片</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1">
            <Input type="number" value={(props.min as number) ?? ""} onChange={(e) => setProp({ min: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="最少行" className="h-7 text-xs" />
            <Input type="number" value={(props.max as number) ?? ""} onChange={(e) => setProp({ max: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="最多行" className="h-7 text-xs" />
          </div>
          <SubformColumnsEditor widget={widget} showKeyField={showKeyField} onUpdate={onUpdate} />
        </>
      )}

      {/* ---- 校验 ---- */}
      {!isLayout && !isContainer && !isSubform && (
        <>
          <Separator />
          <SectionTitle>校验规则</SectionTitle>
          <ValidationEditor rules={widget.validation} onChange={(r) => onUpdate({ validation: r })} />
        </>
      )}

      {/* ---- 联动 ---- */}
      {!isLayout && (
        <>
          <Separator />
          <SectionTitle>联动 · 显示条件</SectionTitle>
          <ConditionEditor group={widget.visibleWhen} fields={fields} onChange={(gr) => onUpdate({ visibleWhen: gr })} />
          {!isContainer && !isSubform && (
            <>
              <SectionTitle>联动 · 必填条件</SectionTitle>
              <ConditionEditor group={widget.requiredWhen} fields={fields} onChange={(gr) => onUpdate({ requiredWhen: gr })} />
            </>
          )}
        </>
      )}

      {/* ---- 事件脚本 ---- */}
      {!isLayout && !isContainer && (
        <>
          <Separator />
          <SectionTitle>事件脚本</SectionTitle>
          <ScriptField label="onChange（值变化）" value={widget.events?.onChange} onChange={(v) => onUpdate({ events: { ...widget.events, onChange: v } })} />
          <details className="rounded-md border bg-muted/30 p-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">可用 API / 示例</summary>
            <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">{SCRIPT_HELP}</pre>
          </details>
        </>
      )}
    </div>
  )
}

function ListPropEditor({
  items,
  labelKey,
  onAdd,
  onUpdate,
  onRemove,
}: {
  items: Record<string, unknown>[]
  labelKey: string
  onAdd: () => void
  onUpdate: (idx: number, label: string) => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={String(it[labelKey] ?? "")} onChange={(e) => onUpdate(i, e.target.value)} className="h-7 text-xs" />
          <button type="button" disabled={items.length <= 1} className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500 disabled:opacity-30" onClick={() => onRemove(i)}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground" onClick={onAdd}>
        <Plus className="size-3" /> 添加
      </Button>
    </div>
  )
}

function SubformColumnsEditor({
  widget,
  showKeyField,
  onUpdate,
}: {
  widget: FormWidget
  showKeyField: boolean
  onUpdate: (p: Partial<FormWidget>) => void
}) {
  const cols = widget.children ?? []
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const COL_TYPES: WidgetType[] = ["input", "textarea", "number", "amount", "date", "select", "user"]
  const editing = editIdx != null ? cols[editIdx] : null
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">列定义</Label>
      {cols.map((col, i) => (
        <div key={col.id} className="flex items-center gap-1">
          <Input
            value={col.label}
            onChange={(e) => onUpdate({ children: cols.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)) })}
            className="h-7 flex-1 text-xs"
          />
          <Select value={col.type} onValueChange={(v) => onUpdate({ children: cols.map((c, j) => (j === i ? { ...c, type: v as WidgetType } : c)) })}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{WIDGET_META[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch checked={col.required} onCheckedChange={(v) => onUpdate({ children: cols.map((c, j) => (j === i ? { ...c, required: v } : c)) })} />
          <button type="button" title="完整属性" className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary" onClick={() => setEditIdx(i)}>
            <SettingsIcon className="size-3.5" />
          </button>
          <button type="button" disabled={cols.length <= 1} className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500 disabled:opacity-30" onClick={() => onUpdate({ children: cols.filter((_, j) => j !== i) })}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground" onClick={() => onUpdate({ children: [...cols, { ...createWidget("input"), label: `列${cols.length + 1}` }] })}>
        <Plus className="size-3" /> 添加列（齿轮=完整属性：校验/默认值/数据源）
      </Button>

      <Modal
        open={editIdx != null}
        onOpenChange={(o) => !o && setEditIdx(null)}
        title={editing ? `列属性 · ${editing.label}` : "列属性"}
        description="子表单列支持校验 / 必填 / 默认值 / 数据源等完整属性"
        width={360}
        height={560}
        bodyClassName="p-0"
      >
        {editing && (
          <ScrollArea className="h-full">
            <PropertyPanel
              widget={editing}
              allWidgets={cols}
              showKeyField={showKeyField}
              onUpdate={(partial) =>
                onUpdate({ children: cols.map((c, j) => (j === editIdx ? { ...c, ...partial } : c)) })
              }
            />
          </ScrollArea>
        )}
      </Modal>
    </div>
  )
}

/* ================= 画布节点（递归） ================= */

interface CanvasCtx {
  selectedId: string | null
  setSelectedId: (id: string) => void
  onDropWidget: (e: DragEvent, target: DropTarget) => void
  onCopy: (id: string) => void
  onDelete: (id: string) => void
  dragOver: string | null
  setDragOver: (v: string | null) => void
}

type DropTarget = { mode: "before"; id: string } | { mode: "append"; parentId: string | null }

/** 画布字段宽度 → CSS grid 跨列（内联 style，避免 Tailwind 动态类失效），与运行渲染一致 */
function canvasSpanStyle(widget: FormWidget, columns: number): { gridColumn: string } {
  if (isContainerType(widget.type) || isSubformType(widget.type) || isLayoutType(widget.type)) {
    return { gridColumn: "1 / -1" }
  }
  const w = widget.width
  if (w && typeof w === "object" && "span" in w) {
    const cols = Math.max(1, Math.min(columns, Math.round(((w as { span: number }).span / 24) * columns)))
    return { gridColumn: `span ${cols} / span ${cols}` }
  }
  if (w === "half") return { gridColumn: "span 1 / span 1" }
  return { gridColumn: "1 / -1" }
}

function CanvasNode({ widget, ctx, columns = 2 }: { widget: FormWidget; ctx: CanvasCtx; columns?: number }) {
  const isSelected = widget.id === ctx.selectedId
  const container = isContainerType(widget.type)
  const subform = isSubformType(widget.type)
  const layout = isLayoutType(widget.type)
  const childColumns =
    widget.type === "grid" && typeof widget.props?.columns === "number" && widget.props.columns > 0
      ? widget.props.columns
      : 2

  return (
    <div
      style={canvasSpanStyle(widget, columns)}
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData("application/x-widget-id", widget.id)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        ctx.setDragOver(widget.id)
      }}
      onDragLeave={() => ctx.setDragOver(null)}
      onDrop={(e) => ctx.onDropWidget(e, { mode: "before", id: widget.id })}
      onClick={(e) => {
        e.stopPropagation()
        ctx.setSelectedId(widget.id)
      }}
      className={cn(
        "group relative rounded-lg border px-3 py-2.5 transition-colors",
        isSelected ? "border-primary/50 bg-primary/5" : "border-transparent hover:border-border hover:bg-accent/40",
        ctx.dragOver === widget.id && "border-t-2 border-t-primary",
      )}
    >
      <div
        className={cn(
          "absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border bg-card px-0.5 shadow-sm transition-opacity",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <span className="cursor-grab p-1 text-muted-foreground"><GripVertical className="size-3" /></span>
        <button type="button" className="rounded p-1 text-muted-foreground hover:text-primary" onClick={(e) => { e.stopPropagation(); ctx.onCopy(widget.id) }}>
          <Copy className="size-3" />
        </button>
        <button type="button" className="rounded p-1 text-muted-foreground hover:text-rose-500" onClick={(e) => { e.stopPropagation(); ctx.onDelete(widget.id) }}>
          <Trash2 className="size-3" />
        </button>
      </div>

      {!layout && (
        <div className="mb-1.5 flex items-center gap-1">
          {(() => {
            const Icon = WIDGET_META[widget.type].icon
            return <Icon className="size-3 text-muted-foreground" />
          })()}
          <Label className="gap-1 text-sm">
            {widget.required && <span className="text-destructive">*</span>}
            {widget.label}
          </Label>
          {widget.hidden && <span className="text-[10px] text-muted-foreground">(隐藏)</span>}
        </div>
      )}

      {container ? (
        <div
          className="min-h-16 rounded-md border border-dashed bg-muted/20 p-2"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); ctx.setDragOver(`in:${widget.id}`) }}
          onDrop={(e) => ctx.onDropWidget(e, { mode: "append", parentId: widget.id })}
        >
          {(widget.children ?? []).length === 0 ? (
            <div className="py-3 text-center text-[11px] text-muted-foreground">拖拽控件到{WIDGET_META[widget.type].label}内</div>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${childColumns}, minmax(0, 1fr))` }}
            >
              {widget.children!.map((c) => (
                <CanvasNode key={c.id} widget={c} ctx={ctx} columns={childColumns} />
              ))}
            </div>
          )}
        </div>
      ) : subform ? (
        <div className="overflow-hidden rounded-md border">
          <div className="flex bg-muted/40 text-[11px] font-medium">
            {(widget.children ?? []).map((c) => (
              <div key={c.id} className="flex-1 border-r px-2 py-1 last:border-r-0">
                {c.required && <span className="text-destructive">*</span>}{c.label}
              </div>
            ))}
          </div>
          <div className="flex text-xs text-muted-foreground">
            {(widget.children ?? []).map((c) => (
              <div key={c.id} className="flex-1 border-r px-2 py-1.5 last:border-r-0">···</div>
            ))}
          </div>
        </div>
      ) : (
        <DesignPreview widget={widget} />
      )}

      {widget.description && !layout && <p className="mt-1 text-xs text-muted-foreground">{widget.description}</p>}
    </div>
  )
}

/* ================= 模板卡片 ================= */

function TemplateCard({
  tpl,
  onApply,
  onDelete,
}: {
  tpl: FormTemplate
  onApply: () => void
  onDelete?: () => void
}) {
  return (
    <div className="group relative flex flex-col gap-1 rounded-lg border bg-card p-3 transition-colors hover:border-primary/40">
      <div className="flex items-center gap-1.5">
        <LayoutTemplate className="size-3.5 text-primary" />
        <span className="text-sm font-medium">{tpl.name}</span>
      </div>
      <p className="line-clamp-2 min-h-8 text-[11px] leading-relaxed text-muted-foreground">{tpl.description}</p>
      <div className="mt-1 flex items-center gap-1">
        <Button size="sm" variant="outline" className="h-6 flex-1 gap-1 text-[11px]" onClick={onApply}>
          应用模板
        </Button>
        {onDelete && (
          <button type="button" className="rounded p-1 text-muted-foreground hover:text-rose-500" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/* ================= 主组件 ================= */

export interface FormDesignerCoreProps {
  widgets: FormWidget[]
  onWidgetsChange: Dispatch<SetStateAction<FormWidget[]>>
  title: string
  onTitleChange: (title: string) => void
  showKeyField?: boolean
  className?: string
  /** 表单级事件（受控，可选） */
  formEvents?: FormEvents
  onFormEventsChange?: (e: FormEvents) => void
  variables?: Record<string, unknown>
  onVariablesChange?: (v: Record<string, unknown>) => void
}

export function FormDesignerCore({
  widgets,
  onWidgetsChange: setWidgets,
  title,
  onTitleChange,
  showKeyField = false,
  className,
  formEvents,
  onFormEventsChange,
  variables,
  onVariablesChange,
}: FormDesignerCoreProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const [templateOpen, setTemplateOpen] = useState(false)
  const [customTemplates, setCustomTemplates] = useState<FormTemplate[]>([])
  const [saveAsName, setSaveAsName] = useState("")

  // 表单级事件/变量（受控优先，否则内部态）
  const [evInternal, setEvInternal] = useState<FormEvents>(formEvents ?? {})
  const [varsInternal, setVarsInternal] = useState<Record<string, unknown>>(variables ?? {})
  const events = formEvents ?? evInternal
  const vars = variables ?? varsInternal
  const setEvents = (e: FormEvents) => (onFormEventsChange ? onFormEventsChange(e) : setEvInternal(e))
  const setVars = (v: Record<string, unknown>) => (onVariablesChange ? onVariablesChange(v) : setVarsInternal(v))

  // 历史栈（撤销/重做）；以当前 widgets 快照为准，避免在 setState 更新函数内触发别的 setState
  const past = useRef<FormWidget[][]>([])
  const future = useRef<FormWidget[][]>([])
  const [, forceTick] = useState(0)
  const commit = useCallback(
    (next: FormWidget[] | ((prev: FormWidget[]) => FormWidget[])) => {
      const resolved = typeof next === "function" ? (next as (p: FormWidget[]) => FormWidget[])(widgets) : next
      past.current.push(widgets)
      if (past.current.length > 50) past.current.shift()
      future.current = []
      setWidgets(resolved)
      forceTick((t) => t + 1)
    },
    [setWidgets, widgets],
  )
  const undo = () => {
    const last = past.current.pop()
    if (!last) return
    future.current.push(widgets)
    setWidgets(last)
    forceTick((t) => t + 1)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(widgets)
    setWidgets(next)
    forceTick((t) => t + 1)
  }

  const selected = selectedId ? findInTree(widgets, selectedId) : null

  const addWidget = (type: WidgetType, target: DropTarget) => {
    const widget = createWidget(type)
    commit((prev) => (target.mode === "before" ? insertBefore(prev, target.id, widget) : appendTo(prev, target.parentId, widget)))
    setSelectedId(widget.id)
  }

  const moveWidget = (dragId: string, target: DropTarget) => {
    // 禁止移动到自身或后代内
    if (target.mode === "append" && target.parentId && (target.parentId === dragId || isDescendant(widgets, dragId, target.parentId))) return
    if (target.mode === "before" && (target.id === dragId || isDescendant(widgets, dragId, target.id))) return
    commit((prev) => {
      const dragged = findInTree(prev, dragId)
      if (!dragged) return prev
      const removed = removeFromTree(prev, dragId)
      return target.mode === "before" ? insertBefore(removed, target.id, dragged) : appendTo(removed, target.parentId, dragged)
    })
  }

  const onDropWidget = (e: DragEvent, target: DropTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(null)
    const type = e.dataTransfer.getData("application/x-widget-type") as WidgetType | ""
    const dragId = e.dataTransfer.getData("application/x-widget-id")
    if (type) addWidget(type, target)
    else if (dragId) moveWidget(dragId, target)
  }

  const canvasCtx: CanvasCtx = {
    selectedId,
    setSelectedId,
    onDropWidget,
    onCopy: (id) => {
      const w = findInTree(widgets, id)
      if (!w) return
      const copy = { ...cloneWidget(w), label: `${w.label} 副本` }
      commit((prev) => insertAfter(prev, id, copy))
      setSelectedId(copy.id)
    },
    onDelete: (id) => {
      commit((prev) => removeFromTree(prev, id))
      if (selectedId === id) setSelectedId(null)
    },
    dragOver,
    setDragOver,
  }

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText)
      const w = Array.isArray(parsed) ? parsed : parsed.widgets
      if (!Array.isArray(w)) throw new Error("缺少 widgets 数组")
      commit(w as FormWidget[])
      if (parsed.title) onTitleChange(parsed.title)
      if (parsed.events) setEvents(parsed.events)
      if (parsed.variables) setVars(parsed.variables)
      setImportOpen(false)
      setImportText("")
    } catch {
      /* 保持弹窗，用户可修正 */
    }
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* 工具条 */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={past.current.length === 0} onClick={undo}>
          <Undo2 className="size-3.5" /> 撤销
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={future.current.length === 0} onClick={redo}>
          <Redo2 className="size-3.5" /> 重做
        </Button>
        <Separator orientation="vertical" className="mx-1 h-4" />
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setImportOpen(true)}>
          <Upload className="size-3.5" /> 导入 JSON
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => {
            setCustomTemplates(loadCustomTemplates())
            setTemplateOpen(true)
          }}
        >
          <LayoutTemplate className="size-3.5" /> 模板库
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="size-3.5" /> 表单设置
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => setPreviewOpen(true)}>
          <Eye className="size-3.5" /> 预览
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧组件面板 */}
        <aside className="w-52 shrink-0 border-r">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              {WIDGET_CATEGORIES.map((category) => (
                <section key={category}>
                  <div className="mb-1.5 px-1 text-xs text-muted-foreground">{category}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(WIDGET_META) as WidgetType[])
                      .filter((type) => WIDGET_META[type].category === category)
                      .map((type) => {
                        const meta = WIDGET_META[type]
                        return (
                          <button
                            key={type}
                            type="button"
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("application/x-widget-type", type)}
                            onClick={() => addWidget(type, { mode: "append", parentId: null })}
                            className="flex cursor-grab items-center gap-1.5 rounded-md border bg-card px-2 py-2 text-xs transition-colors hover:border-primary/40 hover:bg-accent active:cursor-grabbing"
                          >
                            <meta.icon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{meta.label}</span>
                          </button>
                        )
                      })}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* 中间画布 */}
        <div
          className="min-w-0 flex-1 overflow-y-auto bg-muted/30 p-6"
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver("end")
          }}
          onDrop={(e) => onDropWidget(e, { mode: "append", parentId: null })}
          onClick={() => setSelectedId("")}
        >
          <div className="mx-auto max-w-2xl rounded-xl border bg-card p-6 shadow-sm">
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/50"
              placeholder="表单标题"
              onClick={(e) => e.stopPropagation()}
            />
            <Separator className="my-4" />

            {widgets.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-muted-foreground">
                <MousePointerClick className="size-6 opacity-40" />
                <span className="text-sm">从左侧点击或拖拽字段到这里</span>
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                {widgets.map((widget) => (
                  <CanvasNode key={widget.id} widget={widget} ctx={canvasCtx} columns={2} />
                ))}
              </div>
            )}

            {widgets.length > 0 && (
              <div className={cn("mt-3 flex h-9 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground transition-colors", dragOver === "end" && "border-primary bg-primary/5 text-primary")}>
                <Plus className="mr-1 size-3.5" /> 拖拽到此处追加字段
              </div>
            )}
          </div>
        </div>

        {/* 右侧属性面板 */}
        <aside className="w-72 shrink-0 border-l">
          <ScrollArea className="h-full">
            {!selected ? (
              <div className="flex h-full min-h-96 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                <MousePointerClick className="size-5 opacity-40" />
                <span className="text-sm">选中画布中的字段进行配置</span>
              </div>
            ) : (
              <PropertyPanel
                widget={selected}
                allWidgets={widgets}
                showKeyField={showKeyField}
                onUpdate={(partial) => commit((prev) => updateInTree(prev, selected.id, partial))}
              />
            )}
          </ScrollArea>
        </aside>
      </div>

      {/* 预览弹窗 */}
      <Modal open={previewOpen} onOpenChange={setPreviewOpen} title={title || "表单预览"} description="真实渲染：联动 / 校验 / 事件脚本均生效" width={680}>
        {widgets.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">画布中还没有字段</div>
        ) : (
          <FormPreview widgets={widgets} formEvents={events} variables={vars} onClose={() => setPreviewOpen(false)} onSubmitValues={(d) => console.log("预览提交：", d)} />
        )}
      </Modal>

      {/* 表单设置弹窗 */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>表单设置</DialogTitle>
            <DialogDescription>标题、表单级事件脚本与变量</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">表单标题</Label>
              <Input value={title} onChange={(e) => onTitleChange(e.target.value)} className="h-8" />
            </div>
            <ScriptField label="onLoad（进入表单）" value={events.onLoad} onChange={(v) => setEvents({ ...events, onLoad: v })} />
            <ScriptField label="onChange（任意字段变化）" value={events.onChange} onChange={(v) => setEvents({ ...events, onChange: v })} />
            <ScriptField label="onSubmit（提交前，return false 拦截）" value={events.onSubmit} onChange={(v) => setEvents({ ...events, onSubmit: v })} />
            <div className="space-y-1.5">
              <Label className="text-xs">变量（JSON 对象）</Label>
              <Textarea
                defaultValue={JSON.stringify(vars, null, 2)}
                onBlur={(e) => {
                  try {
                    setVars(JSON.parse(e.target.value || "{}"))
                  } catch {
                    /* 无效 JSON 忽略 */
                  }
                }}
                rows={3}
                className="font-mono text-xs"
              />
            </div>
            <details className="rounded-md border bg-muted/30 p-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">可用 API / 示例</summary>
              <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">{SCRIPT_HELP}</pre>
            </details>
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 模板库弹窗 */}
      <Modal
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        title="模板库"
        description="应用内置常用模板，或把当前设计另存为模板"
        width={640}
        height={560}
        bodyClassName="flex flex-col gap-3 p-4"
      >
        <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2">
          <Input
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder="将当前设计另存为模板（名称）"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1 text-xs"
            disabled={!saveAsName.trim() || widgets.length === 0}
            onClick={() => {
              saveCustomTemplate({ name: saveAsName.trim(), title, widgets })
              setSaveAsName("")
              setCustomTemplates(loadCustomTemplates())
            }}
          >
            <Save className="size-3.5" /> 另存为模板
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">内置模板</div>
            <div className="grid grid-cols-2 gap-2">
              {BUILTIN_TEMPLATES.map((tpl) => (
                <TemplateCard
                  key={tpl.code}
                  tpl={tpl}
                  onApply={() => {
                    commit(tpl.build())
                    onTitleChange(tpl.title)
                    setSelectedId(null)
                    setTemplateOpen(false)
                  }}
                />
              ))}
            </div>
          </div>
          {customTemplates.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-muted-foreground">我的模板</div>
              <div className="grid grid-cols-2 gap-2">
                {customTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.code}
                    tpl={tpl}
                    onApply={() => {
                      commit(tpl.build())
                      onTitleChange(tpl.title)
                      setSelectedId(null)
                      setTemplateOpen(false)
                    }}
                    onDelete={() => {
                      deleteCustomTemplate(tpl.code)
                      setCustomTemplates(loadCustomTemplates())
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* JSON 导入弹窗 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>导入表单 JSON</DialogTitle>
            <DialogDescription>粘贴 {"{ title, widgets, events, variables }"} 或 widgets 数组</DialogDescription>
          </DialogHeader>
          <Textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={12} className="font-mono text-xs" placeholder='{ "widgets": [] }' />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={doImport}>导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
