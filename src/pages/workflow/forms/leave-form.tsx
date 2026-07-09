/**
 * 请假申请表单（CODE 示范）—— 手写 react-hook-form 表单登记进 registry，证明 CODE 路径通。
 *
 * 演示设计文档第二部分 2.4 的约定：
 *  - 组件接收 `HostedFormComponentProps`（formData / fieldPolicy / onChange）。
 *  - 逐字段用 `fieldStateOf(fieldPolicy, key)` 派生渲染态：
 *      hidden → 不渲染；disabled → 字段只读；required → 注入必填校验（rules.required）。
 *  - 组件旁静态导出 `formMeta: FormFieldManifest` 并 `registerForm('leave', …)`。
 *
 * manifest 的字段 `key` 必须与 useForm 字段名对齐。
 */
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { fieldStateOf, type FormFieldManifest } from "@/lib/form-manifest"
import { registerForm, type HostedFormComponentProps } from "@/lib/form-registry"

/** CODE 表单标识；与 registry key、后端 defCode/formCode 约定一致。 */
export const LEAVE_FORM_KEY = "leave"

/** 静态字段清单：与下方 useForm 字段名逐一对齐。 */
export const formMeta: FormFieldManifest = {
  formKey: LEAVE_FORM_KEY,
  formType: "CODE",
  fields: [
    { key: "applicant", label: "申请人", type: "input", group: "基础信息", required: true },
    { key: "days", label: "请假天数", type: "number", group: "请假信息", required: true },
    { key: "reason", label: "请假事由", type: "textarea", group: "请假信息", required: true },
    { key: "remark", label: "备注", type: "input", group: "请假信息" },
  ],
}

interface LeaveFormValues {
  applicant: string
  days: string
  reason: string
  remark: string
}

function toValues(data: Record<string, unknown>): LeaveFormValues {
  return {
    applicant: typeof data.applicant === "string" ? data.applicant : "",
    days: data.days == null ? "" : String(data.days),
    reason: typeof data.reason === "string" ? data.reason : "",
    remark: typeof data.remark === "string" ? data.remark : "",
  }
}

export function LeaveForm({ formData, fieldPolicy, onChange }: HostedFormComponentProps) {
  const form = useForm<LeaveFormValues>({ defaultValues: toValues(formData), mode: "onTouched" })

  // 值变化向上抛出（包裹层 onChange 契约）
  const { watch } = form
  useEffect(() => {
    const sub = watch((values) => onChange?.({ ...values }))
    return () => sub.unsubscribe()
  }, [watch, onChange])

  const st = (key: string) => fieldStateOf(fieldPolicy, key)

  return (
    <Form {...form}>
      <form className="space-y-4">
        {!st("applicant").hidden && (
          <FormField
            control={form.control}
            name="applicant"
            rules={{ required: st("applicant").required ? "请输入申请人" : false }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>申请人{st("applicant").required && <span className="text-destructive"> *</span>}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={st("applicant").disabled} placeholder="请输入申请人" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {!st("days").hidden && (
          <FormField
            control={form.control}
            name="days"
            rules={{
              required: st("days").required ? "请输入请假天数" : false,
              pattern: { value: /^\d+(\.\d)?$/, message: "请输入天数（最多一位小数）" },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>请假天数{st("days").required && <span className="text-destructive"> *</span>}</FormLabel>
                <FormControl>
                  <Input {...field} type="number" disabled={st("days").disabled} placeholder="如 3" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {!st("reason").hidden && (
          <FormField
            control={form.control}
            name="reason"
            rules={{ required: st("reason").required ? "请填写请假事由" : false }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>请假事由{st("reason").required && <span className="text-destructive"> *</span>}</FormLabel>
                <FormControl>
                  <Textarea {...field} disabled={st("reason").disabled} placeholder="请填写请假事由" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {!st("remark").hidden && (
          <FormField
            control={form.control}
            name="remark"
            rules={{ required: st("remark").required ? "请填写备注" : false }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>备注{st("remark").required && <span className="text-destructive"> *</span>}</FormLabel>
                <FormControl>
                  <Input {...field} disabled={st("remark").disabled} placeholder="选填" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </form>
    </Form>
  )
}

// 登记进 registry（模块加载即执行；由 forms/index.ts 统一 import 触发）。
registerForm(LEAVE_FORM_KEY, { component: LeaveForm, manifest: formMeta })
