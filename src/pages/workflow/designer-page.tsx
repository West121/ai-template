/**
 * 流程设计器 · 独立整页（/workflow/defs/:code/design，新建走 /workflow/defs/new）。
 *
 * 取代 defs.tsx 里承载设计器的全屏 <Modal>：在标准 App 外壳内铺满、无 PageHeader、画布最大化。
 * 顶部操作条（退出 / 名称 / 类型 / 绑定表单 / 保存状态 + 校验 / 整理 / 保存草稿 / 保存并发布）
 *   + 中间承载 GRAPH（FlowDesigner，复用 ref 句柄）或 DINGTALK（DingtalkProcessDesigner）。
 * 离开有未保存改动用 AlertDialog 拦截；首次保存草稿后 replace 到带 code 的 URL。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, CircleCheck, CloudOff, LayoutDashboard, Link2, Loader2, Save, Send, Workflow } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { FlowDesigner, type FlowDesignerHandle } from "@/pages/workflow/designer/flow/flow-designer"
import type { ProcessModel } from "@/pages/workflow/designer/flow/model"
import { dingtalkToProcessModel } from "@/pages/workflow/designer/flow/dingtalk-adapter"
import { DingtalkProcessDesigner } from "@/pages/workflow/designer/dingtalk/process-designer"
import { ensureNodeIdSeq, type StepNode } from "@/pages/workflow/designer/dingtalk/model"
import {
  deserializeDingtalk,
  isBackendDesignerJson,
  serializeDingtalk,
} from "@/pages/workflow/designer/dingtalk/serialize"
import {
  defaultFlowConfig,
  type FlowConfig,
  type FormFieldOption,
  type ProcessBase,
} from "@/pages/workflow/designer/shared/config"
import { hasBlockingIssue, validateFlow, type ValidationIssue } from "@/pages/workflow/designer/shared/validate"
import { widgetsToFields } from "@/pages/workflow/designer/form/fields"
import { ensureWidgetIdSeq, type FormWidget } from "@/pages/workflow/designer/form/model"
import type {
  DesignerType,
  FormDefItem,
  FormType,
  NodePropsMap,
  ProcessDefItem,
} from "@/pages/workflow/designer/types"

/** .bpmn XML → 归一化 ProcessModel（POST /api/wf/models/import 返回结构） */
interface BpmnImportResult {
  model: ProcessModel
  warnings?: string[]
}

/** 仿钉钉初始节点树（一条主管审批） */
function initialSteps(): StepNode[] {
  return [{ id: "n_root_1", kind: "approval", name: "审批人", assignees: [], mode: "any" }]
}

/** GRAPH 空白模型：开始 → 审批 → 结束 */
function blankGraphModel(key: string, name: string, formKey?: string): ProcessModel {
  const model: ProcessModel = {
    schemaVersion: 1,
    key: key || "process",
    name: name || "未命名流程",
    flowConfig: defaultFlowConfig(),
    nodes: [
      { id: "start", type: "startEvent", name: "开始", position: { x: 260, y: 40 } },
      {
        id: "approve",
        type: "userTask",
        name: "审批",
        position: { x: 210, y: 150 },
        props: { assigneeRules: [], multiMode: "ANY" },
      },
      { id: "end", type: "endEvent", name: "结束", position: { x: 260, y: 300 } },
    ],
    edges: [
      { id: "e_start_approve", source: "start", target: "approve" },
      { id: "e_approve_end", source: "approve", target: "end" },
    ],
  }
  if (formKey) model.formKey = formKey
  return model
}

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

/** 组合 formKey（formCode:version） */
function composeFormKey(formCode?: string | null, formVersion?: number | null): string | undefined {
  if (!formCode) return undefined
  return formVersion != null ? `${formCode}:${formVersion}` : formCode
}

/** 解析表单 schema（字符串或对象）→ widgets */
function parseWidgets(raw: unknown): FormWidget[] {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    const widgets = Array.isArray((obj as { widgets?: unknown })?.widgets)
      ? (obj as { widgets: FormWidget[] }).widgets
      : []
    ensureWidgetIdSeq(widgets)
    return widgets
  } catch {
    return []
  }
}

