import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import {
  GripVertical,
  LayoutGrid,
  Maximize2,
  PanelLeft,
  PanelRight,
  SquarePen,
} from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Drawer } from "@/components/drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/* ---------- 表单抽屉：react-hook-form + zod ---------- */

const taskSchema = z.object({
  title: z.string().trim().min(1, "请输入任务标题"),
  assignee: z.string().min(1, "请选择负责人"),
  deadline: z.string().min(1, "请选择截止日期"),
  priority: z.string().min(1, "请选择优先级"),
  detail: z.string().max(500, "描述不能超过 500 字"),
})

type TaskForm = z.infer<typeof taskSchema>

const ASSIGNEES = ["王小磊", "李思雨", "张浩然", "刘志强", "孙铭轩"]

function TaskFormDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", assignee: "", deadline: "", priority: "中", detail: "" },
  })

  const onSubmit = (values: TaskForm) => {
    toast.success(`任务「${values.title}」已指派给 ${values.assignee}`)
    onOpenChange(false)
    form.reset()
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) form.reset()
      }}
      title="新建任务"
      description="表单抽屉 · 拖宽或全屏后字段自动变两列（容器查询）"
      width={440}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={form.handleSubmit(onSubmit)}>创建</Button>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 @md:grid-cols-2">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem className="@md:col-span-2">
                <FormLabel required>任务标题</FormLabel>
                <FormControl>
                  <Input placeholder="请输入任务标题" {...field} />
                </FormControl>
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
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择负责人" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ASSIGNEES.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
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
            name="deadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>截止日期</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
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
            name="detail"
            render={({ field }) => (
              <FormItem className="@md:col-span-2">
                <FormLabel>任务描述</FormLabel>
                <FormControl>
                  <Textarea rows={4} placeholder="选填，最多 500 字" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Drawer>
  )
}

/* ---------- 演示页 ---------- */

const approvalStats = [
  { label: "待我审批", value: 5, color: "text-blue-600 bg-blue-500/10" },
  { label: "我发起的", value: 12, color: "text-emerald-600 bg-emerald-500/10" },
  { label: "已办结", value: 86, color: "text-violet-600 bg-violet-500/10" },
  { label: "已抄送", value: 34, color: "text-orange-600 bg-orange-500/10" },
  { label: "超时未办", value: 1, color: "text-rose-600 bg-rose-500/10" },
  { label: "本月新增", value: 23, color: "text-cyan-600 bg-cyan-500/10" },
]

export default function DrawerDemoPage() {
  const [basicOpen, setBasicOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)

  return (
    <div className="space-y-4">
      <PageHeader
        title="侧边抽屉"
        description="基于 Radix Dialog 封装：全屏切换 / 拖拽宽度 / 容器查询响应式内容"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
              <PanelRight className="size-5" />
            </div>
            <div>
              <div className="font-medium">基础抽屉</div>
              <p className="mt-1 text-sm text-muted-foreground">
                拖拽内缘改宽度、全屏切换；内容用容器查询，拖到不同宽度栅格自动重排
              </p>
            </div>
            <Button onClick={() => setBasicOpen(true)}>打开抽屉</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <SquarePen className="size-5" />
            </div>
            <div>
              <div className="font-medium">表单抽屉</div>
              <p className="mt-1 text-sm text-muted-foreground">
                react-hook-form + zod 校验，窄时单列、拖宽或全屏自动两列
              </p>
            </div>
            <Button onClick={() => setFormOpen(true)}>新建任务</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
              <PanelLeft className="size-5" />
            </div>
            <div>
              <div className="font-medium">左侧抽屉</div>
              <p className="mt-1 text-sm text-muted-foreground">
                side=&quot;left&quot; 从左侧弹出，其余能力一致
              </p>
            </div>
            <Button onClick={() => setLeftOpen(true)}>打开抽屉</Button>
          </CardContent>
        </Card>
      </div>

      {/* 基础抽屉：响应式内容演示 */}
      <Drawer
        open={basicOpen}
        onOpenChange={setBasicOpen}
        title="基础抽屉"
        description="拖拽左缘手柄改变宽度，观察下方栅格随宽度重排"
        width={480}
        footer={
          <Button variant="outline" onClick={() => setBasicOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {[
              { icon: GripVertical, text: "按住左缘手柄拖动，实时改变抽屉宽度（320px ~ 视口宽）" },
              { icon: Maximize2, text: "点击标题栏全屏按钮或双击标题栏，宽度平滑过渡到全屏" },
              { icon: LayoutGrid, text: "内容区是 @container 容器，下方卡片按容器宽度自动换列" },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-2.5 rounded-lg border p-3 text-sm">
                <item.icon className="size-4 shrink-0 text-primary" />
                <span className="text-muted-foreground">{item.text}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">审批数据概览</span>
            <Badge variant="secondary" className="text-[10px]">
              @md 两列 · @2xl 三列
            </Badge>
          </div>
          <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
            {approvalStats.map((stat) => (
              <div key={stat.label} className="rounded-lg border p-4">
                <div className={`inline-flex rounded-md px-2 py-1 text-xs ${stat.color}`}>
                  {stat.label}
                </div>
                <div className="mt-2 text-2xl font-semibold">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </Drawer>

      {/* 表单抽屉 */}
      <TaskFormDrawer open={formOpen} onOpenChange={setFormOpen} />

      {/* 左侧抽屉 */}
      <Drawer
        open={leftOpen}
        onOpenChange={setLeftOpen}
        title="左侧抽屉"
        description="side=left · 拖拽右缘手柄改变宽度"
        side="left"
        width={400}
      >
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          从左侧弹出，同样支持拖宽与全屏
        </div>
      </Drawer>
    </div>
  )
}
