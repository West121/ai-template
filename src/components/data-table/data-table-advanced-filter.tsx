import { ChevronDown, ListFilter, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/* ---------------- 数据模型 ---------------- */

export type FilterFieldType = "text" | "number" | "select" | "date"

export interface FilterField {
  id: string
  title: string
  type: FilterFieldType
  options?: string[]
}

export interface FilterCondition {
  kind: "condition"
  id: string
  field: string
  operator: string
  value: string
}

export interface FilterGroup {
  kind: "group"
  id: string
  logic: "and" | "or"
  items: FilterItem[]
}

export type FilterItem = FilterCondition | FilterGroup

/** 根节点：一个顶层条件组 */
export type FilterRoot = FilterGroup

export function emptyFilterRoot(): FilterRoot {
  return { kind: "group", id: "root", logic: "and", items: [] }
}

const OPERATORS: Record<FilterFieldType, Array<{ value: string; label: string }>> = {
  text: [
    { value: "contains", label: "包含" },
    { value: "notContains", label: "不包含" },
    { value: "eq", label: "等于" },
    { value: "neq", label: "不等于" },
    { value: "empty", label: "为空" },
    { value: "notEmpty", label: "不为空" },
  ],
  number: [
    { value: "eq", label: "等于" },
    { value: "neq", label: "不等于" },
    { value: "gt", label: "大于" },
    { value: "gte", label: "大于等于" },
    { value: "lt", label: "小于" },
    { value: "lte", label: "小于等于" },
  ],
  select: [
    { value: "eq", label: "等于" },
    { value: "neq", label: "不等于" },
    { value: "empty", label: "为空" },
    { value: "notEmpty", label: "不为空" },
  ],
  date: [
    { value: "eq", label: "等于" },
    { value: "before", label: "早于" },
    { value: "after", label: "晚于" },
  ],
}

const NO_VALUE_OPERATORS = new Set(["empty", "notEmpty"])

/* ---------------- 过滤求值 ---------------- */

function evalCondition<TData>(row: TData, condition: FilterCondition, fields: FilterField[]): boolean {
  const field = fields.find((f) => f.id === condition.field)
  if (!field) return true
  const raw = (row as Record<string, unknown>)[condition.field]
  const text = raw == null ? "" : String(raw)

  switch (condition.operator) {
    case "empty":
      return text === ""
    case "notEmpty":
      return text !== ""
  }
  // 需要值的操作符：值为空时视为未完成条件，不参与过滤
  if (condition.value === "") return true

  if (field.type === "number") {
    const a = Number(text)
    const b = Number(condition.value)
    if (Number.isNaN(a) || Number.isNaN(b)) return true
    switch (condition.operator) {
      case "eq": return a === b
      case "neq": return a !== b
      case "gt": return a > b
      case "gte": return a >= b
      case "lt": return a < b
      case "lte": return a <= b
      default: return true
    }
  }
  if (field.type === "date") {
    switch (condition.operator) {
      case "eq": return text === condition.value
      case "before": return text < condition.value
      case "after": return text > condition.value
      default: return true
    }
  }
  switch (condition.operator) {
    case "contains": return text.toLowerCase().includes(condition.value.toLowerCase())
    case "notContains": return !text.toLowerCase().includes(condition.value.toLowerCase())
    case "eq": return text === condition.value
    case "neq": return text !== condition.value
    default: return true
  }
}

export function evalFilterGroup<TData>(row: TData, group: FilterGroup, fields: FilterField[]): boolean {
  if (group.items.length === 0) return true
  const results = group.items.map((item) =>
    item.kind === "condition" ? evalCondition(row, item, fields) : evalFilterGroup(row, item, fields),
  )
  return group.logic === "and" ? results.every(Boolean) : results.some(Boolean)
}

/** 统计有效条件数（徽标显示用） */
export function countConditions(group: FilterGroup): number {
  return group.items.reduce(
    (sum, item) => sum + (item.kind === "condition" ? 1 : countConditions(item)),
    0,
  )
}

/* ---------------- UI ---------------- */

let uid = 0
const nextId = () => `f${++uid}`

function newCondition(fields: FilterField[]): FilterCondition {
  const field = fields[0]
  return {
    kind: "condition",
    id: nextId(),
    field: field.id,
    operator: OPERATORS[field.type][0].value,
    value: "",
  }
}

function LogicSelect({
  value,
  onChange,
}: {
  value: "and" | "or"
  onChange: (logic: "and" | "or") => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-foreground/80 hover:text-foreground"
        >
          {value === "and" ? "满足所有条件" : "满足任一条件"}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem className={cn("text-xs", value === "and" && "bg-accent")} onClick={() => onChange("and")}>
          满足所有条件
        </DropdownMenuItem>
        <DropdownMenuItem className={cn("text-xs", value === "or" && "bg-accent")} onClick={() => onChange("or")}>
          满足任一条件
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConditionRow({
  condition,
  fields,
  onChange,
  onRemove,
}: {
  condition: FilterCondition
  fields: FilterField[]
  onChange: (next: FilterCondition) => void
  onRemove: () => void
}) {
  const field = fields.find((f) => f.id === condition.field) ?? fields[0]
  const operators = OPERATORS[field.type]
  const needsValue = !NO_VALUE_OPERATORS.has(condition.operator)

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={condition.field}
        onValueChange={(fieldId) => {
          const next = fields.find((f) => f.id === fieldId) ?? field
          onChange({ ...condition, field: fieldId, operator: OPERATORS[next.type][0].value, value: "" })
        }}
      >
        <SelectTrigger size="sm" className="h-8 w-32 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.id} value={f.id} className="text-xs">
              {f.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={condition.operator} onValueChange={(operator) => onChange({ ...condition, operator })}>
        <SelectTrigger size="sm" className="h-8 w-24 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value} className="text-xs">
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsValue ? (
        field.type === "select" ? (
          <Select value={condition.value || undefined} onValueChange={(value) => onChange({ ...condition, value })}>
            <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs">
              <SelectValue placeholder="选择值" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((option) => (
                <SelectItem key={option} value={option} className="text-xs">
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder={field.type === "date" ? "选择日期" : "输入值"}
            className="h-8 min-w-0 flex-1 text-xs"
          />
        )
      ) : (
        <div className="h-8 min-w-0 flex-1 rounded-md border border-dashed bg-muted/30" />
      )}

      <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

function GroupBox({
  group,
  fields,
  onChange,
  onRemove,
}: {
  group: FilterGroup
  fields: FilterField[]
  onChange: (next: FilterGroup) => void
  onRemove: () => void
}) {
  const updateItem = (index: number, item: FilterItem) =>
    onChange({ ...group, items: group.items.map((it, i) => (i === index ? item : it)) })
  const removeItem = (index: number) =>
    onChange({ ...group, items: group.items.filter((_, i) => i !== index) })

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <LogicSelect value={group.logic} onChange={(logic) => onChange({ ...group, logic })} />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => onChange({ ...group, items: [...group.items, newCondition(fields)] })}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {group.items.map((item, index) =>
        item.kind === "condition" ? (
          <ConditionRow
            key={item.id}
            condition={item}
            fields={fields}
            onChange={(next) => updateItem(index, next)}
            onRemove={() => removeItem(index)}
          />
        ) : null,
      )}
      {group.items.length === 0 && (
        <div className="rounded-md border border-dashed py-2 text-center text-xs text-muted-foreground">
          点击右上角 + 添加条件
        </div>
      )}
    </div>
  )
}

interface DataTableAdvancedFilterProps {
  fields: FilterField[]
  root: FilterRoot
  onChange: (root: FilterRoot) => void
}

/** Notion 风格条件构建器：条件 / 条件组 / 与或逻辑 */
export function DataTableAdvancedFilter({ fields, root, onChange }: DataTableAdvancedFilterProps) {
  if (fields.length === 0) return null
  const count = countConditions(root)

  const updateItem = (index: number, item: FilterItem) =>
    onChange({ ...root, items: root.items.map((it, i) => (i === index ? item : it)) })
  const removeItem = (index: number) =>
    onChange({ ...root, items: root.items.filter((_, i) => i !== index) })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? "secondary" : "ghost"}
          size="sm"
          className="h-8 gap-1.5 text-xs"
        >
          <ListFilter className="size-3.5" />
          筛选
          {count > 0 && (
            <Badge className="h-4 min-w-4 rounded-full px-1 text-[10px]">{count}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[560px] max-w-[90vw] p-3">
        <div className="space-y-2.5">
          <LogicSelect value={root.logic} onChange={(logic) => onChange({ ...root, logic })} />

          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {root.items.map((item, index) =>
              item.kind === "condition" ? (
                <ConditionRow
                  key={item.id}
                  condition={item}
                  fields={fields}
                  onChange={(next) => updateItem(index, next)}
                  onRemove={() => removeItem(index)}
                />
              ) : (
                <GroupBox
                  key={item.id}
                  group={item}
                  fields={fields}
                  onChange={(next) => updateItem(index, next)}
                  onRemove={() => removeItem(index)}
                />
              ),
            )}
            {root.items.length === 0 && (
              <div className="rounded-md border border-dashed py-5 text-center text-xs text-muted-foreground">
                暂无筛选条件，点击下方按钮添加
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t pt-2.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => onChange({ ...root, items: [...root.items, newCondition(fields)] })}
            >
              <Plus className="size-3.5" />
              添加条件
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() =>
                onChange({
                  ...root,
                  items: [
                    ...root.items,
                    { kind: "group", id: nextId(), logic: "and", items: [newCondition(fields)] },
                  ],
                })
              }
            >
              <Plus className="size-3.5" />
              添加条件组
            </Button>
            {count > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs text-muted-foreground"
                onClick={() => onChange(emptyFilterRoot())}
              >
                清空
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
