import { useMemo, useState, type DragEvent } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import type { ColumnDef } from "@tanstack/react-table"
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Kanban,
  Layers,
  LayoutGrid,
  Minus,
  Pencil,
  Plus,
  Settings2,
  Table2,
  Trash2,
} from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/* ================= 数据 ================= */

type TaskStatus = "待处理" | "进行中" | "已完成" | "已取消"
type TaskPriority = "高" | "中" | "低"

interface TaskRow {
  id: string
  title: string
  dept: string
  assignee: string
  status: TaskStatus
  priority: TaskPriority
  hours: number
  deadline: string
}

const initialTasks: TaskRow[] = [
  { id: "T-1024", title: "工作台首页改版设计评审", dept: "产品研发部", assignee: "赵天宇", status: "进行中", priority: "高", hours: 16, deadline: "2026-07-10" },
  { id: "T-1025", title: "审批流程引擎性能优化", dept: "产品研发部", assignee: "刘志强", status: "进行中", priority: "高", hours: 40, deadline: "2026-07-15" },
  { id: "T-1026", title: "移动端打卡定位偏移修复", dept: "产品研发部", assignee: "孙铭轩", status: "待处理", priority: "高", hours: 8, deadline: "2026-07-08" },
  { id: "T-1027", title: "通讯录组织树懒加载", dept: "产品研发部", assignee: "王小磊", status: "已完成", priority: "中", hours: 12, deadline: "2026-07-03" },
  { id: "T-1028", title: "公文批注富文本组件调研", dept: "产品研发部", assignee: "李思雨", status: "待处理", priority: "中", hours: 24, deadline: "2026-07-20" },
  { id: "T-1029", title: "会议室预订冲突检测", dept: "产品研发部", assignee: "张浩然", status: "进行中", priority: "中", hours: 16, deadline: "2026-07-12" },
  { id: "T-1030", title: "数据大屏第三季度指标接入", dept: "信息中心", assignee: "谭凯文", status: "待处理", priority: "高", hours: 32, deadline: "2026-07-18" },
  { id: "T-1031", title: "内网 SSO 单点登录升级", dept: "信息中心", assignee: "谭凯文", status: "进行中", priority: "高", hours: 24, deadline: "2026-07-11" },
  { id: "T-1032", title: "办公网络分区改造方案", dept: "信息中心", assignee: "谭凯文", status: "已取消", priority: "低", hours: 40, deadline: "2026-07-30" },
  { id: "T-1033", title: "Q3 市场投放素材制作", dept: "市场部", assignee: "徐子豪", status: "进行中", priority: "中", hours: 20, deadline: "2026-07-14" },
  { id: "T-1034", title: "行业峰会展位搭建对接", dept: "市场部", assignee: "黄丽娟", status: "待处理", priority: "中", hours: 16, deadline: "2026-07-22" },
  { id: "T-1035", title: "官网 SEO 关键词优化", dept: "市场部", assignee: "徐子豪", status: "已完成", priority: "低", hours: 12, deadline: "2026-07-01" },
  { id: "T-1036", title: "大客户续约方案评审", dept: "销售部", assignee: "朱国栋", status: "进行中", priority: "高", hours: 8, deadline: "2026-07-09" },
  { id: "T-1037", title: "销售 CRM 线索清洗", dept: "销售部", assignee: "马天成", status: "待处理", priority: "低", hours: 16, deadline: "2026-07-25" },
  { id: "T-1038", title: "渠道伙伴返点核算", dept: "销售部", assignee: "谢婷婷", status: "已完成", priority: "中", hours: 8, deadline: "2026-06-30" },
  { id: "T-1039", title: "校招夏令营行程安排", dept: "人力资源部", assignee: "宋佳琪", status: "进行中", priority: "中", hours: 24, deadline: "2026-07-16" },
  { id: "T-1040", title: "新员工入职培训课件更新", dept: "人力资源部", assignee: "刘雅婷", status: "待处理", priority: "低", hours: 12, deadline: "2026-07-28" },
  { id: "T-1041", title: "半年度绩效考核启动", dept: "人力资源部", assignee: "刘雅婷", status: "进行中", priority: "高", hours: 20, deadline: "2026-07-13" },
  { id: "T-1042", title: "差旅费用报销制度修订", dept: "财务部", assignee: "杨慧敏", status: "已完成", priority: "中", hours: 8, deadline: "2026-07-02" },
  { id: "T-1043", title: "七月增值税申报", dept: "财务部", assignee: "曹雪莉", status: "待处理", priority: "高", hours: 8, deadline: "2026-07-15" },
]

