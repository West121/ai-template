/**
 * 通用动态表单渲染器（v2 引擎）：schema(widgets) + 初值 + 字段权限 → RHF + zod 动态渲染。
 * 发起中心、实例详情表单快照、驳回后重新提交、设计器预览共用。
 *
 * v2 能力：容器嵌套（grid/group/tabs/collapse）、子表单明细、字段联动（visibleWhen/
 * requiredWhen）、可配校验（ValidationRule[]）、默认值/只读/隐藏、表单与字段事件脚本、
 * 数据源（static/dict/form）。**向后兼容**：旧 schema（无这些字段）原样渲染，props 接口不变。
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  useFieldArray,
  useForm,
  useFormContext,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form"
import { z } from "zod"
import {
  Bold,
  Eraser,
  FileImage,
  Italic,
  List,
  Paperclip,
  Plus,
  Star,
  Trash2,
  Underline,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { sanitizeHtml } from "@/lib/sanitize"
import { AuthImg } from "@/components/auth-img"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileUploader, type UploadedFile } from "@/components/file-uploader"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { RecordPicker, RecordPickerField } from "@/components/record-picker"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CN_REGIONS,
  collectDataWidgets,
  evalConditionGroup,
  formatThousands,
  isContainer,
  isKnownLeaf,
  isLayout,
  isNumericType,
  isSubform,
  keyOf,
  normalizeOptions,
  runScript,
  scriptUtils,
  toChineseAmount,
  validateValue,
  widgetDefault,
  type ScriptCtx,
} from "@/lib/form-runtime"
import {
  widgetKey,
  type CascadeNode,
  type FieldPerm,
  type FormEvents,
  type FormPerms,
  type FormWidget,
  type WfFormData,
  type WidgetOption,
} from "@/types/workflow"

/* ================= 运行态覆盖（脚本 setVisible/setRequired/... 写入） ================= */

interface Override {
  visible?: boolean
  required?: boolean
  readonly?: boolean
  options?: WidgetOption[]
}
type OverrideMap = Record<string, Override>

/* ================= 引擎上下文 ================= */

interface EngineContextValue {
  form: UseFormReturn<WfFormData>
  perms?: FormPerms
  readOnly?: boolean
  design?: boolean
  data: WfFormData
  overrides: OverrideMap
  setOverride: (key: string, patch: Override) => void
}

const EngineContext = createContext<EngineContextValue | null>(null)
const useEngine = () => {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error("useEngine 必须在 FormRenderer 内使用")
  return ctx
}

/* ================= 权限 / 可见性 / 只读 判定 ================= */

function permOf(widget: FormWidget, perms?: FormPerms, readOnly?: boolean): FieldPerm {
  if (readOnly) return "READ"
  return perms?.[widgetKey(widget)] ?? perms?.[widget.id] ?? "EDIT"
}

function resolveVisible(
  widget: FormWidget,
  data: WfFormData,
  ov: Override | undefined,
  perms?: FormPerms,
  readOnly?: boolean,
): boolean {
  if (permOf(widget, perms, readOnly) === "HIDDEN") return false
  if (ov?.visible !== undefined) return ov.visible
  if (widget.hidden) return false
  if (widget.visibleWhen) return evalConditionGroup(widget.visibleWhen, data)
  return true
}

function resolveRequired(widget: FormWidget, data: WfFormData, ov: Override | undefined): boolean {
  if (ov?.required !== undefined) return ov.required
  if (widget.required) return true
  if (widget.requiredWhen) return evalConditionGroup(widget.requiredWhen, data)
  return false
}

function resolveDisabled(
  widget: FormWidget,
  ov: Override | undefined,
  perms?: FormPerms,
  readOnly?: boolean,
): boolean {
  if (readOnly) return true
  if (permOf(widget, perms, readOnly) !== "EDIT") return true
  if (ov?.readonly !== undefined) return ov.readonly
  return Boolean(widget.readonly)
}

/* ================= zod schema（动态，superRefine 读实时值 + overrides ref） ================= */

function buildSchema(
  widgets: FormWidget[],
  perms: FormPerms | undefined,
  readOnly: boolean | undefined,
  overridesRef: { current: OverrideMap },
) {
  const dataWidgets = collectDataWidgets(widgets)
  const shape: Record<string, z.ZodType> = {}
  for (const w of dataWidgets) shape[keyOf(w)] = z.unknown()

  return z.object(shape).superRefine((values, ctx) => {
    const data = values as WfFormData
    for (const w of dataWidgets) {
      const key = keyOf(w)
      const ov = overridesRef.current[key]
      if (!resolveVisible(w, data, ov, perms, readOnly)) continue
      if (resolveDisabled(w, ov, perms, readOnly)) continue // READ/只读跳过校验
      const required = resolveRequired(w, data, ov)
      const value = data[key]

      if (isSubform(w.type)) {
        const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
        const props = w.props ?? {}
        const min = typeof props.min === "number" ? props.min : required ? 1 : 0
        const max = typeof props.max === "number" ? props.max : undefined
        if (rows.length < min) {
          ctx.addIssue({ code: "custom", path: [key], message: `至少填写 ${min} 行` })
        }
        if (max != null && rows.length > max) {
          ctx.addIssue({ code: "custom", path: [key], message: `最多填写 ${max} 行` })
        }
        const cols = w.children ?? []
        rows.forEach((row, idx) => {
          for (const col of cols) {
            const ck = keyOf(col)
            const cv = row?.[ck]
            const colRequired = Boolean(col.required)
            const emptyCell = cv == null || cv === "" || (Array.isArray(cv) && cv.length === 0)
            if (colRequired && emptyCell) {
              ctx.addIssue({ code: "custom", path: [key, idx, ck], message: `请填写${col.label}` })
            } else {
              const msg = validateValue(col.validation, cv, data)
              if (msg) ctx.addIssue({ code: "custom", path: [key, idx, ck], message: msg })
            }
          }
        })
        continue
      }

      const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0)
      if (required && empty) {
        const verb = w.type === "input" || w.type === "textarea" || w.type === "number" ? "请输入" : "请选择"
        ctx.addIssue({ code: "custom", path: [key], message: `${verb}${w.label}` })
        continue
      }
      const msg = validateValue(w.validation, value, data)
      if (msg) ctx.addIssue({ code: "custom", path: [key], message: msg })
    }
  })
}

