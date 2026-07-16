import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  CalendarDays,
  Car,
  Coins,
  FileSignature,
  FileText,
  Laptop,
  Plane,
  Receipt,
  Search,
  ShieldAlert,
  ShoppingCart,
  Stamp,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError } from "@/lib/api"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { FormRenderer } from "@/components/form-renderer"
import { HostedForm } from "@/components/hosted-form"
import { isCodeForm, type HostedFormHandle } from "@/lib/form-registry"
import { normalizeFormType } from "@/pages/workflow/designer/types"
import "@/pages/workflow/forms" // 触发 CODE 表单登记（registerForm 副作用），供内嵌渲染
import { BackendDownCard } from "@/pages/approval/shared"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/stores/auth-store"
import { fetchMineFieldPerms, intersectFieldPolicy, intersectFormPerms, type MineFieldPerms } from "@/lib/field-perms"
import {
  parseFormSchema,
  type FormSchema,
  type WfFormData,
  type WfFormDef,
  type WfStartableDef,
} from "@/types/workflow"

/** 后端 icon 标识 → lucide 图标；不认识的回退 FileText */
const ICON_MAP: Record<string, LucideIcon> = {
  leave: CalendarDays,
  calendar: CalendarDays,
  expense: Receipt,
  receipt: Receipt,
  trip: Plane,
  travel: Plane,
  plane: Plane,
  overtime: Timer,
  timer: Timer,
  purchase: ShoppingCart,
  cart: ShoppingCart,
  seal: Stamp,
  stamp: Stamp,
  contract: FileSignature,
  hr: Users,
  users: Users,
  finance: Coins,
  coins: Coins,
  it: Laptop,
  laptop: Laptop,
  car: Car,
}

function iconOf(icon?: string): LucideIcon {
  if (!icon) return FileText
  return ICON_MAP[icon.toLowerCase()] ?? FileText
}

