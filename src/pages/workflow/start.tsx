import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
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
import { BackendDownCard } from "@/pages/approval/shared"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/stores/auth-store"
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

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<WfStartableDef[]>("/api/wf/startable")
      setDefs(Array.isArray(data) ? data : [])
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  // 打开发起弹窗：拉最新表单定义。CUSTOM 表单跳自定义发起页（React 路由），不弹动态表单。
  const openStart = useCallback((def: WfStartableDef) => {
    if (def.formType === "CUSTOM") {
      if (def.formSubmitPath) {
        navigate(def.formSubmitPath)
      } else {
        toast.error(`「${def.name}」为自定义表单但未配置发起页路径`)
      }
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
          err instanceof NetworkError ? "无法连接后端服务" : err instanceof Error ? err.message : "表单加载失败",
        )
      })
      .finally(() => setFormLoading(false))
  }, [navigate])

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
        toast.success(`「${active.name}」已提交`)
        setActive(null)
        navigate("/workflow/tasks?tab=mine")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "提交失败")
      } finally {
        setSubmitting(false)
      }
    },
    [active, title, navigate],
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
        toast.success(`「${active.name}」已暂存至草稿箱`)
        setActive(null)
        navigate("/workflow/tasks?tab=draft")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "暂存失败")
      } finally {
        setSavingDraft(false)
      }
    },
    [active, title, navigate],
  )

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
      const category = def.category?.trim() || "其他"
      const list = map.get(category) ?? []
      list.push(def)
      map.set(category, list)
    }
    return [...map.entries()]
  }, [defs, keyword])

  return (
    <div className="space-y-4">
      <PageHeader
        title="发起申请"
        description={
          loadError === "network"
            ? "后端未连接——启动 server/ 后此页展示可发起的流程卡片墙"
            : "选择流程类型发起申请，提交后按流程定义自动流转审批"
        }
        actions={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索流程名称 / 分类"
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
              重试
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
            <span className="text-sm">{keyword ? "没有匹配的流程" : "暂无可发起的流程"}</span>
            <span className="text-xs text-muted-foreground/70">
              {keyword ? "换个关键词试试" : "请先在「流程定义」中发布流程"}
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
                          {def.remark || `发起「${def.name}」流程`}
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
        title={active ? `发起：${active.name}` : "发起申请"}
        description={active?.remark || "填写表单后提交，将按流程定义自动流转"}
        width={640}
      >
        {formLoading ? (
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
              重试
            </Button>
          </div>
        ) : formSchema ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">标题</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`选填，默认为「${active?.name ?? ""}」加发起人`}
              />
            </div>
            <FormRenderer
              key={active?.defCode}
              widgets={formSchema.widgets}
              submitting={submitting}
              savingDraft={savingDraft}
              submitLabel="提交申请"
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
