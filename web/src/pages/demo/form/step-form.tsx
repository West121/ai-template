import { Fragment, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Check } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

/* ---------- schema ---------- */

const stepSchema = z
  .object({
    // 步骤 1：基本信息
    name: z.string().trim().min(1, "请输入姓名"),
    gender: z.string().min(1, "请选择性别"),
    phone: z.string().regex(/^1[3-9]\d{9}$/, "请输入正确的 11 位手机号"),
    email: z
      .string()
      .refine(
        (v) => v === "" || /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v),
        "邮箱格式不正确"
      ),
    // 步骤 2：岗位信息
    department: z.string().min(1, "请选择部门"),
    position: z.string().trim().min(1, "请输入岗位名称"),
    hireDate: z.string().min(1, "请选择入职日期"),
    probation: z.string().min(1, "请选择试用期"),
    // 步骤 3：账号设置
    account: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{3,19}$/, "以字母开头，4-20 位字母、数字或下划线"),
    password: z
      .string()
      .min(8, "密码至少 8 位")
      .regex(/^(?=.*[A-Za-z])(?=.*\d)/, "密码需同时包含字母和数字"),
    confirmPassword: z.string().min(1, "请再次输入密码"),
  })
  .superRefine((data, ctx) => {
    if (data.confirmPassword && data.confirmPassword !== data.password) {
      ctx.addIssue({
        code: "custom",
        message: "两次输入的密码不一致",
        path: ["confirmPassword"],
      })
    }
  })

type StepFormValues = z.infer<typeof stepSchema>

const DEFAULT_VALUES: StepFormValues = {
  name: "",
  gender: "男",
  phone: "",
  email: "",
  department: "",
  position: "",
  hireDate: "",
  probation: "3",
  account: "",
  password: "",
  confirmPassword: "",
}

const STEPS = ["基本信息", "岗位信息", "账号设置", "确认提交"]

const STEP_FIELDS: Array<Array<keyof StepFormValues>> = [
  ["name", "gender", "phone", "email"],
  ["department", "position", "hireDate", "probation"],
  ["account", "password", "confirmPassword"],
  [],
]

const DEPARTMENTS = ["技术部", "产品部", "人事部", "财务部", "市场部"]

/* ---------- 步骤条 ---------- */

function StepIndicator({ current, done }: { current: number; done: boolean }) {
  return (
    <div className="flex items-center">
      {STEPS.map((title, i) => {
        const completed = done || i < current
        const active = !done && i === current
        return (
          <Fragment key={title}>
            {i > 0 && (
              <div
                className={cn(
                  "mx-3 h-px flex-1",
                  completed ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <div className="flex shrink-0 items-center gap-2">
              <div
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-xs font-medium",
                  completed &&
                    "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !completed && !active && "border-border text-muted-foreground"
                )}
              >
                {completed ? <Check className="size-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-sm",
                  active
                    ? "font-medium text-foreground"
                    : completed
                      ? "text-foreground"
                      : "text-muted-foreground"
                )}
              >
                {title}
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/* ---------- 确认页 ---------- */

function ConfirmSection({
  title,
  rows,
}: {
  title: string
  rows: Array<[string, string]>
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-[6rem_1fr] gap-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <span className="text-muted-foreground">{label}</span>
            <span>{value || "—"}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/* ---------- 主组件 ---------- */

export function StepForm() {
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  const form = useForm<StepFormValues>({
    resolver: zodResolver(stepSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const handleNext = async () => {
    const valid = await form.trigger(STEP_FIELDS[step] ?? [])
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const handlePrev = () => setStep((s) => Math.max(s - 1, 0))

  const onSubmit = (values: StepFormValues) => {
    console.log("员工入职登记提交：", JSON.stringify(values, null, 2))
    toast.success(`员工「${values.name}」入职登记提交成功`)
    setSubmitted(true)
  }

  const handleRestart = () => {
    form.reset(DEFAULT_VALUES)
    setStep(0)
    setSubmitted(false)
  }

  const values = form.getValues()

  return (
    <Card>
      <CardHeader>
        <CardTitle>员工入职登记</CardTitle>
        <CardDescription>
          4 步向导：一个 useForm 管理全部字段，每步通过 form.trigger 做分步校验
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <StepIndicator current={step} done={submitted} />
        <Separator />

        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-7" />
            </div>
            <p className="text-base font-medium">入职登记提交成功</p>
            <p className="text-sm text-muted-foreground">
              数据已输出到控制台，可在 Console 中查看提交的 JSON
            </p>
            <Button variant="outline" onClick={handleRestart}>
              重新填写
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {step === 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
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
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>性别</FormLabel>
                        <FormControl>
                          <RadioGroup
                            className="flex h-9 items-center gap-6"
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="男" id="gender-male" />
                              <Label htmlFor="gender-male" className="font-normal">
                                男
                              </Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value="女" id="gender-female" />
                              <Label htmlFor="gender-female" className="font-normal">
                                女
                              </Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
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
                          <Input placeholder="请输入 11 位手机号" {...field} />
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
                          <Input placeholder="选填，如 name@company.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>部门</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="请选择部门" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {DEPARTMENTS.map((d) => (
                              <SelectItem key={d} value={d}>
                                {d}
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
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>岗位</FormLabel>
                        <FormControl>
                          <Input placeholder="如：前端工程师" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hireDate"
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
                    name="probation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>试用期</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="请选择试用期" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="1">1 个月</SelectItem>
                            <SelectItem value="3">3 个月</SelectItem>
                            <SelectItem value="6">6 个月</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="account"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel required>登录账号</FormLabel>
                        <FormControl>
                          <Input placeholder="请输入登录账号" className="sm:max-w-xs" {...field} />
                        </FormControl>
                        <FormDescription>
                          以字母开头，4-20 位字母、数字或下划线
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>初始密码</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="至少 8 位，含字母和数字"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>确认密码</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="请再次输入密码" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {step === 3 && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <ConfirmSection
                    title="基本信息"
                    rows={[
                      ["姓名", values.name],
                      ["性别", values.gender],
                      ["手机号", values.phone],
                      ["邮箱", values.email],
                    ]}
                  />
                  <ConfirmSection
                    title="岗位信息"
                    rows={[
                      ["部门", values.department],
                      ["岗位", values.position],
                      ["入职日期", values.hireDate],
                      ["试用期", `${values.probation} 个月`],
                    ]}
                  />
                  <ConfirmSection
                    title="账号设置"
                    rows={[
                      ["登录账号", values.account],
                      ["初始密码", "••••••••"],
                    ]}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                {step > 0 && (
                  <Button type="button" variant="outline" onClick={handlePrev}>
                    上一步
                  </Button>
                )}
                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={handleNext}>
                    下一步
                  </Button>
                ) : (
                  <Button type="submit">提交</Button>
                )}
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  )
}
