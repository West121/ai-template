import { useEffect, useState } from "react"
import {
  BadgeCheck,
  Briefcase,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Clock,
  ContactRound,
  DoorOpen,
  FileSignature,
  HandCoins,
  Plane,
  Receipt,
  ShoppingCart,
  Stamp,
  Star,
  UserMinus,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"

interface FlowItem {
  key: string
  name: string
  description: string
  icon: LucideIcon
  color: string
  /** 契约审批类型枚举 */
  type: string
}

interface FlowCategory {
  category: string
  flows: FlowItem[]
}

const flowCategories: FlowCategory[] = [
  {
    category: "人事类",
    flows: [
      { key: "leave", name: "请假申请", description: "事假、病假、年假等各类请假", icon: CalendarClock, color: "bg-blue-500/10 text-blue-600", type: "LEAVE" },
      { key: "overtime", name: "加班申请", description: "工作日、节假日加班报备", icon: Clock, color: "bg-indigo-500/10 text-indigo-600", type: "OVERTIME" },
      { key: "trip", name: "出差申请", description: "外出公干、差旅行程审批", icon: Plane, color: "bg-sky-500/10 text-sky-600", type: "TRIP" },
      { key: "regular", name: "转正申请", description: "试用期届满转正评估", icon: BadgeCheck, color: "bg-emerald-500/10 text-emerald-600", type: "OTHER" },
      { key: "resign", name: "离职申请", description: "离职流程发起与交接确认", icon: UserMinus, color: "bg-rose-500/10 text-rose-600", type: "OTHER" },
    ],
  },
  {
    category: "财务类",
    flows: [
      { key: "expense", name: "费用报销", description: "差旅费、招待费等费用报销", icon: Receipt, color: "bg-amber-500/10 text-amber-600", type: "EXPENSE" },
      { key: "payment", name: "付款申请", description: "对公付款、合同款项支付", icon: HandCoins, color: "bg-orange-500/10 text-orange-600", type: "EXPENSE" },
      { key: "reserve", name: "备用金申请", description: "部门备用金申领与核销", icon: Wallet, color: "bg-yellow-500/10 text-yellow-600", type: "EXPENSE" },
    ],
  },
  {
    category: "行政类",
    flows: [
      { key: "seal", name: "用章申请", description: "公章、合同章、法人章使用", icon: Stamp, color: "bg-violet-500/10 text-violet-600", type: "SEAL" },
      { key: "purchase", name: "采购申请", description: "办公用品、设备采购申请", icon: ShoppingCart, color: "bg-purple-500/10 text-purple-600", type: "PURCHASE" },
      { key: "card", name: "名片申请", description: "员工名片印制申请", icon: ContactRound, color: "bg-cyan-500/10 text-cyan-600", type: "OTHER" },
      { key: "meeting", name: "会议室借用", description: "会议室预约与借用登记", icon: DoorOpen, color: "bg-teal-500/10 text-teal-600", type: "OTHER" },
    ],
  },
  {
    category: "合同类",
    flows: [
      { key: "contract-sign", name: "合同会签", description: "合同条款多部门联合会签", icon: FileSignature, color: "bg-pink-500/10 text-pink-600", type: "CONTRACT" },
      { key: "contract-seal", name: "合同用印", description: "合同定稿后的用印审批", icon: Briefcase, color: "bg-fuchsia-500/10 text-fuchsia-600", type: "CONTRACT" },
    ],
  },
]

const allFlows = flowCategories.flatMap((c) => c.flows)
const frequentKeys = ["leave", "expense", "overtime", "seal"]
const frequentFlows = frequentKeys
  .map((key) => allFlows.find((f) => f.key === key))
  .filter((f): f is FlowItem => Boolean(f))

interface UserOption {
  id: number
  name: string
  primaryDeptName?: string
}

function todayPlus(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function ApprovalCreatePage() {
  const user = useAuthStore((s) => s.user)
  const offline = useAuthStore((s) => s.offline)

  const [activeFlow, setActiveFlow] = useState<FlowItem | null>(null)
  const [startDate, setStartDate] = useState(todayPlus(1))
  const [endDate, setEndDate] = useState(todayPlus(2))
  const [duration, setDuration] = useState("1")
  const [reason, setReason] = useState("")
  const [urgency, setUrgency] = useState("normal")
  const [submitting, setSubmitting] = useState(false)

  // 抄送人多选
  const [users, setUsers] = useState<UserOption[]>([])
  const [ccUserIds, setCcUserIds] = useState<number[]>([])
  const [ccOpen, setCcOpen] = useState(false)

  useEffect(() => {
    if (offline) return
    api<PageResult<UserOption>>("/api/system/users?pageNum=1&pageSize=100")
      .then((page) => setUsers(page.list))
      .catch(() => setUsers([])) // 拉取失败时抄送人列表为空，不阻断发起申请
  }, [offline])

  const openFlow = (flow: FlowItem) => {
    setStartDate(todayPlus(1))
    setEndDate(todayPlus(2))
    setDuration("1")
    setReason("")
    setUrgency("normal")
    setCcUserIds([])
    setActiveFlow(flow)
  }

  const toggleCc = (id: number) => {
    setCcUserIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  const title = activeFlow ? `${user?.name ?? "访客"}的${activeFlow.name}` : ""

  const handleSubmit = async () => {
    if (!activeFlow) return
    if (offline) {
      toast.info("当前为离线演示模式，无法提交申请，请启动后端后重新登录")
      return
    }
    if (!reason.trim()) {
      toast.error("请填写申请事由")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/office/approvals", {
        method: "POST",
        body: JSON.stringify({
          title,
          type: activeFlow.type,
          reason: reason.trim(),
          startDate,
          endDate,
          ...(ccUserIds.length > 0 ? { ccUserIds } : {}),
        }),
      })
      toast.success("提交成功，已进入审批流程，可前往「我的申请」查看进度")
      setActiveFlow(null)
    } catch (err) {
      if (err instanceof NetworkError) toast.error("无法连接后端服务，请稍后重试")
      else if (err instanceof ApiError) toast.error(err.message)
      else toast.error("提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="发起申请" description="选择流程模板发起审批，提交后将按预设流程逐级流转" />

      {/* 常用流程 */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <Star className="size-4 text-amber-500" />
          常用流程
        </div>
        <div className="flex flex-wrap gap-2">
          {frequentFlows.map((flow) => (
            <Button key={flow.key} variant="outline" size="sm" className="gap-1.5" onClick={() => openFlow(flow)}>
              <flow.icon className="size-3.5" />
              {flow.name}
            </Button>
          ))}
        </div>
      </div>

      {/* 分类流程卡片 */}
      {flowCategories.map((group) => (
        <div key={group.category} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{group.category}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.flows.map((flow) => (
              <button
                key={flow.key}
                type="button"
                onClick={() => openFlow(flow)}
                className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${flow.color}`}>
                  <flow.icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium group-hover:text-primary">{flow.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{flow.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* 申请表单弹窗 */}
      <Dialog open={activeFlow !== null} onOpenChange={(open) => !open && setActiveFlow(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{activeFlow ? `发起${activeFlow.name}` : ""}</DialogTitle>
            <DialogDescription>{activeFlow?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>标题</Label>
              <Input value={title} readOnly className="bg-muted/50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">开始日期</Label>
                <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">结束日期</Label>
                <Input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="duration">时长（天）</Label>
              <Input
                id="duration"
                type="number"
                min="0.5"
                step="0.5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">
                <span className="text-destructive">*</span> 事由
              </Label>
              <Textarea
                id="reason"
                rows={3}
                placeholder="请填写申请事由…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>抄送人</Label>
              <Popover open={ccOpen} onOpenChange={setCcOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal hover:bg-transparent"
                  >
                    {ccUserIds.length === 0 ? (
                      <span className="text-muted-foreground">选择需要抄送的同事（可多选）</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {ccUserIds.map((id) => {
                          const u = users.find((item) => item.id === id)
                          return (
                            <Badge key={id} variant="secondary" className="gap-1 font-normal">
                              {u?.name ?? `#${id}`}
                              <X
                                className="size-3 cursor-pointer text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleCc(id)
                                }}
                              />
                            </Badge>
                          )
                        })}
                      </span>
                    )}
                    <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="搜索姓名…" />
                    <CommandList>
                      <CommandEmpty>{offline ? "离线模式下无法获取人员列表" : "未找到人员"}</CommandEmpty>
                      <CommandGroup>
                        {users.map((u) => (
                          <CommandItem key={u.id} value={u.name} onSelect={() => toggleCc(u.id)}>
                            <Check
                              className={cn("size-4", ccUserIds.includes(u.id) ? "opacity-100" : "opacity-0")}
                            />
                            <span>{u.name}</span>
                            {u.primaryDeptName && (
                              <span className="ml-auto text-xs text-muted-foreground">{u.primaryDeptName}</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label>紧急程度</Label>
              <RadioGroup value={urgency} onValueChange={setUrgency} className="flex gap-6">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="normal" id="urgency-normal" />
                  <Label htmlFor="urgency-normal" className="font-normal">
                    普通
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="urgent" id="urgency-urgent" />
                  <Label htmlFor="urgency-urgent" className="font-normal text-amber-600">
                    加急
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveFlow(null)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void handleSubmit()}>
              {submitting ? "提交中…" : "提交申请"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