export default function WorkflowStartPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const [defs, setDefs] = useState<WfStartableDef[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState("")

  // 发起弹窗
  const [active, setActive] = useState<WfStartableDef | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null)
  const [title, setTitle] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  // CODE 表单内嵌渲染（无自定义发起页时）：数据 + 受控提交句柄
  const [codeData, setCodeData] = useState<WfFormData>({})
  const codeFormRef = useRef<HostedFormHandle>(null)
  // 角色级字段权限（P3）：发起表单按 mine 过滤（visible=false 不渲染 / editable=false 只读）
  const [mineFieldPerms, setMineFieldPerms] = useState<MineFieldPerms>({})
  useEffect(() => {
    let alive = true
    void fetchMineFieldPerms("WORKFLOW_START").then((m) => {
      if (alive) setMineFieldPerms(m)
    })
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<WfStartableDef[]>("/api/wf/startable")
      setDefs(Array.isArray(data) ? data : [])
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : t("加载失败"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  // 打开发起弹窗。CODE（代码表单）：有 formSubmitPath → navigate 跳自定义发起页（如公文拟稿单）；
  // 无发起页但已登记手写组件 → 内嵌 HostedForm 渲染。ONLINE：拉最新 schema 弹动态表单。
  const openStart = useCallback((def: WfStartableDef) => {
    if (normalizeFormType(def.formType) === "CODE") {
      if (def.formSubmitPath) {
        navigate(def.formSubmitPath)
        return
      }
      if (def.formCode && isCodeForm(def.formCode)) {
        setActive(def)
        setTitle("")
        setCodeData({})
        setFormSchema(null)
        setFormError(null)
        setFormLoading(false)
        return
      }
      toast.error(t("「{{name}}」为代码表单，但既未配置发起页，也未在前端登记表单组件", { name: def.name }))
      return
    }
    setActive(def)
    setTitle("")
    setFormSchema(null)
    setFormError(null)
    setFormLoading(true)
    api<WfFormDef>(`/api/wf/form-defs/${def.formCode ?? def.defCode}/latest`)
      .then((formDef) => setFormSchema(parseFormSchema(formDef.schemaJson)))
      .catch((err) => {
        setFormError(
          err instanceof NetworkError ? t("无法连接后端服务") : err instanceof Error ? err.message : t("表单加载失败"),
        )
      })
      .finally(() => setFormLoading(false))
  }, [navigate, t])

  const submit = useCallback(
    async (formData: WfFormData) => {
      if (!active) return
      setSubmitting(true)
      try {
        await api("/api/wf/instances", {
          method: "POST",
          body: JSON.stringify({
            defCode: active.defCode,
            formData,
            title: title.trim() || undefined,
          }),
        })
        toast.success(t("「{{name}}」已提交", { name: active.name }))
        setActive(null)
        navigate("/workflow/tasks?tab=mine")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("提交失败"))
      } finally {
        setSubmitting(false)
      }
    },
    [active, title, navigate, t],
  )

  // 暂存草稿：不校验，存入 DRAFT 不启动引擎
  const saveDraft = useCallback(
    async (formData: WfFormData) => {
      if (!active) return
      setSavingDraft(true)
      try {
        await api("/api/wf/instances/draft", {
          method: "POST",
          body: JSON.stringify({
            defCode: active.defCode,
            formData,
            title: title.trim() || undefined,
          }),
        })
        toast.success(t("「{{name}}」已暂存至草稿箱", { name: active.name }))
        setActive(null)
        navigate("/workflow/tasks?tab=draft")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("暂存失败"))
      } finally {
        setSavingDraft(false)
      }
    },
    [active, title, navigate, t],
  )

  // CODE 表单内嵌提交：经受控句柄校验 + 取值，复用 submit（POST /api/wf/instances）
  const submitCode = useCallback(async () => {
    if (!active) return
    const ok = (await codeFormRef.current?.validate()) ?? true
    if (!ok) return
    await submit(codeFormRef.current?.getValues() ?? codeData)
  }, [active, codeData, submit])

  const codeEmbed = active != null && normalizeFormType(active.formType) === "CODE"

  // 按分类分组 + 关键字过滤
  const groups = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const filtered = kw
      ? defs.filter(
          (d) =>
            d.name.toLowerCase().includes(kw) ||
            (d.category ?? "").toLowerCase().includes(kw) ||
            (d.remark ?? "").toLowerCase().includes(kw),
        )
      : defs
    const map = new Map<string, WfStartableDef[]>()
    for (const def of filtered) {
      const category = def.category?.trim() || t("其他")
      const list = map.get(category) ?? []
      list.push(def)
      map.set(category, list)
    }
    return [...map.entries()]
  }, [defs, keyword, t])

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("发起申请")}
        description={
          loadError === "network"
            ? t("后端未连接——启动 server/ 后此页展示可发起的流程卡片墙")
            : t("选择流程类型发起申请，提交后按流程定义自动流转审批")
        }
        actions={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t("搜索流程名称 / 分类")}
              className="h-9 w-56 pl-8"
            />
          </div>
        }
      />

      {loadError === "network" ? (
        <BackendDownCard onRetry={() => void load()} />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t("重试")}
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
            <FileText className="size-10 opacity-30" />
            <span className="text-sm">{keyword ? t("没有匹配的流程") : t("暂无可发起的流程")}</span>
            <span className="text-xs text-muted-foreground/70">
              {keyword ? t("换个关键词试试") : t("请先在「流程定义」中发布流程")}
            </span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([category, list]) => (
            <section key={category}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="text-sm font-medium">{category}</span>
                <span className="text-xs text-muted-foreground">({list.length})</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map((def) => {
                  const Icon = iconOf(def.icon)
                  return (
                    <button
                      key={def.defCode}
                      type="button"
                      onClick={() => openStart(def)}
                      className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{def.name}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {def.remark || t("发起「{{name}}」流程", { name: def.name })}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* 发起弹窗：动态表单 */}
      <Modal
        open={!!active}
        onOpenChange={(open) => {
          if (!open && !submitting && !savingDraft) setActive(null)
        }}
        title={active ? t("发起：{{name}}", { name: active.name }) : t("发起申请")}
        description={active?.remark || t("填写表单后提交，将按流程定义自动流转")}
        width={640}
      >
        {codeEmbed && active ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">{t("标题")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("选填，默认为「{{name}}」加发起人", { name: active.name })}
              />
            </div>
            <HostedForm
              key={active.defCode}
              formKey={active.formCode ?? active.defCode}
              formData={codeData}
              fieldPolicy={intersectFieldPolicy(undefined, mineFieldPerms)}
              onChange={setCodeData}
              formRef={codeFormRef}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActive(null)} disabled={submitting}>
                {t("取消")}
              </Button>
              <Button onClick={() => void submitCode()} disabled={submitting}>
                {submitting ? t("提交中…") : t("提交申请")}
              </Button>
            </div>
          </div>
        ) : formLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        ) : formError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm text-muted-foreground">{formError}</div>
            <Button size="sm" variant="outline" onClick={() => active && openStart(active)}>
              {t("重试")}
            </Button>
          </div>
        ) : formSchema ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">{t("标题")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("选填，默认为「{{name}}」加发起人", { name: active?.name ?? "" })}
              />
            </div>
            <FormRenderer
              key={active?.defCode}
              widgets={formSchema.widgets}
              perms={intersectFormPerms(undefined, mineFieldPerms)}
              submitting={submitting}
              savingDraft={savingDraft}
              submitLabel={t("提交申请")}
              onSubmit={submit}
              onSaveDraft={saveDraft}
              onCancel={() => setActive(null)}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