/* ================= 默认值 / 提交数据 ================= */

function defaultValuesOf(widgets: FormWidget[], initial?: WfFormData): WfFormData {
  const values: WfFormData = {}
  for (const w of collectDataWidgets(widgets)) {
    const key = keyOf(w)
    const raw = initial?.[key]
    if (raw !== undefined && raw !== null) {
      // number / amount 控件内部用字符串承载
      values[key] = isNumericType(w.type) ? String(raw) : raw
    } else {
      const def = widgetDefault(w)
      values[key] = isNumericType(w.type) && def !== "" ? String(def) : def
    }
  }
  return values
}

function toFormData(
  widgets: FormWidget[],
  values: WfFormData,
  perms?: FormPerms,
  readOnly?: boolean,
  overrides: OverrideMap = {},
): WfFormData {
  const data: WfFormData = {}
  for (const w of collectDataWidgets(widgets)) {
    const key = keyOf(w)
    if (!(key in values)) continue
    // 隐藏字段不提交
    if (!resolveVisible(w, values, overrides[key], perms, readOnly)) continue
    const value = values[key]
    if (isNumericType(w.type) && typeof value === "string") {
      data[key] = value === "" ? null : Number(value)
    } else {
      data[key] = value
    }
  }
  return data
}

/* ================= 数据源 hook：static / dict / form ================= */

interface DictType {
  id: number
  code: string
}
interface DictItem {
  label: string
  value: string
  children?: DictItem[]
}

/** 解析字段的候选选项：静态 / 字典（远程） / 覆盖（脚本 setOptions 优先） */
function useWidgetOptions(widget: FormWidget, override?: WidgetOption[]): WidgetOption[] {
  const [remote, setRemote] = useState<WidgetOption[] | null>(null)
  const ds = widget.dataSource

  useEffect(() => {
    let alive = true
    if (ds?.type === "dict" && ds.dictCode) {
      void (async () => {
        try {
          const page = await api<{ list: DictType[] }>(
            "/api/infra/dict/types?pageNum=1&pageSize=200",
          )
          const t = page.list.find((x) => x.code === ds.dictCode)
          if (!t) {
            if (alive) setRemote([])
            return
          }
          const items = await api<DictItem[]>(`/api/infra/dict/types/${t.id}/items`)
          if (alive) setRemote(items.map((i) => ({ label: i.label, value: i.value })))
        } catch {
          if (alive) setRemote([])
        }
      })()
    } else if (ds?.type === "api" && ds.url) {
      void (async () => {
        try {
          // 远程接口：兼容 T[] 或 { list: T[] } 两种返回
          const raw = await api<unknown>(ds.url)
          const list = Array.isArray(raw)
            ? raw
            : Array.isArray((raw as { list?: unknown[] })?.list)
              ? (raw as { list: unknown[] }).list
              : []
          const opts = (list as Record<string, unknown>[]).map((row) => ({
            label: String(row[ds.labelField] ?? ""),
            value: String(row[ds.valueField] ?? ""),
          }))
          if (alive) setRemote(opts)
        } catch {
          if (alive) setRemote([])
        }
      })()
    } else {
      setRemote(null)
    }
    return () => {
      alive = false
    }
  }, [
    ds?.type,
    ds && "dictCode" in ds ? ds.dictCode : "",
    ds && "url" in ds ? ds.url : "",
    ds && "labelField" in ds ? ds.labelField : "",
    ds && "valueField" in ds ? ds.valueField : "",
  ])

  if (override) return override
  if (remote) return remote
  return normalizeOptions(widget.options)
}

/* ================= 叶子数据控件 ================= */

