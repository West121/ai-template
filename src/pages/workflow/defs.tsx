/**
 * 流程定义管理 /workflow/defs
 * 列表 + 新建（选设计器类型：仿钉钉/流程图 + 绑定已发布表单）+ 发布 + 版本历史 + 穿越补审。
 * 设计器改独立整页路由（/workflow/defs/:code/design，新建 /workflow/defs/new），
 *   列表「编辑/设计」`navigate()` 跳页而非弹全屏 Modal（见 designer-page.tsx）。
 * GRAPH（流程图）走 react-flow 设计器，部署经 POST /api/wf/models/graph/deploy；
 * 仿钉钉（DINGTALK）并存保留；存量 BPMN 定义编辑时经 /api/wf/models/import 迁移为 GRAPH。
 * 接口：GET /api/wf/process-defs、POST /{id}/publish（后端转换/部署，展示报错）、GET /{code}/versions
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { CalendarClock, CloudOff, FlaskConical, GitBranch, History, Pencil, Plus, RotateCw, Send, Workflow } from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Drawer } from "@/components/drawer"
import { Modal } from "@/components/modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ProcessModel } from "@/pages/workflow/designer/flow/model"
import { deserializeDingtalk, isBackendDesignerJson } from "@/pages/workflow/designer/dingtalk/serialize"
import { hasBlockingIssue, validateFlow, type ValidationIssue } from "@/pages/workflow/designer/shared/validate"
import { FormRenderer } from "@/components/form-renderer"
import { parseFormSchema, type FormWidget as WfFormWidget, type WfFormData } from "@/types/workflow"
import {
  WF_STATUS_META,
  type DesignerType,
  type FormDefItem,
  type FormType,
  type ProcessDefItem,
} from "@/pages/workflow/designer/types"

/** GET /api/wf/forms/code：已登记 CODE（代码）表单，供流程定义绑定下拉 */
interface CodeFormItem {
  formKey: string
  name: string
  fieldCount?: number
}

const DESIGNER_META: Record<DesignerType, { label: string; description: string; icon: typeof Workflow }> = {
  DINGTALK: { label: "仿钉钉（简易）", description: "线性步骤 + 条件分支，适合审批场景，零门槛配置", icon: GitBranch },
  GRAPH: { label: "流程图（专业）", description: "react-flow 图设计器，支持网关/子流程/定时/脚本等复杂结构", icon: Workflow },
  // 旧 bpmn-js 设计器已下线；存量 BPMN 定义编辑时经 /api/wf/models/import 迁移为 GRAPH。
  BPMN: { label: "BPMN（旧）", description: "旧版设计器已下线，编辑时自动迁移为流程图", icon: Workflow },
}

/** 新建时可选的设计器类型（BPMN 旧设计器已下线，不再提供入口） */
const CREATE_DESIGNER_TYPES: DesignerType[] = ["DINGTALK", "GRAPH"]

/** 解析存储的 designerJson（字符串或对象）为 ProcessModel；非法/空返回 null */
function parseGraphModel(raw: unknown): ProcessModel | null {
  if (raw == null) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (obj && typeof obj === "object" && Array.isArray((obj as { nodes?: unknown }).nodes)) {
      return obj as ProcessModel
    }
    return null
  } catch {
    return null
  }
}

