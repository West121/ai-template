import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

/* ---------- schema ---------- */

const LEAVE_TYPES = ["年假", "事假", "病假", "调休"]

const leaveSchema = z
  .object({
    type: z.string().min(1, "请选择请假类型"),
    startDate: z.string().min(1, "请选择开始日期"),
    endDate: z.string().min(1, "请选择结束日期"),
    days: z
      .string()
      .regex(/^\d+(\.\d)?$/, "请输入有效天数（最多一位小数）")
      .refine((v) => Number(v) > 0, "请假天数须大于 0"),
    reason: z.string().trim().min(1, "请填写请假事由"),
    proof: z.string(),
    approver: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: "custom",
        message: "结束日期不能早于开始日期",
        path: ["endDate"],
      })
    }
    // 联动 1：病假必须填写证明说明
    if (data.type === "病假" && !data.proof.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "病假需填写病假证明说明",
        path: ["proof"],
      })
    }
    // 联动 2：超过 3 天必须选择加签审批人
    if (Number(data.days) > 3 && !data.approver) {
      ctx.addIssue({
        code: "custom",
        message: "请假超过 3 天需选择加签审批人",
        path: ["approver"],
      })
    }
  })

type LeaveFormValues = z.infer<typeof leaveSchema>

const DEFAULT_VALUES: LeaveFormValues = {
  type: "",
  startDate: "",
  endDate: "",
  days: "1",
  reason: "",
  proof: "",
  approver: "",
}

/* ---------- 主组件 ---------- */

export function DynamicForm() {
  const form = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveSchema),
    defaultValues: DEFAULT_VALUES,
  })

  // watch 驱动的动态联动
  const watchType = form.watch("type")
  const watchDays = form.watch("days")
  const isSickLeave = watchType === "病假"
  const daysNumber = Number(watchDays)
  const needExtraApprover = Number.isFinite(daysNumber) && daysNumber > 3

  const onSubmit = (values: LeaveFormValues) => {
    const payload = { ...values, days: Number(values.days) }
    console.log("请假申请提交：", JSON.stringify(payload, null, 2))
    toast.success(`请假申请提交成功（${values.type} ${values.days} 天）`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>请假申请</CardTitle>
        <CardDescription>
          watch + superRefine 条件校验：字段随请假类型 / 天数动态出现并变为必填
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>请假类型</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="请选择请假类型" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {LEAVE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
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
                  name="days"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>请假天数</FormLabel>
                      <FormControl>
                        <Input placeholder="如：1 或 2.5" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>开始日期</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>结束日期</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>请假事由</FormLabel>
                    <FormControl>
                      <Textarea placeholder="请简要说明请假事由" rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 联动 1：病假 → 病假证明说明 */}
              {isSickLeave && (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <FormField
                    control={form.control}
                    name="proof"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>病假证明说明</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="请说明病假证明情况，如：已附三甲医院诊断证明"
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          因请假类型为「病假」，此字段动态出现且必填
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* 联动 2：天数 > 3 → 加签审批人 */}
              {needExtraApprover && (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <FormField
                    control={form.control}
                    name="approver"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>加签审批人</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-full sm:max-w-xs">
                              <SelectValue placeholder="请选择加签审批人" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="总经理">总经理</SelectItem>
                            <SelectItem value="副总经理">副总经理</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          因请假天数超过 3 天，需加签上级审批
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => form.reset(DEFAULT_VALUES)}
                >
                  重置
                </Button>
                <Button type="submit">提交申请</Button>
              </div>
            </form>
          </Form>

          {/* 联动状态面板：演示 watch 的响应式 */}
          <div className="h-fit rounded-md border bg-muted/30 p-4">
            <h3 className="mb-3 text-sm font-medium">当前联动状态</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">请假类型</span>
                <span>{watchType || "未选择"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">请假天数</span>
                <span className="font-mono">{watchDays || "—"}</span>
              </div>
            </div>
            <Separator className="my-3" />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  病假 → 需填写证明说明
                </span>
                <Badge variant={isSickLeave ? "default" : "outline"}>
                  {isSickLeave ? "已激活" : "未激活"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  天数 &gt; 3 → 需加签审批人
                </span>
                <Badge variant={needExtraApprover ? "default" : "outline"}>
                  {needExtraApprover ? "已激活" : "未激活"}
                </Badge>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              以上状态由 form.watch 实时驱动，规则激活时表单中会动态出现对应必填字段。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