interface EditorState {
  id: number | null
  defCode: string
  name: string
  description: string
  icon: string
  category: string
  designerType: DesignerType
  formType: FormType
  formCode: string
  formVersion: number | null
  formSubmitPath: string
  formViewPath: string
  steps: StepNode[]
  nodeProps: NodePropsMap
  flowConfig: FlowConfig
  formFields: FormFieldOption[]
  graphModel: ProcessModel
}

function emptyEditor(): EditorState {
  return {
    id: null,
    defCode: "",
    name: "",
    description: "",
    icon: "",
    category: "",
    designerType: "GRAPH",
    formType: "DYNAMIC",
    formCode: "",
    formVersion: null,
    formSubmitPath: "",
    formViewPath: "",
    steps: initialSteps(),
    nodeProps: {},
    flowConfig: defaultFlowConfig(),
    formFields: [],
    graphModel: blankGraphModel("", ""),
  }
}

/** 拉表单最新 schema → 字段选项 + 版本 */
async function resolveFormFields(
  formCode: string,
): Promise<{ fields: FormFieldOption[]; version: number | null }> {
  if (!formCode) return { fields: [], version: null }
  try {
    const detail = await api<FormDefItem & { schemaJson?: unknown; version?: number }>(
      `/api/wf/form-defs/${formCode}/latest`,
    )
    return { fields: widgetsToFields(parseWidgets(detail.schemaJson)), version: detail.version ?? null }
  } catch {
    return { fields: [], version: null }
  }
}

