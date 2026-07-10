import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { AppWindow, ClipboardList, Move, Scaling, SquarePen } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/* ---------- 表单弹窗：react-hook-form + zod ---------- */

const employeeSchema = z.object({
  name: z.string().trim().min(1, "请输入姓名").min(2, "姓名至少 2 个字符"),
  dept: z.string().min(1, "请选择所属部门"),
  phone: z
    .string()
    .min(1, "请输入手机号")
    .regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  email: z.union([z.literal(""), z.string().email("邮箱格式不正确")]),
  joinDate: z.string().min(1, "请选择入职日期"),
  remark: z.string().max(200, "备注不能超过 200 字"),
})

type EmployeeForm = z.infer<typeof employeeSchema>

const DEPTS = ["总裁办", "产品研发部", "市场部", "销售部", "人力资源部", "财务部", "行政部"]

function EmployeeFormModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { name: "", dept: "", phone: "", email: "", joinDate: "", remark: "" },
  })

  const onSubmit = (values: EmployeeForm) => {
    toast.success(`已保存员工「${values.name}」（${values.dept}）`)
    onOpenChange(false)
    form.reset()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) form.reset()
      }}
      title="新增员工"
      description="带 zod 校验的表单弹窗 · 必填项标红星 · 错误提示为 shadcn 风格"
      width={560}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={form.handleSubmit(onSubmit)}>保存</Button>
        </>
      }
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 @md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>姓名</FormLabel>
                <FormControl>
                  <Input placeholder="请输入姓名" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>手机号</FormLabel>
                <FormControl>
                  <Input placeholder="请输入 11 位手机号" maxLength={11} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>邮箱</FormLabel>
                <FormControl>
                  <Input placeholder="选填" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="joinDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>入职日期</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="remark"
            render={({ field }) => (
              <FormItem className="@md:col-span-2">
                <FormLabel>备注</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder="选填，最多 200 字" {...field} />
                </FormControl>
                <FormDescription>直接点击「保存」可查看必填校验的错误提示效果</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Modal>
  )
}

/* ---------- 演示页 ---------- */

const features = [
  { icon: AppWindow, title: "全屏切换", desc: "点击标题栏按钮或双击标题栏，完全全屏，带 300ms 平滑过渡动画" },
  { icon: Move, title: "拖拽移动", desc: "按住标题栏拖动，指针捕获 + 直接写 DOM，全程丝滑不掉帧；全屏时自动禁用" },
  { icon: Scaling, title: "自由伸缩", desc: "右缘 / 下缘 / 右下角三向伸缩，支持最小尺寸约束，左上缘保持锚定" },
]

export default function ModalDemoPage() {
  const [basicOpen, setBasicOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)

  return (
    <div className="space-y-4">
      <PageHeader
        title="高级弹窗"
        description="基于 Radix Dialog 封装：全屏切换 / 拖拽移动 / 自由伸缩 / 表单校验"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
              <AppWindow className="size-5" />
            </div>
            <div>
              <div className="font-medium">基础弹窗</div>
              <p className="mt-1 text-sm text-muted-foreground">
                拖拽移动、三向伸缩、全屏切换（按钮或双击标题栏）
              </p>
            </div>
            <Button onClick={() => setBasicOpen(true)}>打开弹窗</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <SquarePen className="size-5" />
            </div>
            <div>
              <div className="font-medium">表单弹窗</div>
              <p className="mt-1 text-sm text-muted-foreground">
                react-hook-form + zod 校验，必填项 <span className="text-destructive">*</span>{" "}
                标记，shadcn 风格错误提示
              </p>
            </div>
            <Button onClick={() => setFormOpen(true)}>新增员工</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
              <ClipboardList className="size-5" />
            </div>
            <div>
              <div className="font-medium">自定义配置</div>
              <p className="mt-1 text-sm text-muted-foreground">
                大尺寸 + 固定高度 + 遮罩不可关闭，禁用伸缩
              </p>
            </div>
            <Button onClick={() => setCustomOpen(true)}>打开弹窗</Button>
          </CardContent>
        </Card>
      </div>

      {/* 基础弹窗 */}
      <Modal
        open={basicOpen}
        onOpenChange={setBasicOpen}
        title="基础弹窗"
        description="试试拖拽标题栏、拉伸右下角、点击全屏按钮"
        footer={
          <>
            <Button variant="outline" onClick={() => setBasicOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                toast.success("已确定")
                setBasicOpen(false)
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {features.map((feature) => (
            <div key={feature.title} className="flex gap-3 rounded-lg border p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <feature.icon className="size-4.5" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {feature.title}
                  <Badge variant="secondary" className="text-[10px]">内置</Badge>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* 表单弹窗 */}
      <EmployeeFormModal open={formOpen} onOpenChange={setFormOpen} />

      {/* 自定义配置 */}
      <Modal
        open={customOpen}
        onOpenChange={setCustomOpen}
        title="自定义配置弹窗"
        description="width=860 height=480 · resizable=false · maskClosable=false"
        width={860}
        height={480}
        resizable={false}
        maskClosable={false}
        footer={
          <Button variant="outline" onClick={() => setCustomOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground">
          <ClipboardList className="size-10 opacity-30" />
          <p className="text-sm">固定 860 × 480，点击遮罩不会关闭，仍可拖拽与全屏</p>
        </div>
      </Modal>
    </div>
  )
}
