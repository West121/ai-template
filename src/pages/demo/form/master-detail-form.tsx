import { zodResolver } from "@hookform/resolvers/zod"
import { useFieldArray, useForm } from "react-hook-form"
import { z } from "zod"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

/* ---------- schema ---------- */

const rowSchema = z.object({
  name: z.string().trim().min(1, "请输入物品名称"),
  spec: z.string(),
  qty: z.string().regex(/^[1-9]\d*$/, "请输入正整数"),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "请输入金额，最多两位小数")
    .refine((v) => Number(v) > 0, "单价须大于 0"),
})

const purchaseSchema = z.object({
  department: z.string().min(1, "请选择申请部门"),
  applicant: z.string().trim().min(1, "请输入申请人"),
  expectedDate: z.string().min(1, "请选择期望到货日期"),
  purpose: z.string().trim().min(1, "请填写采购用途"),
  items: z.array(rowSchema).min(1, "至少一条明细"),
})

type PurchaseFormValues = z.infer<typeof purchaseSchema>

const EMPTY_ROW: PurchaseFormValues["items"][number] = {
  name: "",
  spec: "",
  qty: "1",
  price: "",
}

const DEFAULT_VALUES: PurchaseFormValues = {
  department: "",
  applicant: "",
  expectedDate: "",
  purpose: "",
  items: [{ ...EMPTY_ROW }],
}

const DEPARTMENTS = ["技术部", "产品部", "人事部", "财务部", "行政部"]

const formatMoney = (n: number) =>
  n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/* ---------- 主组件 ---------- */

export function MasterDetailForm() {
  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  // watch 所有明细行，实时计算金额与合计
  const watchedItems = form.watch("items")

  const rowAmount = (index: number) => {
    const row = watchedItems?.[index]
    if (!row) return 0
    const amount = Number(row.qty) * Number(row.price)
    return Number.isFinite(amount) ? amount : 0
  }

  const total = (watchedItems ?? []).reduce(
    (sum, _row, index) => sum + rowAmount(index),
    0
  )

  const onSubmit = (values: PurchaseFormValues) => {
    const payload = {
      ...values,
      items: values.items.map((item) => ({
        ...item,
        qty: Number(item.qty),
        price: Number(item.price),
        amount: Number(item.qty) * Number(item.price),
      })),
      total,
    }
    console.log("采购申请单提交：", JSON.stringify(payload, null, 2))
    toast.success(`采购申请单提交成功，合计 ¥${formatMoney(total)}`)
  }

  const itemsError =
    form.formState.errors.items?.root?.message ??
    form.formState.errors.items?.message

  return (
    <Card>
      <CardHeader>
        <CardTitle>采购申请单</CardTitle>
        <CardDescription>
          主表 + useFieldArray 子表明细：行内校验、金额实时计算、合计汇总
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* 主表区 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>申请部门</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="请选择申请部门" />
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
                name="applicant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>申请人</FormLabel>
                    <FormControl>
                      <Input placeholder="请输入申请人姓名" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expectedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>期望到货日期</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="purpose"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel required>采购用途</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="请简要说明采购用途"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* 子表明细 */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">采购明细</h3>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-40">
                        <span className="text-destructive">*</span> 物品名称
                      </TableHead>
                      <TableHead className="min-w-32">规格型号</TableHead>
                      <TableHead className="w-24">
                        <span className="text-destructive">*</span> 数量
                      </TableHead>
                      <TableHead className="w-32">
                        <span className="text-destructive">*</span> 单价(元)
                      </TableHead>
                      <TableHead className="w-32 text-right">金额(元)</TableHead>
                      <TableHead className="w-16 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((row, index) => (
                      <TableRow key={row.id}>
                        <TableCell className="align-top">
                          <FormField
                            control={form.control}
                            name={`items.${index}.name`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input placeholder="物品名称" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <FormField
                            control={form.control}
                            name={`items.${index}.spec`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input placeholder="选填" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <FormField
                            control={form.control}
                            name={`items.${index}.qty`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input placeholder="数量" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <FormField
                            control={form.control}
                            name={`items.${index}.price`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input placeholder="0.00" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <span className="inline-flex h-9 items-center font-mono text-sm">
                            {formatMoney(rowAmount(index))}
                          </span>
                        </TableCell>
                        <TableCell className="text-center align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={fields.length <= 1}
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">删除本行</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {itemsError && (
                <p className="text-sm text-destructive">{itemsError}</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ ...EMPTY_ROW })}
                >
                  <Plus className="size-4" />
                  添加明细
                </Button>
                <p className="text-sm">
                  合计：
                  <span className="font-mono text-base font-semibold">
                    ¥{formatMoney(total)}
                  </span>
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex justify-end gap-2">
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
      </CardContent>
    </Card>
  )
}