export default function WorkflowDesignerPage() {
  const { code } = useParams<{ code: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [editor, setEditor] = useState<EditorState>(emptyEditor)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"network" | string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [publishedForms, setPublishedForms] = useState<FormDefItem[]>([])

  // 发布确认（含后端转换/部署报错展示）
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishIssues, setPublishIssues] = useState<ValidationIssue[]>([])
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  // 离开确认
  const [leaveOpen, setLeaveOpen] = useState(false)

  // GRAPH 校验错误数（供发布按钮 disabled）；DINGTALK 由 dingtalkIssues 派生
  const [graphErrors, setGraphErrors] = useState(0)

  const flowRef = useRef<FlowDesignerHandle>(null)
  // 已加载的 code：首次保存草稿 navigate(replace) 后避免重复拉取覆盖现场
  const loadedCodeRef = useRef<string | null>(null)

  const loadForms = useCallback(async () => {
    try {
      const page = await api<PageResult<FormDefItem>>("/api/wf/form-defs?pageNum=1&pageSize=100")
      setPublishedForms(page.list.filter((f) => f.status === "PUBLISHED"))
    } catch {
      setPublishedForms([])
    }
  }, [])

  useEffect(() => {
    void loadForms()
  }, [loadForms])

  // 载入：有 code → 按定义详情载入；无 code（/new）→ 按查询参数建空白编辑器
  useEffect(() => {
    if (code && loadedCodeRef.current === code) return
    let cancelled = false

    const loadNew = async () => {
      const type = (searchParams.get("type") as DesignerType | null) ?? "GRAPH"
      const formType = (searchParams.get("formType") as FormType | null) ?? "DYNAMIC"
      const formCode = searchParams.get("formCode") ?? ""
      const next = emptyEditor()
      next.defCode = searchParams.get("code") ?? ""
      next.name = searchParams.get("name") ?? ""
      next.category = searchParams.get("category") ?? ""
      next.designerType = type
      next.formType = formType
      next.formCode = formType === "DYNAMIC" ? formCode : ""
      next.formSubmitPath = searchParams.get("formSubmitPath") ?? ""
      next.formViewPath = searchParams.get("formViewPath") ?? ""
      const { fields, version } = formType === "DYNAMIC" ? await resolveFormFields(formCode) : { fields: [], version: null }
      next.formFields = fields
      next.formVersion = version
      next.graphModel = blankGraphModel(next.defCode, next.name, composeFormKey(next.formCode, version))
      if (cancelled) return
      setEditor(next)
      setDirty(true) // 新建：从未保存
      setLoading(false)
    }

    const loadExisting = async (defCode: string) => {
      let row: ProcessDefItem | null = null
      try {
        row = await api<ProcessDefItem>(`/api/wf/process-defs/${defCode}/latest`)
      } catch (err) {
        if (cancelled) return
        if (err instanceof NetworkError) setLoadError("network")
        else setLoadError(err instanceof Error ? err.message : "加载失败")
        setLoading(false)
        return
      }
      if (!row || cancelled) {
        if (!cancelled) {
          setLoadError("流程定义不存在")
          setLoading(false)
        }
        return
      }
      const next = emptyEditor()
      next.id = row.id
      next.defCode = row.defCode
      next.name = row.name
      next.category = row.category ?? ""
      next.icon = row.icon ?? ""
      next.description = row.remark ?? ""
      next.designerType = row.designerType
      next.formType = row.formType ?? "DYNAMIC"
      next.formCode = row.formCode ?? ""
      next.formSubmitPath = row.formSubmitPath ?? ""
      next.formViewPath = row.formViewPath ?? ""

      // 实验入口：?as=graph 把 DINGTALK 定义转 GRAPH 模型打开
      const asGraph = searchParams.get("as") === "graph"

      if (row.designerType === "DINGTALK" && !asGraph) {
        try {
          const raw = row.designerJson
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
          if (isBackendDesignerJson(parsed)) {
            const d = deserializeDingtalk(parsed)
            ensureNodeIdSeq(d.steps)
            next.steps = d.steps.length ? d.steps : initialSteps()
            next.nodeProps = d.nodeProps
            next.flowConfig = d.flowConfig
          } else {
            next.steps = initialSteps()
          }
        } catch {
          next.steps = initialSteps()
        }
      } else if (row.designerType === "GRAPH") {
        next.designerType = "GRAPH"
        next.graphModel =
          parseGraphModel(row.designerJson) ??
          blankGraphModel(row.defCode, row.name, composeFormKey(row.formCode, row.formVersion))
      } else if (asGraph && row.designerType === "DINGTALK") {
        // 钉钉 → GRAPH 迁移（实验）
        next.designerType = "GRAPH"
        try {
          const raw = row.designerJson
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
          next.graphModel = dingtalkToProcessModel(parsed, {
            key: row.defCode,
            name: row.name,
            formKey: composeFormKey(row.formCode, row.formVersion),
          })
        } catch {
          next.graphModel = blankGraphModel(row.defCode, row.name, composeFormKey(row.formCode, row.formVersion))
        }
      } else {
        // 存量 BPMN：经 /api/wf/models/import 迁移为 GRAPH
        next.designerType = "GRAPH"
        let migrated: ProcessModel | null = null
        if (row.bpmnXml) {
          try {
            const res = await api<BpmnImportResult>("/api/wf/models/import", {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: row.bpmnXml,
            })
            migrated = res.model
          } catch {
            migrated = null
          }
        }
        next.graphModel =
          migrated ?? blankGraphModel(row.defCode, row.name, composeFormKey(row.formCode, row.formVersion))
      }

      const { fields, version } = await resolveFormFields(row.formCode ?? "")
      next.formFields = fields
      next.formVersion = row.formVersion ?? version
      if (cancelled) return
      loadedCodeRef.current = defCode
      setEditor(next)
      setDirty(false)
      setLoading(false)
    }

    setLoading(true)
    setLoadError(null)
    if (code) void loadExisting(code)
    else void loadNew()

    return () => {
      cancelled = true
    }
    // searchParams 稳定（同一 URL），仅 code 变化时重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const formName = (c?: string | null) =>
    c ? publishedForms.find((f) => f.code === c)?.name ?? c : null

  const handleDirty = useCallback(() => {
    setDirty(true)
    if (flowRef.current) {
      setGraphErrors(flowRef.current.validate().filter((i) => i.level === "error").length)
    }
  }, [])

  // GRAPH 初次挂载后跑一次校验，拿到发布 gate 的初始错误数
  useEffect(() => {
    if (loading || editor.designerType !== "GRAPH") return
    const t = window.setTimeout(() => {
      if (flowRef.current) {
        setGraphErrors(flowRef.current.validate().filter((i) => i.level === "error").length)
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [loading, editor.designerType, editor.id])

  // DINGTALK 校验问题（发布 gate + 校验按钮）
  const dingtalkIssues = useMemo(
    () => (editor.designerType === "DINGTALK" ? validateFlow(editor.steps, editor.nodeProps) : []),
    [editor.designerType, editor.steps, editor.nodeProps],
  )
  const errorCount =
    editor.designerType === "DINGTALK"
      ? dingtalkIssues.filter((i) => i.level === "error").length
      : graphErrors

  /** 收集当前设计的发布校验清单（DINGTALK：validateFlow；GRAPH：flow 设计器 validate 映射） */
  const collectIssues = (): ValidationIssue[] => {
    if (editor.designerType === "DINGTALK") return validateFlow(editor.steps, editor.nodeProps)
    return (flowRef.current?.validate() ?? []).map((i) => ({
      nodeId: i.nodeId ?? i.edgeId,
      level: i.level === "warning" ? "warn" : "error",
      message: i.message,
    }))
  }

  const doSave = async (opts?: { publishAfter?: boolean }): Promise<ProcessDefItem | null> => {
    if (!editor.defCode.trim() || !editor.name.trim()) {
      toast.error("请填写流程名称与编码")
      return null
    }
    setSaving(true)
    const base: Record<string, unknown> = {
      defCode: editor.defCode,
      name: editor.name,
      remark: editor.description || undefined,
      icon: editor.icon || undefined,
      category: editor.category || undefined,
      designerType: editor.designerType,
      formType: editor.formType,
      formCode: editor.formType === "DYNAMIC" ? editor.formCode || undefined : undefined,
      formVersion: editor.formType === "DYNAMIC" ? editor.formVersion ?? undefined : undefined,
      formSubmitPath: editor.formType === "CUSTOM" ? editor.formSubmitPath || undefined : undefined,
      formViewPath: editor.formType === "CUSTOM" ? editor.formViewPath || undefined : undefined,
    }
    if (editor.designerType === "DINGTALK") {
      base.designerJson = JSON.stringify(serializeDingtalk(editor.steps, editor.nodeProps, editor.flowConfig))
    } else {
      base.designerType = "GRAPH"
      const model = flowRef.current?.getModel() ?? editor.graphModel
      base.designerJson = JSON.stringify(model)
    }
    try {
      const saved = editor.id
        ? await api<ProcessDefItem>(`/api/wf/process-defs/${editor.id}`, {
            method: "PUT",
            body: JSON.stringify(base),
          })
        : await api<ProcessDefItem>("/api/wf/process-defs", { method: "POST", body: JSON.stringify(base) })
      toast.success(`流程「${editor.name}」已保存为草稿`)
      const savedId = saved?.id ?? editor.id
      setEditor((e) => ({ ...e, id: savedId }))
      setDirty(false)
      // 首次保存（/new）→ replace 到带 code 的稳定 URL（会重挂本页）；标记已加载避免重复拉取。
      // 「保存并发布」路径带 ?publish=1，重挂后自动打开发布确认。
      if (!code) {
        loadedCodeRef.current = editor.defCode
        navigate(`/workflow/defs/${editor.defCode}/design${opts?.publishAfter ? "?publish=1" : ""}`, {
          replace: true,
        })
      }
      return saved
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }

  const openPublish = async () => {
    const wasNew = !code
    const saved = await doSave({ publishAfter: true })
    // 新建首存会 navigate(replace) 重挂本页，由 publish=1 效应自动开发布框；此处直接返回避免对已卸载组件 setState
    if (wasNew) return
    if (!saved && !editor.id) return
    setPublishIssues(collectIssues())
    setPublishError(null)
    setPublishOpen(true)
  }

  // 新建首存后经 ?publish=1 重挂 → 加载完成后自动打开发布确认（延一拍等 flowRef 就绪）
  const autoPublishDone = useRef(false)
  useEffect(() => {
    if (loading || loadError || autoPublishDone.current) return
    if (searchParams.get("publish") !== "1") return
    autoPublishDone.current = true
    const t = window.setTimeout(() => {
      setPublishIssues(collectIssues())
      setPublishError(null)
      setPublishOpen(true)
    }, 60)
    return () => window.clearTimeout(t)
    // collectIssues 读 flowRef/editor 现场，无需入依赖；仅在加载完成后触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadError, searchParams])

  const doPublish = async () => {
    if (hasBlockingIssue(publishIssues)) {
      toast.error("存在校验错误，请先修正后再发布")
      return
    }
    setPublishing(true)
    setPublishError(null)
    try {
      if (editor.designerType === "GRAPH") {
        const model = flowRef.current?.getModel() ?? editor.graphModel
        const body: Record<string, unknown> = {
          key: editor.defCode,
          name: editor.name,
          category: editor.category || undefined,
          icon: editor.icon || undefined,
          formCode: editor.formCode || undefined,
          formVersion: editor.formVersion ?? undefined,
          model,
        }
        await api("/api/wf/models/graph/deploy", { method: "POST", body: JSON.stringify(body) })
      } else {
        await api(`/api/wf/process-defs/${editor.id}/publish`, { method: "POST" })
      }
      toast.success(`流程「${editor.name}」已发布，可到发起中心发起`)
      setPublishOpen(false)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "发布失败")
    } finally {
      setPublishing(false)
    }
  }

  const handleValidate = () => {
    if (editor.designerType === "GRAPH") {
      const found = flowRef.current?.runValidate() ?? []
      setGraphErrors(found.filter((i) => i.level === "error").length)
      return
    }
    const issues = dingtalkIssues
    const errs = issues.filter((i) => i.level === "error").length
    if (errs > 0) toast.error(`校验未通过：${errs} 个错误`)
    else if (issues.length > 0) toast.warning(`校验通过，但有 ${issues.length} 个提示`)
    else toast.success("校验通过，无问题")
  }

  const exit = () => {
    if (dirty) setLeaveOpen(true)
    else navigate("/workflow/defs")
  }

  const setBase = (patch: Partial<ProcessBase>) => {
    setEditor((e) => ({
      ...e,
      name: patch.name ?? e.name,
      description: patch.description ?? e.description,
      icon: patch.icon ?? e.icon,
      category: patch.category ?? e.category,
    }))
    setDirty(true)
  }

  const saveStatus = saving
    ? { text: "保存中…", cls: "text-muted-foreground" }
    : editor.id && !dirty
      ? { text: "已保存", cls: "text-muted-foreground", ok: true }
      : { text: "未保存", cls: "text-amber-600 dark:text-amber-400" }

  const bound = formName(editor.formCode)

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden md:-mx-5 md:-my-5">
      {/* 顶部操作条 */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <Button variant="ghost" size="sm" className="gap-1" onClick={exit}>
          <ArrowLeft className="size-4" />
          退出
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Input
          value={editor.name}
          onChange={(e) => setBase({ name: e.target.value })}
          placeholder="未命名流程"
          className="h-8 w-56 border-transparent text-sm font-semibold hover:border-input focus-visible:border-ring"
        />
        <Badge variant="secondary" className="gap-1">
          <Workflow className="size-3" />
          {editor.designerType === "DINGTALK" ? "仿钉钉" : "流程图"}
        </Badge>
        <Badge variant="outline" className={cn("gap-1", !bound && "text-muted-foreground")}>
          <Link2 className="size-3" />
          {bound ?? "未绑定表单"}
        </Badge>
        <span className={cn("ml-2 flex items-center gap-1 text-xs", saveStatus.cls)}>
          {saveStatus.ok ? (
            <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <span className="size-1.5 rounded-full bg-current" />
          )}
          {saveStatus.text}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={handleValidate}>
            校验
          </Button>
          {editor.designerType === "GRAPH" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => flowRef.current?.autoLayout()}
            >
              <LayoutDashboard className="size-3.5" />
              整理
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void doSave()}>
            <Save className="size-3.5" />
            保存草稿
          </Button>
          {errorCount > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* disabled 按钮不触发 tooltip，套一层 span 承载 */}
                <span tabIndex={0}>
                  <Button size="sm" className="h-8 gap-1.5" disabled>
                    <Send className="size-3.5" />
                    保存并发布
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>请先修复 {errorCount} 个错误</TooltipContent>
            </Tooltip>
          ) : (
            <Button size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void openPublish()}>
              <Send className="size-3.5" />
              保存并发布
            </Button>
          )}
        </div>
      </div>

      {/* 设计器主体 */}
      {loading ? (
        <DesignerSkeleton />
      ) : loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <CloudOff className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">无法加载流程定义</div>
          <p className="max-w-md text-xs text-muted-foreground">
            {loadError === "network" ? "后端未启动或网络不可用。" : loadError}
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate("/workflow/defs")}>
            返回列表
          </Button>
        </div>
      ) : editor.designerType === "DINGTALK" ? (
        <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
          <DingtalkProcessDesigner
            steps={editor.steps}
            onStepsChange={(updater) => {
              setEditor((e) => ({
                ...e,
                steps: typeof updater === "function" ? (updater as (s: StepNode[]) => StepNode[])(e.steps) : updater,
              }))
              setDirty(true)
            }}
            nodeProps={editor.nodeProps}
            onNodePropsChange={(updater) => {
              setEditor((e) => ({
                ...e,
                nodeProps:
                  typeof updater === "function"
                    ? (updater as (n: NodePropsMap) => NodePropsMap)(e.nodeProps)
                    : updater,
              }))
              setDirty(true)
            }}
            formFields={editor.formFields}
            base={{ name: editor.name, description: editor.description, icon: editor.icon, category: editor.category }}
            onBaseChange={setBase}
            flowConfig={editor.flowConfig}
            onFlowConfigChange={(flowConfig) => {
              setEditor((e) => ({ ...e, flowConfig }))
              setDirty(true)
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-2">
          <FlowDesigner
            key={editor.id ?? editor.defCode}
            ref={flowRef}
            embedded
            hideToolbar
            onDirty={handleDirty}
            initialModel={editor.graphModel}
            processKey={editor.defCode}
            formKey={composeFormKey(editor.formCode, editor.formVersion)}
            base={{ name: editor.name, description: editor.description, icon: editor.icon, category: editor.category }}
            onBaseChange={setBase}
            formFields={editor.formFields}
          />
        </div>
      )}

      {/* 离开确认 */}
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的改动</AlertDialogTitle>
            <AlertDialogDescription>确定退出设计器吗？未保存的改动将丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={async () => {
                setLeaveOpen(false)
                const saved = await doSave()
                if (saved || editor.id) navigate("/workflow/defs")
              }}
            >
              保存并退出
            </Button>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => navigate("/workflow/defs")}
            >
              不保存退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 发布确认 */}
      <Dialog
        open={publishOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPublishOpen(false)
            setPublishError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>发布流程</DialogTitle>
            <DialogDescription>
              确定发布流程「{editor.name}」吗？后端将把设计转换为 BPMN 并部署到引擎。
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
            </div>
          )}
          {publishError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-600 dark:text-rose-400">
              <div className="mb-1 font-medium">转换/部署失败</div>
              <div className="whitespace-pre-wrap break-words font-mono">{publishError}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              取消
            </Button>
            <Button disabled={publishing || hasBlockingIssue(publishIssues)} onClick={() => void doPublish()}>
              {publishing ? "发布中…" : publishError ? "重试发布" : "确认发布"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 加载骨架：画布占位卡 + 面板行 */
function DesignerSkeleton() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-40 shrink-0 border-r bg-muted/20 p-2.5">
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">加载流程设计…</span>
      </div>
      <div className="w-80 shrink-0 space-y-2 border-l p-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}