const DEPTS = ["产品研发部", "信息中心", "市场部", "销售部", "人力资源部", "财务部"]

const statusMeta: Record<TaskStatus, { badge: string; dot: string; chip: string }> = {
  待处理: { badge: "border-amber-500/30 bg-amber-500/10 text-amber-600", dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  进行中: { badge: "border-blue-500/30 bg-blue-500/10 text-blue-600", dot: "bg-blue-500", chip: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  已完成: { badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600", dot: "bg-emerald-500", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  已取消: { badge: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground", chip: "bg-muted text-muted-foreground" },
}

const priorityMeta: Record<TaskPriority, { icon: typeof ArrowUp; className: string }> = {
  高: { icon: ArrowUp, className: "text-rose-500" },
  中: { icon: Minus, className: "text-amber-500" },
  低: { icon: ArrowDown, className: "text-sky-500" },
}

function PriorityCell({ priority }: { priority: TaskPriority }) {
  const meta = priorityMeta[priority]
  return (
    <span className="flex items-center gap-1 text-sm">
      <meta.icon className={cn("size-3.5", meta.className)} />
      {priority}
    </span>
  )
}

function AssigneeCell({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <Avatar className="size-5">
        <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{name.charAt(0)}</AvatarFallback>
      </Avatar>
      {name}
    </span>
  )
}

/* ================= 视图模型 ================= */

type ViewType = "table" | "gallery" | "kanban" | "calendar" | "form"
type KanbanGroupField = "status" | "priority" | "dept" | "assignee"

interface ViewDef {
  id: string
  name: string
  type: ViewType
  /** 看板：分组依据 */
  kanbanGroupBy: KanbanGroupField
  /** 画册：卡片展示的字段 */
  galleryFields: string[]
}

const VIEW_TYPES: Array<{ type: ViewType; label: string; icon: typeof Table2 }> = [
  { type: "table", label: "表格视图", icon: Table2 },
  { type: "gallery", label: "画册视图", icon: LayoutGrid },
  { type: "kanban", label: "看板视图", icon: Kanban },
  { type: "calendar", label: "日历视图", icon: CalendarDays },
  { type: "form", label: "表单视图", icon: ClipboardList },
]

const viewTypeMeta = (type: ViewType) => VIEW_TYPES.find((v) => v.type === type)!

let viewUid = 0
function createView(type: ViewType, name?: string): ViewDef {
  return {
    id: `v${++viewUid}`,
    name: name ?? viewTypeMeta(type).label,
    type,
    kanbanGroupBy: "status",
    galleryFields: ["assignee", "status", "priority", "deadline"],
  }
}

/* ================= 表格视图 ================= */

const columns: ColumnDef<TaskRow, unknown>[] = [
  {
    accessorKey: "id",
    meta: { title: "编号" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="编号" />,
    cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>,
  },
  {
    accessorKey: "title",
    meta: { title: "任务标题" },
    header: () => <span>任务标题</span>,
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: "dept",
    meta: { title: "所属部门", filterType: "select", options: DEPTS },
    filterFn: "arrIncludesSome",
    header: ({ column }) => <DataTableColumnHeader column={column} title="所属部门" />,
    cell: ({ row }) => row.original.dept,
  },
  {
    accessorKey: "assignee",
    meta: { title: "负责人" },
    header: () => <span>负责人</span>,
    cell: ({ row }) => <AssigneeCell name={row.original.assignee} />,
  },
  {
    accessorKey: "status",
    meta: { title: "状态", filterType: "select", options: ["待处理", "进行中", "已完成", "已取消"] },
    filterFn: "arrIncludesSome",
    header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
    cell: ({ row }) => (
      <Badge variant="outline" className={statusMeta[row.original.status].badge}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "priority",
    meta: { title: "优先级", filterType: "select", options: ["高", "中", "低"] },
    filterFn: "arrIncludesSome",
    header: ({ column }) => <DataTableColumnHeader column={column} title="优先级" />,
    cell: ({ row }) => <PriorityCell priority={row.original.priority} />,
  },
  {
    accessorKey: "hours",
    meta: { title: "预估工时", filterType: "number" },
    aggregationFn: "sum",
    header: ({ column }) => <DataTableColumnHeader column={column} title="预估工时" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.hours}h</span>,
    aggregatedCell: ({ getValue }) => (
      <span className="font-mono text-xs text-muted-foreground">合计 {getValue<number>()}h</span>
    ),
  },
  {
    accessorKey: "deadline",
    meta: { title: "截止日期", filterType: "date" },
    header: ({ column }) => <DataTableColumnHeader column={column} title="截止日期" />,
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.deadline}</span>,
  },
]

/* ================= 看板视图 ================= */

const KANBAN_GROUPS: Record<KanbanGroupField, { label: string }> = {
  status: { label: "状态" },
  priority: { label: "优先级" },
  dept: { label: "部门" },
  assignee: { label: "负责人" },
}

const dotPalette = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-slate-400",
]

function KanbanView({
  tasks,
  groupBy,
  onGroupByChange,
  onMove,
}: {
  tasks: TaskRow[]
  groupBy: KanbanGroupField
  onGroupByChange: (field: KanbanGroupField) => void
  onMove: (id: string, field: KanbanGroupField, value: string) => void
}) {
  const [dragOver, setDragOver] = useState<string | null>(null)

  const groups = useMemo(() => {
    if (groupBy === "status") return ["待处理", "进行中", "已完成", "已取消"]
    if (groupBy === "priority") return ["高", "中", "低"]
    if (groupBy === "dept") return DEPTS.filter((d) => tasks.some((t) => t.dept === d))
    return Array.from(new Set(tasks.map((t) => t.assignee)))
  }, [groupBy, tasks])

  const dotFor = (value: string, index: number) =>
    groupBy === "status" ? statusMeta[value as TaskStatus].dot : dotPalette[index % dotPalette.length]

  const handleDrop = (e: DragEvent, value: string) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData("text/plain")
    if (id) onMove(id, groupBy, value)
  }

  return (
    <div className="space-y-3">
      {/* 视图配置栏 */}
      <div className="flex items-center gap-2">
        <Layers className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">分组依据</span>
        <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as KanbanGroupField)}>
          <SelectTrigger size="sm" className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KANBAN_GROUPS) as KanbanGroupField[]).map((field) => (
              <SelectItem key={field} value={field} className="text-xs">
                {KANBAN_GROUPS[field].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {groups.map((group, index) => {
          const list = tasks.filter((t) => t[groupBy] === group)
          return (
            <div
              key={group}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(group)
              }}
              onDragLeave={() => setDragOver((prev) => (prev === group ? null : prev))}
              onDrop={(e) => handleDrop(e, group)}
              className={cn(
                "flex min-h-64 w-72 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors",
                dragOver === group && "border-primary/50 bg-primary/5",
              )}
            >
              <div className="flex items-center gap-2 border-b px-3 py-2.5">
                <span className={cn("size-2 rounded-full", dotFor(group, index))} />
                <span className="text-sm font-medium">{group}</span>
                <Badge variant="secondary" className="h-4.5 rounded-full px-1.5 text-[10px]">
                  {list.length}
                </Badge>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {list.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
                    className="cursor-grab space-y-2 rounded-md border bg-card p-3 shadow-xs transition-shadow hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">{task.title}</span>
                      <PriorityCell priority={task.priority} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{task.id}</span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {task.deadline.slice(5)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 className="size-3" />
                        {task.hours}h
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <AssigneeCell name={task.assignee} />
                      <span className="text-xs text-muted-foreground">{task.dept}</span>
                    </div>
                  </div>
                ))}
                {list.length === 0 && (
                  <div className="flex flex-1 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                    拖拽卡片到这里
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ================= 画册视图 ================= */

const GALLERY_FIELDS: Array<{ id: string; label: string }> = [
  { id: "dept", label: "所属部门" },
  { id: "assignee", label: "负责人" },
  { id: "status", label: "状态" },
  { id: "priority", label: "优先级" },
  { id: "hours", label: "预估工时" },
  { id: "deadline", label: "截止日期" },
]

function GalleryView({
  tasks,
  fields,
  onFieldsChange,
}: {
  tasks: TaskRow[]
  fields: string[]
  onFieldsChange: (fields: string[]) => void
}) {
  const renderField = (task: TaskRow, fieldId: string) => {
    switch (fieldId) {
      case "dept": return task.dept
      case "assignee": return <AssigneeCell name={task.assignee} />
      case "status":
        return (
          <Badge variant="outline" className={statusMeta[task.status].badge}>
            {task.status}
          </Badge>
        )
      case "priority": return <PriorityCell priority={task.priority} />
      case "hours": return <span className="font-mono text-xs">{task.hours}h</span>
      case "deadline": return <span className="text-xs">{task.deadline}</span>
      default: return null
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
              <Settings2 className="size-3.5" />
              卡片配置
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-1.5">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">卡片展示字段</div>
            {GALLERY_FIELDS.map((field) => (
              <label
                key={field.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
              >
                <Switch
                  checked={fields.includes(field.id)}
                  className="scale-90"
                  onCheckedChange={(next) =>
                    onFieldsChange(next ? [...fields, field.id] : fields.filter((f) => f !== field.id))
                  }
                />
                <span className="text-xs">{field.label}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>
        <span className="text-xs text-muted-foreground">共 {tasks.length} 条记录</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="overflow-hidden rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-md"
          >
            <div className={cn("h-1.5", statusMeta[task.status].dot)} />
            <div className="space-y-2.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">{task.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{task.id}</span>
              </div>
              <div className="space-y-1.5">
                {GALLERY_FIELDS.filter((f) => fields.includes(f.id)).map((field) => (
                  <div key={field.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">{field.label}</span>
                    <span>{renderField(task, field.id)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================= 日历视图 ================= */

function CalendarView({ tasks }: { tasks: TaskRow[] }) {
  const [month, setMonth] = useState(new Date(2026, 6, 1))
  const today = new Date(2026, 6, 6)

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    const end = endOfMonth(month)
    const list: Date[] = []
    let cursor = start
    while (cursor <= end || list.length % 7 !== 0) {
      list.push(cursor)
      cursor = addDays(cursor, 1)
    }
    return list
  }, [month])

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-medium">{format(month, "yyyy 年 M 月")}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMonth(new Date(2026, 6, 1))}>
            今天
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <div key={d} className="py-1.5">
            周{d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayTasks = tasks.filter((t) => isSameDay(new Date(t.deadline), day))
          const inMonth = isSameMonth(day, month)
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-24 space-y-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-xs",
                  !inMonth && "text-muted-foreground/50",
                  isSameDay(day, today) && "bg-primary font-medium text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </div>
              {dayTasks.slice(0, 3).map((task) => (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "cursor-default truncate rounded px-1 py-0.5 text-[10px]",
                        statusMeta[task.status].chip,
                      )}
                    >
                      {task.title}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {task.title} · {task.assignee} · {task.status}
                  </TooltipContent>
                </Tooltip>
              ))}
              {dayTasks.length > 3 && (
                <div className="px-1 text-[10px] text-muted-foreground">+{dayTasks.length - 3} 更多</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ================= 表单视图 ================= */

const taskSchema = z.object({
  title: z.string().trim().min(1, "请输入任务标题"),
  dept: z.string().min(1, "请选择所属部门"),
  assignee: z.string().trim().min(1, "请输入负责人"),
  priority: z.string().min(1, "请选择优先级"),
  hours: z
    .string()
    .min(1, "请输入预估工时")
    .regex(/^\d+$/, "请输入整数")
    .refine((n) => Number(n) >= 1 && Number(n) <= 999, "工时需在 1~999 小时之间"),
  deadline: z.string().min(1, "请选择截止日期"),
})

type TaskFormValues = z.infer<typeof taskSchema>

function FormView({ onSubmit }: { onSubmit: (values: TaskFormValues) => void }) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", dept: "", assignee: "", priority: "中", hours: "8", deadline: "" },
  })

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardContent className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">新建任务</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              表单视图：对外收集/录入数据的形态，提交后写入数据源，所有视图实时可见
            </p>
          </div>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => {
                onSubmit(values)
                form.reset()
              })}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>任务标题</FormLabel>
                    <FormControl>
                      <Input placeholder="请输入任务标题" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="dept"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>所属部门</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="请选择部门" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DEPTS.map((dept) => (
                            <SelectItem key={dept} value={dept}>
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="assignee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>负责人</FormLabel>
                      <FormControl>
                        <Input placeholder="请输入负责人" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>优先级</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {["高", "中", "低"].map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>预估工时（小时）</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="deadline"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel required>截止日期</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Button type="submit" className="w-full">
                提交
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}

/* ================= 页面：多视图容器 ================= */

export default function TableDemoPage() {
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks)
  const [views, setViews] = useState<ViewDef[]>(() => [
    createView("table", "任务总表"),
    createView("kanban", "任务看板"),
  ])
  const [activeId, setActiveId] = useState(views[0].id)
  const [renaming, setRenaming] = useState<ViewDef | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const activeView = views.find((v) => v.id === activeId) ?? views[0]

  const updateView = (id: string, partial: Partial<ViewDef>) =>
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...partial } : v)))

  const addView = (type: ViewType) => {
    const count = views.filter((v) => v.type === type).length
    const view = createView(type, `${viewTypeMeta(type).label}${count > 0 ? ` ${count + 1}` : ""}`)
    setViews((prev) => [...prev, view])
    setActiveId(view.id)
  }

  const removeView = (id: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.id !== id)
      if (activeId === id) setActiveId(next[0].id)
      return next
    })
  }

  const moveTask = (id: string, field: KanbanGroupField, value: string) => {
    const task = tasks.find((t) => t.id === id)
    if (!task || task[field] === value) return
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)))
    toast.success(`「${task.title}」的${KANBAN_GROUPS[field].label}已改为「${value}」`)
  }

  const addTask = (values: TaskFormValues) => {
    setTasks((prev) => [
      {
        id: `T-${1043 + prev.length - initialTasks.length + 1}`,
        title: values.title,
        dept: values.dept,
        assignee: values.assignee,
        status: "待处理",
        priority: values.priority as TaskPriority,
        hours: Number(values.hours),
        deadline: values.deadline,
      },
      ...prev,
    ])
    toast.success(`任务「${values.title}」已创建，可切换到其他视图查看`)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="高级表格" description="多视图数据管理：同一份数据，表格 / 画册 / 看板 / 日历 / 表单多种形态" />

      {/* 视图栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {views.map((view) => {
          const Icon = viewTypeMeta(view.type).icon
          const active = view.id === activeId
          return (
            <div
              key={view.id}
              className={cn(
                "group flex items-center rounded-md transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => setActiveId(view.id)}
                className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1 text-sm font-medium"
              >
                <Icon className="size-4" />
                {view.name}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "mr-1 rounded p-0.5 transition-opacity hover:bg-foreground/10",
                      active ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                    )}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-32">
                  <DropdownMenuItem
                    className="text-xs"
                    onClick={() => {
                      setRenaming(view)
                      setRenameValue(view.name)
                    }}
                  >
                    <Pencil className="size-3.5" /> 重命名
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="text-xs"
                    disabled={views.length <= 1}
                    onClick={() => removeView(view.id)}
                  >
                    <Trash2 className="size-3.5" /> 删除视图
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            <DropdownMenuLabel className="text-xs text-muted-foreground">新建视图</DropdownMenuLabel>
            {VIEW_TYPES.map((item) => (
              <DropdownMenuItem key={item.type} className="text-xs" onClick={() => addView(item.type)}>
                <item.icon className="size-3.5" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 活动视图 */}
      {activeView.type === "table" && (
        <DataTable
          columns={columns}
          data={tasks}
          searchKeys={["id", "title", "assignee"]}
          searchPlaceholder="搜索编号 / 标题 / 负责人"
          advancedFilter
          groupOptions={[
            { id: "dept", label: "部门" },
            { id: "status", label: "状态" },
            { id: "assignee", label: "负责人" },
          ]}
          enableSelection
          exportFileName="项目任务"
          initialPageSize={50}
          onRefresh={() => toast.success("已刷新")}
        />
      )}
      {activeView.type === "kanban" && (
        <KanbanView
          tasks={tasks}
          groupBy={activeView.kanbanGroupBy}
          onGroupByChange={(field) => updateView(activeView.id, { kanbanGroupBy: field })}
          onMove={moveTask}
        />
      )}
      {activeView.type === "gallery" && (
        <GalleryView
          tasks={tasks}
          fields={activeView.galleryFields}
          onFieldsChange={(fields) => updateView(activeView.id, { galleryFields: fields })}
        />
      )}
      {activeView.type === "calendar" && <CalendarView tasks={tasks} />}
      {activeView.type === "form" && <FormView onSubmit={addTask} />}

      {/* 重命名视图 */}
      <Modal
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="重命名视图"
        width={400}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (renaming && renameValue.trim()) {
                  updateView(renaming.id, { name: renameValue.trim() })
                }
                setRenaming(null)
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="视图名称"
          autoFocus
        />
      </Modal>
    </div>
  )
}