function LeafField({ widget }: { widget: FormWidget }) {
  const engine = useEngine()
  const { form, data, overrides, perms, readOnly } = engine
  const key = keyOf(widget)
  const ov = overrides[key]

  const visible = resolveVisible(widget, data, ov, perms, readOnly)
  const disabled = resolveDisabled(widget, ov, perms, readOnly)
  const required = resolveRequired(widget, data, ov)
  const options = useWidgetOptions(widget, ov?.options)

  if (!visible) return null

  // 未知控件类型：占位
  if (!isKnownLeaf(widget.type)) {
    return (
      <div>
        <div className="mb-1.5 text-sm font-medium">{widget.label}</div>
        <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
          暂不支持的控件类型：{widget.type}
        </div>
      </div>
    )
  }

  return (
    <FormField
      control={form.control}
      name={key}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={!disabled && required}>{widget.label}</FormLabel>
          {widget.type === "input" && (
            <FormControl>
              <Input
                disabled={disabled}
                placeholder={disabled ? "—" : widget.placeholder}
                value={(field.value as string) ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            </FormControl>
          )}
          {widget.type === "textarea" && (
            <FormControl>
              <Textarea
                disabled={disabled}
                placeholder={disabled ? "—" : widget.placeholder}
                rows={3}
                value={(field.value as string) ?? ""}
                onChange={field.onChange}
              />
            </FormControl>
          )}
          {widget.type === "number" && (
            <FormControl>
              <Input
                type="number"
                disabled={disabled}
                placeholder={disabled ? "—" : widget.placeholder}
                value={(field.value as string) ?? ""}
                onChange={field.onChange}
              />
            </FormControl>
          )}
          {widget.type === "date" && (
            <FormControl>
              <Input
                type={widget.props?.mode === "datetime" ? "datetime-local" : "date"}
                disabled={disabled}
                value={(field.value as string) ?? ""}
                onChange={field.onChange}
              />
            </FormControl>
          )}
          {(widget.type === "select" || widget.type === "user") &&
            (widget.type === "user" && options.length === 0 ? (
              <FormControl>
                <Input
                  disabled={disabled}
                  placeholder={disabled ? "—" : (widget.placeholder ?? "请输入姓名")}
                  value={(field.value as string) ?? ""}
                  onChange={field.onChange}
                />
              </FormControl>
            ) : (
              <Select
                disabled={disabled}
                value={(field.value as string) || undefined}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={disabled ? "—" : widget.placeholder} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          {widget.type === "radio" && (
            <FormControl>
              <RadioGroup
                disabled={disabled}
                value={(field.value as string) ?? ""}
                onValueChange={field.onChange}
                className="flex flex-wrap gap-4 pt-1"
              >
                {options.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex items-center gap-1.5 text-sm",
                      disabled ? "text-muted-foreground" : "cursor-pointer",
                    )}
                  >
                    <RadioGroupItem value={option.value} />
                    {option.label}
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
          )}
          {widget.type === "checkbox" && (
            <div className="flex flex-wrap gap-4 pt-1">
              {options.map((option) => {
                const list = (field.value as string[]) ?? []
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex items-center gap-1.5 text-sm",
                      disabled ? "text-muted-foreground" : "cursor-pointer",
                    )}
                  >
                    <Checkbox
                      disabled={disabled}
                      checked={list.includes(option.value)}
                      onCheckedChange={(next) =>
                        field.onChange(
                          next ? [...list, option.value] : list.filter((v) => v !== option.value),
                        )
                      }
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
          )}
          {widget.type === "rating" && (
            <div className="flex gap-1 pt-1">
              {Array.from({ length: typeof widget.props?.max === "number" ? widget.props.max : 5 }).map(
                (_, i) => {
                  const star = i + 1
                  return (
                    <button
                      key={star}
                      type="button"
                      disabled={disabled}
                      onClick={() => field.onChange(star === field.value ? 0 : star)}
                    >
                      <Star
                        className={cn(
                          "size-5",
                          !disabled && "transition-transform hover:scale-110",
                          star <= ((field.value as number) || 0)
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30",
                        )}
                      />
                    </button>
                  )
                },
              )}
            </div>
          )}
          {widget.type === "switch" && (
            <FormControl>
              <Switch
                disabled={disabled}
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          )}
          {widget.description && <FormDescription>{widget.description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/* ================= 子表单 / 明细表 ================= */

function SubformField({ widget }: { widget: FormWidget }) {
  const engine = useEngine()
  const { form, data, overrides, perms, readOnly } = engine
  const key = keyOf(widget)
  const ov = overrides[key]
  const visible = resolveVisible(widget, data, ov, perms, readOnly)
  const disabled = resolveDisabled(widget, ov, perms, readOnly)
  const cols = widget.children ?? []
  const mode = widget.props?.mode === "card" ? "card" : "table"

  const { fields, append, remove } = useFieldArray({ control: form.control, name: key as never })

  const emptyRow = () => {
    const row: Record<string, unknown> = {}
    for (const c of cols) row[keyOf(c)] = widgetDefault(c)
    return row
  }

  if (!visible) return null

  const errors = form.formState.errors as Record<string, unknown>
  const rowError = (idx: number, ck: string): string | undefined => {
    const arr = errors[key] as unknown
    const cell = Array.isArray(arr) ? (arr[idx] as Record<string, { message?: string }>)?.[ck] : undefined
    return cell?.message
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FormLabel required={!disabled && Boolean(widget.required)}>{widget.label}</FormLabel>
        {!disabled && (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => append(emptyRow())}>
            <Plus className="size-3.5" /> 添加一行
          </Button>
        )}
      </div>
      {widget.description && <p className="text-xs text-muted-foreground">{widget.description}</p>}

      {fields.length === 0 ? (
        <div className="flex h-16 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          暂无明细，点击「添加一行」
        </div>
      ) : mode === "table" ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => (
                  <TableHead key={c.id} className="whitespace-nowrap">
                    {c.required && <span className="text-destructive">*</span>}
                    {c.label}
                  </TableHead>
                ))}
                {!disabled && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f, idx) => (
                <TableRow key={f.id}>
                  {cols.map((c) => (
                    <TableCell key={c.id} className="align-top">
                      <SubformCell subKey={key} index={idx} col={c} disabled={disabled} error={rowError(idx, keyOf(c))} />
                    </TableCell>
                  ))}
                  {!disabled && (
                    <TableCell className="align-top">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:text-rose-500"
                        onClick={() => remove(idx)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((f, idx) => (
            <div key={f.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">第 {idx + 1} 项</span>
                {!disabled && (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-rose-500"
                    onClick={() => remove(idx)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {cols.map((c) => (
                  <div key={c.id} className="space-y-1.5">
                    <Label className="text-xs">
                      {c.required && <span className="text-destructive">*</span>}
                      {c.label}
                    </Label>
                    <SubformCell subKey={key} index={idx} col={c} disabled={disabled} error={rowError(idx, keyOf(c))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SubformCell({
  subKey,
  index,
  col,
  disabled,
  error,
}: {
  subKey: string
  index: number
  col: FormWidget
  disabled: boolean
  error?: string
}) {
  const { control } = useFormContext<WfFormData>()
  const name = `${subKey}.${index}.${keyOf(col)}`
  const options = useWidgetOptions(col)
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <div className="space-y-1">
          {col.type === "select" ? (
            <Select disabled={disabled} value={(field.value as string) || undefined} onValueChange={field.onChange}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder={col.placeholder ?? "请选择"} />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : col.type === "number" ? (
            <Input
              type="number"
              disabled={disabled}
              className="h-8 text-xs"
              placeholder={col.placeholder}
              value={(field.value as string) ?? ""}
              onChange={field.onChange}
            />
          ) : col.type === "date" ? (
            <Input
              type="date"
              disabled={disabled}
              className="h-8 text-xs"
              value={(field.value as string) ?? ""}
              onChange={field.onChange}
            />
          ) : (
            <Input
              disabled={disabled}
              className="h-8 text-xs"
              placeholder={col.placeholder}
              value={(field.value as string) ?? ""}
              onChange={field.onChange}
            />
          )}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    />
  )
}

/* ================= 第二波数据控件 ================= */

interface RField {
  value: unknown
  onChange: (v: unknown) => void
  onBlur: () => void
}

/** 复杂控件统一外壳：可见/只读/必填判定 + 标签/描述/错误消息 */
function ComplexFieldShell({
  widget,
  children,
}: {
  widget: FormWidget
  children: (args: { field: RField; disabled: boolean }) => ReactNode
}) {
  const engine = useEngine()
  const { form, data, overrides, perms, readOnly } = engine
  const key = keyOf(widget)
  const ov = overrides[key]
  const visible = resolveVisible(widget, data, ov, perms, readOnly)
  const disabled = resolveDisabled(widget, ov, perms, readOnly)
  const required = resolveRequired(widget, data, ov)
  if (!visible) return null
  return (
    <FormField
      control={form.control}
      name={key}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={!disabled && required}>{widget.label}</FormLabel>
          {children({ field: field as unknown as RField, disabled })}
          {widget.description && <FormDescription>{widget.description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

const ReadOnlyBox = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-9 items-center rounded-md border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground">
    {children}
  </div>
)

/* ---- user：组织选择器（存 OrgRef[]，兼容旧字符串） ---- */

function UserField({ widget }: { widget: FormWidget }) {
  const [open, setOpen] = useState(false)
  const multiple = widget.props?.multiple === true
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => {
        const raw = field.value
        const refs: OrgRef[] = Array.isArray(raw) ? (raw as OrgRef[]) : []
        const legacy = typeof raw === "string" ? raw.trim() : ""
        if (disabled) {
          return (
            <ReadOnlyBox>
              {refs.length > 0 ? refs.map((r) => r.name).join("、") : legacy || "—"}
            </ReadOnlyBox>
          )
        }
        return (
          <FormControl>
            <div>
              <OrgPickerField
                value={refs}
                multiple={multiple}
                placeholder={legacy || widget.placeholder || "点击选择成员 / 部门 / 角色"}
                onOpen={() => setOpen(true)}
                onRemove={(r) => field.onChange(refs.filter((x) => !(x.type === r.type && x.id === r.id)))}
              />
              <OrgPicker
                open={open}
                onOpenChange={setOpen}
                multiple={multiple}
                value={refs}
                onConfirm={(next) => field.onChange(multiple ? next : next.slice(0, 1))}
              />
            </div>
          </FormControl>
        )
      }}
    </ComplexFieldShell>
  )
}

/* ---- upload / image：文件上传（存 {id,name} 列表） ---- */

interface StoredFile {
  id: number
  name: string
}

function UploadField({ widget }: { widget: FormWidget }) {
  const isImage = widget.type === "image"
  const multiple = widget.props?.multiple !== false && !isImage ? true : widget.props?.multiple === true
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => {
        const list: StoredFile[] = Array.isArray(field.value) ? (field.value as StoredFile[]) : []
        const add = (f: UploadedFile) => {
          const next = [...list, { id: f.id, name: f.originalName }]
          field.onChange(multiple ? next : next.slice(-1))
        }
        const removeAt = (id: number) => field.onChange(list.filter((x) => x.id !== id))
        if (disabled) {
          return list.length === 0 ? (
            <ReadOnlyBox>—</ReadOnlyBox>
          ) : (
            <div className="flex flex-wrap gap-2">
              {list.map((f) => (
                <a
                  key={f.id}
                  href={`/api/infra/files/${f.id}/download`}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:border-primary/40"
                >
                  {isImage ? <FileImage className="size-3.5" /> : <Paperclip className="size-3.5" />}
                  {f.name}
                </a>
              ))}
            </div>
          )
        }
        return (
          <div className="space-y-2">
            <FileUploader
              multiple={multiple}
              accept={isImage ? "image/*" : undefined}
              onUploaded={add}
            />
            {list.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {list.map((f) =>
                  isImage ? (
                    <div key={f.id} className="group relative size-20 overflow-hidden rounded-md border">
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted/50 text-muted-foreground">
                        <FileImage className="size-6" />
                      </div>
                      <AuthImg
                        src={`/api/infra/files/${f.id}/download`}
                        alt={f.name}
                        className="relative size-full object-cover"
                        fallback={<span className="size-full" />}
                      />
                      <button
                        type="button"
                        onClick={() => removeAt(f.id)}
                        className="absolute right-0.5 top-0.5 z-10 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-rose-500"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <Badge key={f.id} variant="secondary" className="gap-1 pr-1 font-normal">
                      <Paperclip className="size-3" />
                      {f.name}
                      <button
                        type="button"
                        onClick={() => removeAt(f.id)}
                        className="rounded-full p-0.5 hover:bg-foreground/10"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ),
                )}
              </div>
            )}
          </div>
        )
      }}
    </ComplexFieldShell>
  )
}

/* ---- richtext：轻量富文本（contentEditable + 工具栏，存 HTML） ---- */

function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const exec = (cmd: string) => {
    document.execCommand(cmd, false)
    if (ref.current) onChange(ref.current.innerHTML)
    ref.current?.focus()
  }
  const tools: { cmd: string; icon: typeof Bold; title: string }[] = [
    { cmd: "bold", icon: Bold, title: "加粗" },
    { cmd: "italic", icon: Italic, title: "斜体" },
    { cmd: "underline", icon: Underline, title: "下划线" },
    { cmd: "insertUnorderedList", icon: List, title: "列表" },
  ]
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-0.5 border-b bg-muted/30 px-1 py-1">
        {tools.map((t) => (
          <button
            key={t.cmd}
            type="button"
            title={t.title}
            onMouseDown={(e) => {
              e.preventDefault()
              exec(t.cmd)
            }}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <t.icon className="size-3.5" />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        className="min-h-24 px-3 py-2 text-sm outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  )
}

function RichTextField({ widget }: { widget: FormWidget }) {
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => {
        const html = typeof field.value === "string" ? field.value : ""
        if (disabled) {
          return (
            <div
              className="rounded-md border bg-muted/30 px-3 py-2 text-sm [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: html ? sanitizeHtml(html) : "—" }}
            />
          )
        }
        return (
          <RichTextEditor value={html} onChange={field.onChange} placeholder={widget.placeholder || "请输入内容…"} />
        )
      }}
    </ComplexFieldShell>
  )
}

/* ---- amount：金额（千分位 + 中文大写） ---- */

function AmountField({ widget }: { widget: FormWidget }) {
  const prefix = typeof widget.props?.prefix === "string" ? widget.props.prefix : "￥"
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => {
        const val = (field.value as string) ?? ""
        return (
          <div className="space-y-1">
            {disabled ? (
              <ReadOnlyBox>{val === "" ? "—" : `${prefix}${formatThousands(val)}`}</ReadOnlyBox>
            ) : (
              <FormControl>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {prefix}
                  </span>
                  <Input
                    type="number"
                    className="pl-7"
                    placeholder={widget.placeholder || "请输入金额"}
                    value={val}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                </div>
              </FormControl>
            )}
            {val !== "" && (
              <p className="text-xs text-muted-foreground">
                {prefix}
                {formatThousands(val)} · {toChineseAmount(val)}
              </p>
            )}
          </div>
        )
      }}
    </ComplexFieldShell>
  )
}

/* ---- 级联选择（address / cascade 共用） ---- */

type PathItem = { value: string; label: string }

function CascadeSelect({
  tree,
  value,
  disabled,
  onChange,
  placeholders,
}: {
  tree: CascadeNode[]
  value: PathItem[]
  disabled: boolean
  onChange: (path: PathItem[]) => void
  placeholders?: string[]
}) {
  const lists: CascadeNode[][] = []
  let nodes: CascadeNode[] = tree
  for (let i = 0; ; i++) {
    lists.push(nodes)
    const sel = value[i]
    if (!sel) break
    const found = nodes.find((n) => n.value === sel.value)
    if (!found?.children || found.children.length === 0) break
    nodes = found.children
  }
  if (disabled) {
    return <ReadOnlyBox>{value.length > 0 ? value.map((p) => p.label).join(" / ") : "—"}</ReadOnlyBox>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {lists.map((options, level) => (
        <Select
          key={level}
          value={value[level]?.value || undefined}
          onValueChange={(v) => {
            const node = options.find((o) => o.value === v)
            if (!node) return
            onChange([...value.slice(0, level), { value: node.value, label: node.label }])
          }}
        >
          <SelectTrigger className="h-9 min-w-32 flex-1">
            <SelectValue placeholder={placeholders?.[level] ?? "请选择"} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  )
}

function AddressField({ widget }: { widget: FormWidget }) {
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => (
        <FormControl>
          <CascadeSelect
            tree={CN_REGIONS as unknown as CascadeNode[]}
            value={Array.isArray(field.value) ? (field.value as PathItem[]) : []}
            disabled={disabled}
            onChange={field.onChange}
            placeholders={["省", "市", "区/县"]}
          />
        </FormControl>
      )}
    </ComplexFieldShell>
  )
}

function CascadeField({ widget }: { widget: FormWidget }) {
  const ds = widget.dataSource
  const tree: CascadeNode[] =
    ds?.type === "cascade" && ds.preset === "region"
      ? (CN_REGIONS as unknown as CascadeNode[])
      : ds?.type === "cascade" && Array.isArray(ds.tree)
        ? ds.tree
        : Array.isArray(widget.props?.tree)
          ? (widget.props.tree as CascadeNode[])
          : (CN_REGIONS as unknown as CascadeNode[])
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => (
        <FormControl>
          <CascadeSelect
            tree={tree}
            value={Array.isArray(field.value) ? (field.value as PathItem[]) : []}
            disabled={disabled}
            onChange={field.onChange}
          />
        </FormControl>
      )}
    </ComplexFieldShell>
  )
}

/* ---- relation：关联表单记录（record-picker，存 {value,label}） ---- */

/** 关联记录：后端 GET /api/wf/form-defs/{defCode}/records 返回项 */
interface FormRecord extends Record<string, unknown> {
  id: number
  procInstId: string
  title: string
  /** 展示名称（实例标题或首个文本字段） */
  label: string
  /** 存储唯一值（procInstId） */
  value: string
  /** 表单标量摘要 */
  summary: string
}

/**
 * 拉取关联表单记录：调后端真实端点（该表单已提交的流程实例）。
 * 端点失败/无绑定流程时优雅空态（返回空数组，不再降级演示数据）。
 */
function useRelationRecords(defCode: string | undefined): FormRecord[] {
  const [records, setRecords] = useState<FormRecord[]>([])
  useEffect(() => {
    let alive = true
    if (!defCode) {
      setRecords([])
      return
    }
    void (async () => {
      try {
        const page = await api<PageResultLite<FormRecord>>(
          `/api/wf/form-defs/${encodeURIComponent(defCode)}/records?pageNum=1&pageSize=100`,
        )
        if (alive) setRecords(Array.isArray(page?.list) ? page.list : [])
      } catch {
        if (alive) setRecords([])
      }
    })()
    return () => {
      alive = false
    }
  }, [defCode])
  return records
}

interface PageResultLite<T> {
  list: T[]
  total: number
}

const RELATION_COLUMNS = [
  { key: "label" as const, title: "名称" },
  { key: "summary" as const, title: "摘要" },
]

function RelationField({ widget }: { widget: FormWidget }) {
  const [open, setOpen] = useState(false)
  const ds = widget.dataSource
  const defCode = ds?.type === "form" ? ds.defCode : undefined
  const multiple = widget.props?.multiple === true
  const records = useRelationRecords(defCode)

  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => {
        const picks: PathItem[] = Array.isArray(field.value) ? (field.value as PathItem[]) : []
        const labels = picks.map((p) => ({ id: p.value, label: p.label }))
        if (disabled) {
          return <ReadOnlyBox>{picks.length > 0 ? picks.map((p) => p.label).join("、") : "—"}</ReadOnlyBox>
        }
        return (
          <FormControl>
            <div>
              <RecordPickerField
                labels={labels}
                multiple={multiple}
                placeholder={widget.placeholder || "点击选择关联记录"}
                onOpen={() => setOpen(true)}
                onRemove={(id) => field.onChange(picks.filter((p) => p.value !== id))}
              />
              <RecordPicker<FormRecord>
                open={open}
                onOpenChange={setOpen}
                title={`选择${widget.label}`}
                data={records}
                columns={RELATION_COLUMNS}
                idField="value"
                labelField="label"
                searchKeys={["label", "summary"]}
                multiple={multiple}
                value={picks.map((p) => p.value)}
                onConfirm={(_ids, rows) =>
                  field.onChange(rows.map((r) => ({ value: String(r.value), label: String(r.label) })))
                }
              />
            </div>
          </FormControl>
        )
      }}
    </ComplexFieldShell>
  )
}

/* ---- signature：手写签名（canvas → dataURL） ---- */

function SignaturePad({
  value,
  onChange,
}: {
  value: string
  onChange: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.strokeStyle = "#0f172a"
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawing.current = true
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"))
  }
  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    onChange("")
  }

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        width={360}
        height={140}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full max-w-sm touch-none rounded-md border bg-muted/20"
      />
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={clear}>
        <Eraser className="size-3.5" /> 清除
      </Button>
    </div>
  )
}

function SignatureField({ widget }: { widget: FormWidget }) {
  return (
    <ComplexFieldShell widget={widget}>
      {({ field, disabled }) => {
        const url = typeof field.value === "string" ? field.value : ""
        if (disabled) {
          return url ? (
            <img src={url} alt="签名" className="max-w-sm rounded-md border bg-white" />
          ) : (
            <ReadOnlyBox>未签名</ReadOnlyBox>
          )
        }
        return (
          <FormControl>
            <SignaturePad value={url} onChange={field.onChange} />
          </FormControl>
        )
      }}
    </ComplexFieldShell>
  )
}

/** 第二波复杂控件分发 */
const COMPLEX_TYPES = new Set([
  "user",
  "upload",
  "image",
  "richtext",
  "amount",
  "address",
  "cascade",
  "relation",
  "signature",
])

function ComplexField({ widget }: { widget: FormWidget }) {
  switch (widget.type) {
    case "user":
      return <UserField widget={widget} />
    case "upload":
    case "image":
      return <UploadField widget={widget} />
    case "richtext":
      return <RichTextField widget={widget} />
    case "amount":
      return <AmountField widget={widget} />
    case "address":
      return <AddressField widget={widget} />
    case "cascade":
      return <CascadeField widget={widget} />
    case "relation":
      return <RelationField widget={widget} />
    case "signature":
      return <SignatureField widget={widget} />
    default:
      return null
  }
}

/* ================= 容器与递归节点 ================= */

/** 顶层/容器内布局：把控件按宽度铺进 grid（默认 2 列）。用内联 style 避免 Tailwind 动态类失效 */
function widgetSpanStyle(widget: FormWidget, columns: number): { gridColumn: string } {
  const w = widget.width
  if (isSubform(widget.type) || isContainer(widget.type) || isLayout(widget.type)) {
    return { gridColumn: "1 / -1" }
  }
  if (w && typeof w === "object" && "span" in w) {
    const cols = Math.max(1, Math.min(columns, Math.round((w.span / 24) * columns)))
    return { gridColumn: `span ${cols} / span ${cols}` }
  }
  if (w === "half") return { gridColumn: "span 1 / span 1" }
  return { gridColumn: "1 / -1" }
}

function ContainerNode({ widget }: { widget: FormWidget }) {
  const engine = useEngine()
  const visible = resolveVisible(widget, engine.data, engine.overrides[keyOf(widget)], engine.perms, engine.readOnly)
  if (!visible) return null
  const children = widget.children ?? []
  const props = widget.props ?? {}

  if (widget.type === "grid") {
    const columns = typeof props.columns === "number" && props.columns > 0 ? props.columns : 2
    return (
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {children.map((c, i) => (
          <WidgetNode key={nodeKey(c, i)} widget={c} columns={columns} />
        ))}
      </div>
    )
  }

  if (widget.type === "group") {
    const title = typeof props.title === "string" ? props.title : widget.label
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <NodeGrid widgets={children} />
        </CardContent>
      </Card>
    )
  }

  if (widget.type === "tabs") {
    const tabs = Array.isArray(props.tabs)
      ? (props.tabs as { key: string; label: string }[])
      : [{ key: "tab1", label: "标签一" }]
    return (
      <Tabs defaultValue={tabs[0]?.key}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="pt-3">
            <NodeGrid widgets={children.filter((c) => (c.props?.tab ?? tabs[0]?.key) === t.key)} />
          </TabsContent>
        ))}
      </Tabs>
    )
  }

  if (widget.type === "collapse") {
    const panels = Array.isArray(props.panels)
      ? (props.panels as { key: string; title: string; defaultOpen?: boolean }[])
      : [{ key: "p1", title: "面板一", defaultOpen: true }]
    return (
      <div className="space-y-2">
        {panels.map((p) => (
          <Collapsible key={p.key} defaultOpen={p.defaultOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
              {p.title}
            </CollapsibleTrigger>
            <CollapsibleContent className="px-1 pt-3">
              <NodeGrid widgets={children.filter((c) => (c.props?.panel ?? panels[0]?.key) === p.key)} />
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    )
  }

  return null
}

/** 列表渲染稳定 key：兼容仅含 key（无 id）的旧 schema */
const nodeKey = (w: FormWidget, i: number) => w.id || w.key || `n${i}`

/** 一组控件的 2 列栅格布局 */
function NodeGrid({ widgets }: { widgets: FormWidget[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      {widgets.map((w, i) => (
        <WidgetNode key={nodeKey(w, i)} widget={w} columns={2} />
      ))}
    </div>
  )
}

/** 递归节点分发 */
function WidgetNode({ widget, columns = 2 }: { widget: FormWidget; columns?: number }) {
  const style = widgetSpanStyle(widget, columns)

  if (widget.type === "divider") {
    return (
      <div className="flex items-center gap-3 py-1" style={style}>
        <Separator className="flex-1" />
        {widget.content && <span className="text-xs text-muted-foreground">{widget.content}</span>}
        <Separator className="flex-1" />
      </div>
    )
  }
  if (widget.type === "note") {
    return (
      <p className="rounded-md bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground" style={style}>
        {widget.content}
      </p>
    )
  }
  if (widget.type === "html") {
    return (
      <div
        className="text-sm [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5"
        style={style}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(widget.content) }}
      />
    )
  }
  if (isContainer(widget.type)) {
    return (
      <div style={style}>
        <ContainerNode widget={widget} />
      </div>
    )
  }
  if (isSubform(widget.type)) {
    return (
      <div style={style}>
        <SubformField widget={widget} />
      </div>
    )
  }
  if (COMPLEX_TYPES.has(widget.type)) {
    return (
      <div style={style}>
        <ComplexField widget={widget} />
      </div>
    )
  }
  return (
    <div style={style}>
      <LeafField widget={widget} />
    </div>
  )
}

/* ================= 主组件 ================= */

export interface FormRendererProps {
  widgets: FormWidget[]
  initialValues?: WfFormData
  perms?: FormPerms
  readOnly?: boolean
  submitting?: boolean
  submitLabel?: ReactNode
  cancelLabel?: ReactNode
  onSubmit?: (data: WfFormData) => void | Promise<void>
  onCancel?: () => void
  onSaveDraft?: (data: WfFormData) => void | Promise<void>
  savingDraft?: boolean
  saveDraftLabel?: ReactNode
  className?: string
  /** 表单级事件脚本（v2；发起中心等旧调用方可不传） */
  formEvents?: FormEvents
  /** 表单变量（脚本可读写） */
  variables?: Record<string, unknown>
}

export function FormRenderer({
  widgets,
  initialValues,
  perms,
  readOnly,
  submitting,
  submitLabel = "提交",
  cancelLabel = "取消",
  onSubmit,
  onCancel,
  onSaveDraft,
  savingDraft,
  saveDraftLabel = "暂存",
  className,
  formEvents,
  variables,
}: FormRendererProps) {
  const overridesRef = useRef<OverrideMap>({})
  const [overrides, setOverridesState] = useState<OverrideMap>({})
  const variablesRef = useRef<Record<string, unknown>>({ ...(variables ?? {}) })

  const schema = useMemo(
    () => buildSchema(widgets, perms, readOnly, overridesRef),
    [widgets, perms, readOnly],
  )
  const form = useForm<WfFormData>({
    resolver: zodResolver(schema) as Resolver<WfFormData>,
    defaultValues: defaultValuesOf(widgets, initialValues),
  })

  const setOverride = (key: string, patch: Override) => {
    overridesRef.current = {
      ...overridesRef.current,
      [key]: { ...overridesRef.current[key], ...patch },
    }
    setOverridesState(overridesRef.current)
  }

  // 脚本上下文构造（每次调用读最新值）
  const runningRef = useRef(false)
  const makeCtx = (field?: { key: string; value: unknown }): ScriptCtx => ({
    data: form.getValues(),
    get: (k) => form.getValues(k as never),
    set: (k, v) => form.setValue(k as never, v as never, { shouldValidate: false }),
    setValue: (k, v) => form.setValue(k as never, v as never, { shouldValidate: false }),
    setVisible: (k, v) => setOverride(k, { visible: v }),
    setRequired: (k, v) => setOverride(k, { required: v }),
    setReadonly: (k, v) => setOverride(k, { readonly: v }),
    setOptions: (k, opts) =>
      setOverride(k, {
        options: opts.map((o) => (typeof o === "string" ? { label: o, value: o } : o)),
      }),
    field,
    variables: variablesRef.current,
    utils: scriptUtils,
  })

  const runScriptGuarded = (source: string | undefined, field?: { key: string; value: unknown }) => {
    if (!source) return
    runningRef.current = true
    try {
      runScript(source, makeCtx(field))
    } finally {
      runningRef.current = false
    }
  }

  // onLoad：进入时执行一次
  useEffect(() => {
    if (formEvents?.onLoad) runScriptGuarded(formEvents.onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 字段变化订阅：字段级 onChange + 表单级 onChange
  const leafByKey = useMemo(() => {
    const map = new Map<string, FormWidget>()
    for (const w of collectDataWidgets(widgets)) map.set(keyOf(w), w)
    return map
  }, [widgets])

  useEffect(() => {
    const sub = form.watch((values, info) => {
      if (runningRef.current) return
      const name = info.name
      if (name) {
        const topKey = name.split(".")[0]
        const w = leafByKey.get(topKey)
        if (w?.events?.onChange) {
          runScriptGuarded(w.events.onChange, { key: topKey, value: (values as WfFormData)[topKey] })
        }
      }
      if (formEvents?.onChange) runScriptGuarded(formEvents.onChange, name ? { key: name, value: undefined } : undefined)
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, leafByKey, formEvents?.onChange])

  const data = form.watch()

  const dataWidgets = collectDataWidgets(widgets)
  const visibleData = dataWidgets.filter((w) =>
    resolveVisible(w, data, overrides[keyOf(w)], perms, readOnly),
  )
  const hasFields = visibleData.length > 0

  const submit = form.handleSubmit(async (values) => {
    if (formEvents?.onSubmit) {
      runningRef.current = true
      let blocked = false
      try {
        const result = runScript(formEvents.onSubmit, makeCtx())
        blocked = result === false
      } finally {
        runningRef.current = false
      }
      if (blocked) return
    }
    await onSubmit?.(toFormData(widgets, values, perms, readOnly, overridesRef.current))
  })

  if (!hasFields) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        该表单暂无可填写的字段
      </div>
    )
  }

  const ctxValue: EngineContextValue = { form, perms, readOnly, data, overrides, setOverride }

  return (
    <EngineContext.Provider value={ctxValue}>
      <Form {...form}>
        <form onSubmit={(e) => void submit(e)} className={cn("grid grid-cols-2 gap-x-4 gap-y-4", className)}>
          {widgets.map((widget, i) => (
            <WidgetNode key={nodeKey(widget, i)} widget={widget} columns={2} />
          ))}

          {!readOnly && (
            <div className="col-span-2 flex justify-end gap-2 pt-1">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting || savingDraft}>
                  {cancelLabel}
                </Button>
              )}
              {onSaveDraft && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={submitting || savingDraft}
                  onClick={() =>
                    void onSaveDraft(toFormData(widgets, form.getValues(), perms, readOnly, overridesRef.current))
                  }
                >
                  {savingDraft ? "暂存中…" : saveDraftLabel}
                </Button>
              )}
              <Button type="submit" disabled={submitting || savingDraft}>
                {submitting ? "提交中…" : submitLabel}
              </Button>
            </div>
          )}
        </form>
      </Form>
    </EngineContext.Provider>
  )
}
