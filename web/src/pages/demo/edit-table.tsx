import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import {
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  CircleCheckBig,
  Expand,
  Hash,
  Pencil,
  Plus,
  Star,
  Trash2,
  Type,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Drawer } from "@/components/drawer"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"

/* ================= 数据模型 ================= */

type FieldType = "text" | "number" | "select" | "date" | "checkbox" | "user" | "rating"

interface SelectOption {
  label: string
  color: string
}

interface Field {
  id: string
  name: string
  type: FieldType
  width: number
  options?: SelectOption[]
}

type CellValue = string | number | boolean | null

interface RecordRow {
  id: string
  cells: Record<string, CellValue>
}

const USERS = ["赵天宇", "王小磊", "李思雨", "刘志强", "黄丽娟", "朱国栋", "杨慧敏", "谭凯文"]

const optionColors: Record<string, string> = {
  gray: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  sky: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
}

const fieldTypeMeta: Record<FieldType, { label: string; icon: typeof Type }> = {
  text: { label: "文本", icon: Type },
  number: { label: "数字", icon: Hash },
  select: { label: "单选", icon: CircleCheckBig },
  date: { label: "日期", icon: Calendar },
  checkbox: { label: "复选框", icon: CheckSquare },
  user: { label: "成员", icon: UserRound },
  rating: { label: "评分", icon: Star },
}

let seq = 0
const newId = (prefix: string) => `${prefix}${++seq}`

const initialFields: Field[] = [
  { id: "f_title", name: "需求标题", type: "text", width: 260 },
  {
    id: "f_status",
    name: "状态",
    type: "select",
    width: 116,
    options: [
      { label: "未开始", color: "gray" },
      { label: "进行中", color: "blue" },
      { label: "已完成", color: "emerald" },
      { label: "已阻塞", color: "rose" },
    ],
  },
  {
    id: "f_priority",
    name: "优先级",
    type: "select",
    width: 100,
    options: [
      { label: "紧急", color: "rose" },
      { label: "高", color: "orange" },
      { label: "中", color: "amber" },
      { label: "低", color: "sky" },
    ],
  },
  { id: "f_owner", name: "负责人", type: "user", width: 140 },
  { id: "f_hours", name: "预估工时", type: "number", width: 110 },
  { id: "f_due", name: "截止日期", type: "date", width: 136 },
  { id: "f_confirmed", name: "已确认", type: "checkbox", width: 88 },
  { id: "f_rating", name: "满意度", type: "rating", width: 132 },
]

const seed: Array<[string, string, string, string, number | null, string, boolean, number]> = [
  ["工作台首页改版设计", "进行中", "高", "赵天宇", 16, "2026-07-10", true, 4],
  ["审批流程引擎性能优化", "进行中", "紧急", "刘志强", 40, "2026-07-15", true, 5],
  ["移动端打卡定位偏移修复", "未开始", "紧急", "孙铭轩", 8, "2026-07-08", false, 0],
  ["通讯录组织树懒加载", "已完成", "中", "王小磊", 12, "2026-07-03", true, 5],
  ["公文批注富文本组件调研", "未开始", "中", "李思雨", 24, "2026-07-20", false, 0],
  ["会议室预订冲突检测", "进行中", "中", "王小磊", 16, "2026-07-12", true, 3],
  ["数据大屏指标接入", "已阻塞", "高", "谭凯文", 32, "2026-07-18", false, 2],
  ["内网 SSO 单点登录升级", "进行中", "高", "谭凯文", 24, "2026-07-11", true, 4],
  ["Q3 市场投放素材制作", "进行中", "中", "黄丽娟", 20, "2026-07-14", true, 3],
  ["大客户续约方案评审", "已完成", "紧急", "朱国栋", 8, "2026-07-09", true, 5],
  ["半年度绩效考核启动", "进行中", "高", "杨慧敏", 20, "2026-07-13", false, 0],
  ["差旅费用报销制度修订", "已完成", "中", "杨慧敏", 8, "2026-07-02", true, 4],
]