export default function WorkflowDefsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ProcessDefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"network" | string | null>(null)

  // 后端搜索 + 后端分页
  const [keyword, setKeyword] = useState("")
  const [pageNum, setPageNum] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)

  const [publishedForms, setPublishedForms] = useState<FormDefItem[]>([])
  const [codeForms, setCodeForms] = useState<CodeFormItem[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    defCode: "",
    name: "",
    category: "",
    designerType: "DINGTALK" as DesignerType,
    formType: "ONLINE" as FormType,
    formCode: "",
    formSubmitPath: "",
    formViewPath: "",
  })

  // 发布确认（列表行「发布」）
  const [publishIssues, setPublishIssues] = useState<ValidationIssue[]>([])
  const [publishTarget, setPublishTarget] = useState<ProcessDefItem | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const [versionsFor, setVersionsFor] = useState<ProcessDefItem | null>(null)
  const [versions, setVersions] = useState<ProcessDefItem[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  // 穿越时空补审：指定业务日期发起，审批记录时间记为该日期
  const [ttTarget, setTtTarget] = useState<ProcessDefItem | null>(null)
  const [ttWidgets, setTtWidgets] = useState<WfFormWidget[]>([])
  const [ttDate, setTtDate] = useState("")
  const [ttLoading, setTtLoading] = useState(false)
  const [ttSubmitting, setTtSubmitting] = useState(false)

  const load = useCallback(async (kw: string, pn: number, ps: number) => {
    setLoading(true)
    setLoadError(null)
    try {
      const query = `keyword=${encodeURIComponent(kw)}&pageNum=${pn}&pageSize=${ps}`
      const page = await api<PageResult<ProcessDefItem>>(`/api/wf/process-defs?${query}`)
      setRows(page.list)
      setTotal(page.total)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  const reload = useCallback(() => void load(keyword, pageNum, pageSize), [load, keyword, pageNum, pageSize])

  const loadForms = useCallback(async () => {
    try {
      const page = await api<PageResult<FormDefItem>>("/api/wf/form-defs?pageNum=1&pageSize=100")
      setPublishedForms(page.list.filter((f) => f.status === "PUBLISHED"))
    } catch {
      setPublishedForms([])
    }
  }, [])

  // 已登记 CODE 表单列表（绑定「代码表单」下拉用）；后端未就绪则降级空
  const loadCodeForms = useCallback(async () => {
    try {
      setCodeForms(await api<CodeFormItem[]>("/api/wf/forms/code"))
    } catch {
      setCodeForms([])
    }
  }, [])

  useEffect(() => {
    void loadForms()
    void loadCodeForms()
  }, [loadForms, loadCodeForms])

  // 关键词/分页变化时查后端（关键词防抖 250ms）
  useEffect(() => {
    const timer = setTimeout(() => void load(keyword, pageNum, pageSize), keyword ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, keyword, pageNum, pageSize])

  const startCreate = () => {
    setCreateForm({
      defCode: "",
      name: "",
      category: "",
      designerType: "DINGTALK",
      formType: "ONLINE",
      formCode: "",
      formSubmitPath: "",
      formViewPath: "",
    })
    setCreateOpen(true)
  }

  /** 新建：校验后跳独立设计页（/workflow/defs/new?...），首次保存草稿由设计页 replace 到带 code 的 URL */
  const confirmCreate = () => {
    if (!createForm.defCode.trim() || !createForm.name.trim()) {
      toast.error("请填写流程名称与编码")
      return
    }
    if (createForm.formType === "CODE" && !createForm.formCode) {
      toast.error("请选择一个已登记的代码表单")
      return
    }
    const params = new URLSearchParams()
    params.set("type", createForm.designerType)
    params.set("code", createForm.defCode.trim())
    params.set("name", createForm.name.trim())
    if (createForm.category.trim()) params.set("category", createForm.category.trim())
    params.set("formType", createForm.formType)
    // ONLINE 与 CODE 都绑 formCode（ONLINE=在线表单 code / CODE=代码表单 formKey）
    if (createForm.formCode) params.set("formCode", createForm.formCode)
    if (createForm.formType === "CODE") {
      if (createForm.formSubmitPath.trim()) params.set("formSubmitPath", createForm.formSubmitPath.trim())
      if (createForm.formViewPath.trim()) params.set("formViewPath", createForm.formViewPath.trim())
    }
    setCreateOpen(false)
    navigate(`/workflow/defs/new?${params.toString()}`)
  }

  /** 编辑 / 设计：跳独立整页设计器 */
  const openDesign = (row: ProcessDefItem) => navigate(`/workflow/defs/${row.defCode}/design`)

  /** 实验入口：把仿钉钉旧定义用新流程图设计器打开（?as=graph 由设计页迁移） */
  const openInNewDesigner = (row: ProcessDefItem) =>
    navigate(`/workflow/defs/${row.defCode}/design?as=graph`)

  /** 打开发布确认：DINGTALK 现解析跑前端校验；GRAPH 交后端把关 */
  const openPublish = (target: ProcessDefItem) => {
    let issues: ValidationIssue[] = []
    if (target.designerType === "DINGTALK" && target.designerJson) {
      try {
        const parsed = typeof target.designerJson === "string" ? JSON.parse(target.designerJson) : target.designerJson
        if (isBackendDesignerJson(parsed)) {
          const d = deserializeDingtalk(parsed)
          issues = validateFlow(d.steps, d.nodeProps)
        }
      } catch {
        /* 无法解析则跳过前端校验，交后端把关 */
      }
    }
    setPublishIssues(issues)
    setPublishError(null)
    setPublishTarget(target)
  }

  const doPublish = async () => {
    if (!publishTarget) return
    if (hasBlockingIssue(publishIssues)) {
      toast.error("存在校验错误，请先修正后再发布")
      return
    }
    setPublishing(true)
    setPublishError(null)
    try {
      if (publishTarget.designerType === "GRAPH") {
        const model = parseGraphModel(publishTarget.designerJson)
        if (!model) {
          setPublishError("流程模型解析失败（designerJson 为空或非法），请重新保存草稿")
          return
        }
        const body: Record<string, unknown> = {
          key: publishTarget.defCode,
          name: publishTarget.name,
          category: publishTarget.category || undefined,
          icon: publishTarget.icon || undefined,
          formCode: publishTarget.formCode || undefined,
          formVersion: publishTarget.formVersion ?? undefined,
          model,
        }
        await api("/api/wf/models/graph/deploy", { method: "POST", body: JSON.stringify(body) })
      } else {
        await api(`/api/wf/process-defs/${publishTarget.id}/publish`, { method: "POST" })
      }
      toast.success(`流程「${publishTarget.name}」已发布，可到发起中心发起`)
      setPublishTarget(null)
      reload()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "发布失败")
    } finally {
      setPublishing(false)
    }
  }

  const openVersions = async (row: ProcessDefItem) => {
    setVersionsFor(row)
    setVersions([])
    setVersionsLoading(true)
    try {
      const list = await api<ProcessDefItem[]>(`/api/wf/process-defs/${row.defCode}/versions`)
      setVersions(list)
    } catch (err) {
      if (!(err instanceof ApiError) && !(err instanceof NetworkError)) throw err
    } finally {
      setVersionsLoading(false)
    }
  }

  const openTimeTravel = async (row: ProcessDefItem) => {
    setTtTarget(row)
    setTtWidgets([])
    setTtDate("")
    if (!row.formCode) return
    setTtLoading(true)
    try {
      const detail = await api<FormDefItem & { schemaJson?: unknown }>(`/api/wf/form-defs/${row.formCode}/latest`)
      setTtWidgets(parseFormSchema(detail.schemaJson).widgets)
    } catch {
      setTtWidgets([])
    } finally {
      setTtLoading(false)
    }
  }

  const submitTimeTravel = async (formData: WfFormData) => {
    if (!ttTarget) return
    if (!ttDate) {
      toast.error("请选择补审业务日期")
      return
    }
    setTtSubmitting(true)
    try {
      await api("/api/wf/instances", {
        method: "POST",
        body: JSON.stringify({
          defCode: ttTarget.defCode,
          formData,
          title: `${ttTarget.name}（补审 ${ttDate}）`,
          bizTime: ttDate,
        }),
      })
      toast.success("补审已发起，审批记录时间记为业务日期")
      setTtTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "补审发起失败（接口可能尚未就绪）")
    } finally {
      setTtSubmitting(false)
    }
  }

  const formName = (code?: string | null) =>
    code ? publishedForms.find((f) => f.code === code)?.name ?? code : "—"

  const columns = useMemo<ColumnDef<ProcessDefItem, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { title: "名称", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="名称" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "defCode",
        meta: { title: "编码", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="编码" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.defCode}</span>,
      },
      {
        accessorKey: "category",
        meta: { title: "分类", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="分类" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.category || "—"}</span>,
      },
      {
        id: "formCode",
        accessorFn: (r) => r.formCode ?? "",
        meta: { title: "关联表单" },
        header: () => <span>关联表单</span>,
        cell: ({ row }) => <span className="text-sm">{formName(row.original.formCode)}</span>,
      },
      {
        accessorKey: "designerType",
        meta: { title: "设计器" },
        header: () => <span>设计器</span>,
        cell: ({ row }) => {
          const type = row.original.designerType
          const meta = DESIGNER_META[type] ?? DESIGNER_META.DINGTALK
          const label = type === "GRAPH" ? "流程图" : type === "BPMN" ? "BPMN(旧)" : "仿钉钉"
          return (
            <Badge variant="secondary" className="gap-1">
              <meta.icon className="size-3" />
              {label}
            </Badge>
          )
        },
      },
      {
        accessorKey: "version",
        meta: { title: "版本", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="版本" />,
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">v{row.original.version ?? 1}</span>,
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => {
          const meta = WF_STATUS_META[row.original.status] ?? WF_STATUS_META.DRAFT
          return (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
          )
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => openDesign(row.original)}>
              <Pencil className="size-3.5" />
              编辑
            </Button>
            {row.original.designerType === "DINGTALK" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-violet-600 hover:text-violet-600"
                title="把这条仿钉钉旧定义转成流程图，用新 react-flow 设计器打开（实验）"
                onClick={() => openInNewDesigner(row.original)}
              >
                <FlaskConical className="size-3.5" />
                新设计器
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-emerald-600 hover:text-emerald-600"
              onClick={() => openPublish(row.original)}
            >
              <Send className="size-3.5" />
              发布
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void openVersions(row.original)}>
              <History className="size-3.5" />
              版本
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-amber-600 hover:text-amber-600"
              onClick={() => void openTimeTravel(row.original)}
            >
              <CalendarClock className="size-3.5" />
              补审
            </Button>
          </div>
        ),
      },
    ],
    // 列定义随 publishedForms（关联表单名映射）重建即可；单元格引用的操作函数每次渲染稳定，
    // 无需纳入依赖，故冻结依赖避免整表无谓重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publishedForms],
  )

  return (
    <div className="space-y-4">
      <PageHeader title="流程定义" description="设计审批流程：仿钉钉或流程图两种设计器，绑定表单后发布即可发起" />

      {loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">流程定义接口尚未就绪</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              /api/wf/process-defs 暂不可用（{loadError === "network" ? "后端未启动" : loadError}）。
              后端工作流模块就绪后重试即可管理真实流程定义；现在仍可点击「新建流程」体验两种设计器。
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={startCreate}>
                <Plus className="size-3.5" /> 新建流程
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => reload()}>
                <RotateCw className="size-3.5" /> 重试连接
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchKeys={["name", "defCode", "category"]}
          searchPlaceholder="搜索流程名称 / 编码（后端全量搜索）"
          serverSearch={{
            keyword,
            onKeywordChange: (kw) => {
              setKeyword(kw)
              setPageNum(1)
            },
          }}
          serverPagination={{
            pageIndex: pageNum - 1,
            pageSize,
            rowCount: total,
            onPaginationChange: (pi, ps) => {
              setPageNum(pi + 1)
              setPageSize(ps)
            },
          }}
          onRefresh={() => reload()}
          exportFileName="流程定义"
          actionSlot={
            <Button size="sm" className="h-8 gap-1" onClick={startCreate}>
              <Plus className="size-4" />
              新建流程
            </Button>
          }
        />
      )}

      {/* 新建：选择设计器类型 + 绑定表单 → 跳独立设计页 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建流程定义</DialogTitle>
            <DialogDescription>选择设计器类型并绑定表单，创建后进入设计器</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pd-name">流程名称</Label>
                <Input
                  id="pd-name"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="如：请假审批"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-code">流程编码</Label>
                <Input
                  id="pd-code"
                  value={createForm.defCode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, defCode: e.target.value }))}
                  placeholder="如：leave_flow"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-category">分类</Label>
              <Input
                id="pd-category"
                value={createForm.category}
                onChange={(e) => setCreateForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="如：人事 / 行政"
              />
            </div>

            {/* 表单绑定：二选一（在线表单 / 代码表单） */}
            <div className="space-y-2">
              <Label>表单绑定</Label>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { type: "ONLINE", label: "在线表单", desc: "选择已发布的在线设计器表单，字段从 schema 派生" },
                    { type: "CODE", label: "代码表单", desc: "选择已登记的手写表单，字段从清单识别；可选自定义发起页" },
                  ] as const
                ).map((opt) => {
                  const active = createForm.formType === opt.type
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setCreateForm((f) => ({ ...f, formType: opt.type, formCode: "" }))}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                        active ? "border-primary/50 bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.desc}</span>
                    </button>
                  )
                })}
              </div>
              {createForm.formType === "ONLINE" ? (
                <Select
                  value={createForm.formCode || undefined}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, formCode: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={publishedForms.length ? "选择已发布表单" : "暂无已发布表单"} />
                  </SelectTrigger>
                  <SelectContent>
                    {publishedForms.map((f) => (
                      <SelectItem key={f.code} value={f.code}>
                        {f.name}（{f.code}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="grid gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">代码表单（formKey）</Label>
                    <Select
                      value={createForm.formCode || undefined}
                      onValueChange={(v) => setCreateForm((f) => ({ ...f, formCode: v }))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={codeForms.length ? "选择已登记代码表单" : "暂无已登记代码表单"} />
                      </SelectTrigger>
                      <SelectContent>
                        {codeForms.map((f) => (
                          <SelectItem key={f.formKey} value={f.formKey}>
                            {f.name}（{f.formKey}
                            {typeof f.fieldCount === "number" ? ` · ${f.fieldCount} 字段` : ""}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pd-submit-path" className="text-xs text-muted-foreground">
                      自定义发起页路由（formSubmitPath，选填）
                    </Label>
                    <Input
                      id="pd-submit-path"
                      value={createForm.formSubmitPath}
                      onChange={(e) => setCreateForm((f) => ({ ...f, formSubmitPath: e.target.value }))}
                      placeholder="如 /document/send?new=1（留空则内嵌登记表单）"
                      className="font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    字段清单经统一接口识别，供分支条件 / 按字段取人 / 字段权限使用；填了发起页则从「发起申请」navigate 跳该页起单。
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>设计器类型</Label>
              <div className="grid grid-cols-2 gap-2.5">
                {CREATE_DESIGNER_TYPES.map((type) => {
                  const meta = DESIGNER_META[type]
                  const active = createForm.designerType === type
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setCreateForm((f) => ({ ...f, designerType: type }))}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                        active ? "border-primary/50 bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <meta.icon className="size-4 text-primary" />
                        {meta.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{meta.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={confirmCreate}>进入设计器</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 发布确认（含后端转换/部署报错展示） */}
      <Dialog
        open={!!publishTarget}
        onOpenChange={(open) => {
          if (!open) {
            setPublishTarget(null)
            setPublishError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>发布流程</DialogTitle>
            <DialogDescription>
              确定发布流程「{publishTarget?.name}」吗？后端将把设计转换为 BPMN 并部署到引擎。
            </DialogDescription>
          </DialogHeader>
          {publishIssues.length > 0 && (
            <div
              className={cn(
                "space-y-1.5 rounded-md border p-3 text-xs leading-relaxed",
                hasBlockingIssue(publishIssues)
                  ? "border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
              )}
            >
              <div className="font-medium">
                发布校验：{publishIssues.filter((i) => i.level === "error").length} 项错误、
                {publishIssues.filter((i) => i.level === "warn").length} 项警告
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {publishIssues.map((issue, i) => (
                  <li key={i}>
                    <span className="font-medium">{issue.level === "error" ? "[错误]" : "[警告]"}</span>{" "}
                    {issue.message}
                  </li>
                ))}
              </ul>
              {hasBlockingIssue(publishIssues) && (
                <div className="pt-1 font-medium">存在错误，需修正后才能发布。</div>
              )}
            </div>
          )}
          {publishError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-600 dark:text-rose-400">
              <div className="mb-1 font-medium">转换/部署失败</div>
              <div className="whitespace-pre-wrap break-words font-mono">{publishError}</div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPublishTarget(null)
                setPublishError(null)
              }}
            >
              取消
            </Button>
            <Button disabled={publishing || hasBlockingIssue(publishIssues)} onClick={() => void doPublish()}>
              {publishing ? "发布中…" : publishError ? "重试发布" : "确认发布"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本历史 */}
      <Drawer
        open={!!versionsFor}
        onOpenChange={(open) => !open && setVersionsFor(null)}
        title={`版本历史 · ${versionsFor?.name ?? ""}`}
        description="流程每次发布部署生成一个版本"
        width={420}
      >
        {versionsLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <History className="size-8 opacity-30" />
            <span className="text-sm">暂无版本记录</span>
            <span className="text-xs">后端接口就绪后展示历史版本</span>
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => {
              const meta = WF_STATUS_META[v.status] ?? WF_STATUS_META.DRAFT
              return (
                <div key={`${v.defCode}-${v.version}`} className="flex items-center gap-3 rounded-md border p-3">
                  <Badge variant="outline" className="font-mono">
                    v{v.version}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.createdAt ? v.createdAt.replace("T", " ").slice(0, 16) : ""}
                      {v.createdBy ? ` · ${v.createdBy}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className={meta.className}>
                    {meta.label}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </Drawer>

      {/* 穿越时空补审：指定业务日期发起，审批记录时间记为该日期 */}
      <Modal
        open={!!ttTarget}
        onOpenChange={(open) => !open && !ttSubmitting && setTtTarget(null)}
        title={
          <span className="flex items-center gap-2">
            <CalendarClock className="size-4 text-amber-500" />
            穿越时空补审 · {ttTarget?.name}
          </span>
        }
        description="指定业务日期补录审批：ext.biz_time 记录该日期，展示/报表用业务时间，引擎真实时间不动"
        width={560}
        height={640}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">补审业务日期</Label>
            <Input type="date" value={ttDate} onChange={(e) => setTtDate(e.target.value)} className="w-52" />
          </div>
          {ttLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载表单…</div>
          ) : !ttTarget?.formCode ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              该流程未绑定表单，补审将仅按流程发起（无表单数据）
            </div>
          ) : ttWidgets.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              暂无表单字段
            </div>
          ) : (
            <FormRenderer
              widgets={ttWidgets}
              submitting={ttSubmitting}
              submitLabel={"提交补审" as unknown as string}
              onSubmit={submitTimeTravel}
            />
          )}
          {!ttTarget?.formCode && (
            <Button className="gap-1.5" disabled={ttSubmitting} onClick={() => void submitTimeTravel({})}>
              <Send className="size-3.5" /> 提交补审
            </Button>
          )}
        </div>
      </Modal>
    </div>
  )
}