const initialRecords: RecordRow[] = seed.map((row) => ({
  id: newId("r"),
  cells: {
    f_title: row[0],
    f_status: row[1],
    f_priority: row[2],
    f_owner: row[3],
    f_hours: row[4],
    f_due: row[5],
    f_confirmed: row[6],
    f_rating: row[7],
  },
}))

/* ================= 单元格展示 ================= */

function OptionBadge({ field, value }: { field: Field; value: string }) {
  const option = field.options?.find((o) => o.label === value)
  if (!option) return null
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-xs", optionColors[option.color])}>{option.label}</span>
  )
}

function UserCell({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar className="size-5">
        <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{name.charAt(0)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  )
}

function RatingStars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!onChange}
          className={cn("transition-transform", onChange && "hover:scale-125")}
          onClick={(e) => {
            e.stopPropagation()
            onChange?.(star === value ? 0 : star)
          }}
        >
          <Star
            className={cn(
              "size-3.5",
              star <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30",
            )}
          />
        </button>
      ))}
    </span>
  )
}

/* ================= 页面 ================= */

interface CellPos {
  rowIndex: number
  colIndex: number
}

export default function EditTableDemoPage() {
  const [fields, setFields] = useState<Field[]>(initialFields)
  const [records, setRecords] = useState<RecordRow[]>(initialRecords)
  // 框选：anchor 起点 + focusCell 终点（单选时两者相同）
  const [anchor, setAnchor] = useState<CellPos | null>(null)
  const [focusCell, setFocusCell] = useState<CellPos | null>(null)
  const [editing, setEditing] = useState<CellPos | null>(null)
  const dragSelecting = useRef(false)
  const wasFocusRef = useRef(false)
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [newFieldName, setNewFieldName] = useState("")
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const [renamingField, setRenamingField] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const resizeStart = useRef<{ fieldId: string; startX: number; startWidth: number } | null>(null)

  const setCell = (recordId: string, fieldId: string, value: CellValue) =>
    setRecords((prev) =>
      prev.map((r) => (r.id === recordId ? { ...r, cells: { ...r.cells, [fieldId]: value } } : r)),
    )

  const addRecord = () => {
    const record: RecordRow = { id: newId("r"), cells: {} }
    fields.forEach((f) => {
      record.cells[f.id] = f.type === "checkbox" ? false : f.type === "rating" ? 0 : null
    })
    setRecords((prev) => [...prev, record])
    setAnchor({ rowIndex: records.length, colIndex: 0 })
    setFocusCell({ rowIndex: records.length, colIndex: 0 })
    setEditing({ rowIndex: records.length, colIndex: 0 })
  }

  const addField = (type: FieldType) => {
    const field: Field = {
      id: newId("f"),
      name: newFieldName.trim() || fieldTypeMeta[type].label,
      type,
      width: 140,
      options:
        type === "select"
          ? [
              { label: "选项 1", color: "blue" },
              { label: "选项 2", color: "emerald" },
              { label: "选项 3", color: "amber" },
            ]
          : undefined,
    }
    setFields((prev) => [...prev, field])
    setNewFieldName("")
    setAddFieldOpen(false)
    toast.success(`已添加字段「${field.name}」`)
  }

  const removeField = (fieldId: string) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId))
    toast.success("字段已删除")
  }

  const deleteCheckedRows = () => {
    setRecords((prev) => prev.filter((r) => !checkedRows.has(r.id)))
    toast.success(`已删除 ${checkedRows.size} 条记录`)
    setCheckedRows(new Set())
    setAnchor(null)
    setFocusCell(null)
  }

  /* ---------- 列宽拖拽 ---------- */
  const onResizeDown = (fieldId: string, width: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    resizeStart.current = { fieldId, startX: e.clientX, startWidth: width }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current
    if (!start) return
    const width = Math.max(80, start.startWidth + e.clientX - start.startX)
    setFields((prev) => prev.map((f) => (f.id === start.fieldId ? { ...f, width } : f)))
  }
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    resizeStart.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  /* ---------- 选区工具 ---------- */
  const clampPos = (pos: CellPos): CellPos => ({
    rowIndex: Math.min(records.length - 1, Math.max(0, pos.rowIndex)),
    colIndex: Math.min(fields.length - 1, Math.max(0, pos.colIndex)),
  })

  const rangeBounds =
    anchor && focusCell
      ? {
          r1: Math.min(anchor.rowIndex, focusCell.rowIndex),
          r2: Math.max(anchor.rowIndex, focusCell.rowIndex),
          c1: Math.min(anchor.colIndex, focusCell.colIndex),
          c2: Math.max(anchor.colIndex, focusCell.colIndex),
        }
      : null

  const inRange = (pos: CellPos) =>
    !!rangeBounds &&
    pos.rowIndex >= rangeBounds.r1 &&
    pos.rowIndex <= rangeBounds.r2 &&
    pos.colIndex >= rangeBounds.c1 &&
    pos.colIndex <= rangeBounds.c2

  const rangeCellCount = rangeBounds
    ? (rangeBounds.r2 - rangeBounds.r1 + 1) * (rangeBounds.c2 - rangeBounds.c1 + 1)
    : 0

  /** 清空选区内所有单元格（按字段类型回默认值） */
  const clearRange = () => {
    if (!rangeBounds) return
    setRecords((prev) =>
      prev.map((record, rowIndex) => {
        if (rowIndex < rangeBounds.r1 || rowIndex > rangeBounds.r2) return record
        const cells = { ...record.cells }
        for (let c = rangeBounds.c1; c <= rangeBounds.c2; c++) {
          const field = fields[c]
          if (field) cells[field.id] = field.type === "checkbox" ? false : field.type === "rating" ? 0 : null
        }
        return { ...record, cells }
      }),
    )
  }

  // 拖拽框选：全局 mouseup 结束
  useEffect(() => {
    const stop = () => {
      dragSelecting.current = false
    }
    window.addEventListener("mouseup", stop)
    return () => window.removeEventListener("mouseup", stop)
  }, [])

  /* ---------- 键盘导航 ---------- */
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!focusCell || editing) return
    const move = (dr: number, dc: number, extend: boolean) => {
      e.preventDefault()
      const next = clampPos({ rowIndex: focusCell.rowIndex + dr, colIndex: focusCell.colIndex + dc })
      setFocusCell(next)
      if (!extend) setAnchor(next) // Shift 扩展选区时保持起点不动
    }
    switch (e.key) {
      case "ArrowUp": move(-1, 0, e.shiftKey); break
      case "ArrowDown": move(1, 0, e.shiftKey); break
      case "ArrowLeft": move(0, -1, e.shiftKey); break
      case "ArrowRight": move(0, 1, e.shiftKey); break
      case "Tab": move(0, e.shiftKey ? -1 : 1, false); break
      case "Enter": {
        e.preventDefault()
        setEditing(focusCell)
        break
      }
      case "Escape": {
        e.preventDefault()
        setAnchor(focusCell)
        break
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault()
        clearRange()
        break
      }
    }
  }

  /* ---------- 单元格渲染 ---------- */
  const renderCell = (record: RecordRow, field: Field, pos: CellPos): ReactNode => {
    const value = record.cells[field.id] ?? null
    const isEditing = editing?.rowIndex === pos.rowIndex && editing.colIndex === pos.colIndex

    // 文本 / 数字：内联输入
    if ((field.type === "text" || field.type === "number") && isEditing) {
      return (
        <input
          autoFocus
          type={field.type === "number" ? "number" : "text"}
          defaultValue={value == null ? "" : String(value)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            const raw = e.target.value
            setCell(record.id, field.id, raw === "" ? null : field.type === "number" ? Number(raw) : raw)
            setEditing(null)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            if (e.key === "Escape") {
              setEditing(null)
              gridRef.current?.focus()
            }
          }}
          className="absolute inset-0 z-10 size-full border-2 border-primary bg-background px-2 text-sm outline-none"
        />
      )
    }

    if (field.type === "checkbox") {
      return (
        <Checkbox
          checked={value === true}
          onCheckedChange={(next) => setCell(record.id, field.id, next === true)}
          onClick={(e) => e.stopPropagation()}
        />
      )
    }

    if (field.type === "rating") {
      return <RatingStars value={typeof value === "number" ? value : 0} onChange={(v) => setCell(record.id, field.id, v)} />
    }

    if (field.type === "select") {
      const display = typeof value === "string" && value ? <OptionBadge field={field} value={value} /> : null
      return (
        <Popover open={isEditing} onOpenChange={(open) => setEditing(open ? pos : null)}>
          <PopoverTrigger asChild>
            <div className="flex size-full items-center">{display}</div>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-40 p-1">
            {(field.options ?? []).map((option) => (
              <button
                key={option.label}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                onClick={() => {
                  setCell(record.id, field.id, option.label)
                  setEditing(null)
                  gridRef.current?.focus()
                }}
              >
                <span className={cn("rounded-md px-1.5 py-0.5 text-xs", optionColors[option.color])}>
                  {option.label}
                </span>
                {value === option.label && <Check className="ml-auto size-3.5 text-primary" />}
              </button>
            ))}
            <DropdownMenuSeparator className="my-1" />
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
              onClick={() => {
                setCell(record.id, field.id, null)
                setEditing(null)
              }}
            >
              清除
            </button>
          </PopoverContent>
        </Popover>
      )
    }

    if (field.type === "user") {
      const display = typeof value === "string" && value ? <UserCell name={value} /> : null
      return (
        <Popover open={isEditing} onOpenChange={(open) => setEditing(open ? pos : null)}>
          <PopoverTrigger asChild>
            <div className="flex size-full items-center">{display}</div>
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-64 w-44 overflow-y-auto p-1">
            {USERS.map((name) => (
              <button
                key={name}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                onClick={() => {
                  setCell(record.id, field.id, name)
                  setEditing(null)
                  gridRef.current?.focus()
                }}
              >
                <Avatar className="size-5">
                  <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{name.charAt(0)}</AvatarFallback>
                </Avatar>
                {name}
                {value === name && <Check className="ml-auto size-3.5 text-primary" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )
    }

    if (field.type === "date") {
      return (
        <Popover open={isEditing} onOpenChange={(open) => setEditing(open ? pos : null)}>
          <PopoverTrigger asChild>
            <div className="flex size-full items-center text-sm">{typeof value === "string" ? value : ""}</div>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <Input
              autoFocus
              type="date"
              defaultValue={typeof value === "string" ? value : ""}
              onChange={(e) => {
                setCell(record.id, field.id, e.target.value || null)
              }}
              onKeyDown={(e) => e.key === "Enter" && setEditing(null)}
              className="h-8"
            />
          </PopoverContent>
        </Popover>
      )
    }

    // text / number 展示态
    return (
      <span className={cn("truncate text-sm", field.type === "number" && "ml-auto font-mono text-xs")}>
        {value == null ? "" : String(value)}
      </span>
    )
  }

  const totalWidth = 56 + fields.reduce((sum, f) => sum + f.width, 0) + 44
  const expandedRecord = records.find((r) => r.id === expandedId) ?? null

  return (
    <div className="space-y-4">
      <PageHeader
        title="编辑表格"
        description="Teable 风格的可编辑数据网格 · 双击/回车编辑 · 方向键导航 · 拖拽列宽 · 动态增删行列"
        actions={
          checkedRows.size > 0 ? (
            <Button variant="outline" size="sm" className="gap-1.5 text-rose-600 hover:text-rose-600" onClick={deleteCheckedRows}>
              <Trash2 className="size-3.5" />
              删除 {checkedRows.size} 条
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" onClick={addRecord}>
              <Plus className="size-4" />
              新增记录
            </Button>
          )
        }
      />

      <Card className="gap-0 overflow-hidden p-0">
        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onGridKeyDown}
          className="max-h-[calc(100vh-300px)] min-h-[480px] select-none overflow-auto outline-none"
        >
          <div style={{ width: totalWidth }} className="text-sm">
            {/* 表头 */}
            <div className="sticky top-0 z-20 flex border-b bg-muted/60 backdrop-blur">
              <div className="sticky left-0 z-30 flex w-14 shrink-0 items-center justify-center border-r bg-muted">
                <Checkbox
                  checked={checkedRows.size > 0 && checkedRows.size === records.length}
                  onCheckedChange={(next) =>
                    setCheckedRows(next ? new Set(records.map((r) => r.id)) : new Set())
                  }
                />
              </div>
              {fields.map((field) => {
                const Icon = fieldTypeMeta[field.type].icon
                return (
                  <div
                    key={field.id}
                    style={{ width: field.width }}
                    className="group relative flex shrink-0 items-center gap-1.5 border-r px-2 py-2"
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    {renamingField === field.id ? (
                      <input
                        autoFocus
                        defaultValue={field.name}
                        onBlur={(e) => {
                          const name = e.target.value.trim()
                          if (name) setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, name } : f)))
                          setRenamingField(null)
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        className="w-full min-w-0 rounded border border-primary bg-background px-1 text-xs outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{field.name}</span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                        >
                          <ChevronDown className="size-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-32">
                        <DropdownMenuItem className="text-xs" onClick={() => setRenamingField(field.id)}>
                          <Pencil className="size-3.5" /> 重命名
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          className="text-xs"
                          disabled={fields.length <= 1}
                          onClick={() => removeField(field.id)}
                        >
                          <Trash2 className="size-3.5" /> 删除字段
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* 列宽拖拽手柄 */}
                    <div
                      onPointerDown={onResizeDown(field.id, field.width)}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                      className="absolute -right-0.5 inset-y-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-primary/50"
                    />
                  </div>
                )
              })}
              {/* 新增字段 */}
              <Popover open={addFieldOpen} onOpenChange={setAddFieldOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-48 p-2">
                  <Input
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="字段名称（可选）"
                    className="mb-1.5 h-7 text-xs"
                  />
                  <div className="px-1 py-1 text-xs text-muted-foreground">选择字段类型</div>
                  {(Object.keys(fieldTypeMeta) as FieldType[]).map((type) => {
                    const meta = fieldTypeMeta[type]
                    return (
                      <button
                        key={type}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                        onClick={() => addField(type)}
                      >
                        <meta.icon className="size-3.5 text-muted-foreground" />
                        {meta.label}
                      </button>
                    )
                  })}
                </PopoverContent>
              </Popover>
            </div>

            {/* 数据行 */}
            {records.map((record, rowIndex) => (
              <div key={record.id} className="group/row flex border-b transition-colors hover:bg-accent/30">
                <div className="sticky left-0 z-10 flex w-14 shrink-0 items-center justify-center gap-0.5 border-r bg-card">
                  <span
                    className={cn(
                      "text-xs text-muted-foreground group-hover/row:hidden",
                      checkedRows.has(record.id) && "hidden",
                    )}
                  >
                    {rowIndex + 1}
                  </span>
                  <span className={cn("hidden items-center gap-0.5 group-hover/row:flex", checkedRows.has(record.id) && "flex")}>
                    <Checkbox
                      checked={checkedRows.has(record.id)}
                      onCheckedChange={(next) =>
                        setCheckedRows((prev) => {
                          const set = new Set(prev)
                          if (next) set.add(record.id)
                          else set.delete(record.id)
                          return set
                        })
                      }
                    />
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-primary"
                      onClick={() => setExpandedId(record.id)}
                    >
                      <Expand className="size-3" />
                    </button>
                  </span>
                </div>
                {fields.map((field, colIndex) => {
                  const pos = { rowIndex, colIndex }
                  const isFocus = focusCell?.rowIndex === rowIndex && focusCell.colIndex === colIndex
                  const isEditingCell = editing?.rowIndex === rowIndex && editing.colIndex === colIndex
                  const editableByClick = ["text", "number", "select", "user", "date"].includes(field.type)
                  return (
                    <div
                      key={field.id}
                      style={{ width: field.width }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return
                        // 编辑中的单元格：点击交给内部 input，不重置选区
                        if (isEditingCell) return
                        wasFocusRef.current = isFocus
                        if (e.shiftKey && anchor) {
                          setFocusCell(pos) // Shift+点击：扩展选区
                        } else {
                          setAnchor(pos)
                          setFocusCell(pos)
                          dragSelecting.current = true // 按住拖动即框选
                        }
                        gridRef.current?.focus()
                      }}
                      onMouseEnter={() => {
                        if (dragSelecting.current) setFocusCell(pos)
                      }}
                      onClick={() => {
                        if (editing) return
                        // 已是焦点格再次单击 → 直接进入编辑
                        if (wasFocusRef.current && isFocus && editableByClick) setEditing(pos)
                      }}
                      onDoubleClick={() => {
                        if (!isEditingCell && editableByClick) setEditing(pos)
                      }}
                      className={cn(
                        "relative flex h-9 shrink-0 cursor-default items-center border-r px-2",
                        inRange(pos) && !isFocus && "bg-primary/10",
                        isFocus && rangeCellCount > 1 && "bg-primary/10",
                        isFocus && "z-10 ring-2 ring-inset ring-primary",
                      )}
                    >
                      {renderCell(record, field, pos)}
                    </div>
                  )
                })}
                <div className="w-11 shrink-0" />
              </div>
            ))}

            {/* 新增记录行 */}
            <button
              type="button"
              onClick={addRecord}
              className="flex h-9 w-full items-center gap-1.5 px-4 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              新增记录
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            共 {records.length} 条记录 · {fields.length} 个字段
            {rangeCellCount > 1 && (
              <span className="ml-2 text-primary">已选 {rangeCellCount} 个单元格</span>
            )}
          </span>
          <span>单击选中/再击编辑 · 拖拽或 Shift+方向键框选 · Delete 清空所选 · Esc 取消框选</span>
        </div>
      </Card>

      {/* 记录详情抽屉 */}
      <Drawer
        open={!!expandedRecord}
        onOpenChange={(open) => !open && setExpandedId(null)}
        title="记录详情"
        description={expandedRecord ? String(expandedRecord.cells.f_title ?? "未命名记录") : ""}
        width={420}
      >
        {expandedRecord && (
          <div className="space-y-4">
            {fields.map((field) => {
              const value = expandedRecord.cells[field.id] ?? null
              const Icon = fieldTypeMeta[field.type].icon
              return (
                <div key={field.id} className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="size-3.5" />
                    {field.name}
                  </Label>
                  {field.type === "text" && (
                    <Input
                      value={value == null ? "" : String(value)}
                      onChange={(e) => setCell(expandedRecord.id, field.id, e.target.value || null)}
                      className="h-8 text-sm"
                    />
                  )}
                  {field.type === "number" && (
                    <Input
                      type="number"
                      value={value == null ? "" : String(value)}
                      onChange={(e) =>
                        setCell(expandedRecord.id, field.id, e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="h-8 text-sm"
                    />
                  )}
                  {field.type === "date" && (
                    <Input
                      type="date"
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) => setCell(expandedRecord.id, field.id, e.target.value || null)}
                      className="h-8 text-sm"
                    />
                  )}
                  {field.type === "checkbox" && (
                    <Switch
                      checked={value === true}
                      onCheckedChange={(next) => setCell(expandedRecord.id, field.id, next)}
                    />
                  )}
                  {field.type === "rating" && (
                    <RatingStars
                      value={typeof value === "number" ? value : 0}
                      onChange={(v) => setCell(expandedRecord.id, field.id, v)}
                    />
                  )}
                  {field.type === "select" && (
                    <div className="flex flex-wrap gap-1.5">
                      {(field.options ?? []).map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() =>
                            setCell(expandedRecord.id, field.id, value === option.label ? null : option.label)
                          }
                          className={cn(
                            "rounded-md px-2 py-1 text-xs transition-all",
                            optionColors[option.color],
                            value === option.label ? "ring-2 ring-primary/60" : "opacity-60 hover:opacity-100",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {field.type === "user" && (
                    <div className="flex flex-wrap gap-1.5">
                      {USERS.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setCell(expandedRecord.id, field.id, value === name ? null : name)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors",
                            value === name ? "border-primary/40 bg-primary/10 text-primary" : "hover:bg-accent",
                          )}
                        >
                          <Avatar className="size-4">
                            <AvatarFallback className="bg-primary/10 text-[9px] text-primary">
                              {name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="flex justify-end border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-rose-600 hover:text-rose-600"
                onClick={() => {
                  setRecords((prev) => prev.filter((r) => r.id !== expandedRecord.id))
                  setExpandedId(null)
                  toast.success("记录已删除")
                }}
              >
                <Trash2 className="size-3.5" />
                删除记录
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
