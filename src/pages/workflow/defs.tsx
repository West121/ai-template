/**
 * 流程定义管理 /workflow/defs
 * 列表 + 新建（选设计器类型：仿钉钉/流程图 + 绑定已发布表单）+ 全屏设计器 + 发布 + 版本历史。
 * GRAPH（流程图）走新 react-flow 设计器，部署经 POST /api/wf/models/graph/deploy（图直译）；
 * 仿钉钉（DINGTALK）并存保留；存量 BPMN 定义编辑时经 /api/wf/models/import 迁移为 GRAPH。
 * 接口：GET /api/wf/process-defs、POST /api/wf/process-defs、PUT /{id}、
 *       POST /{id}/publish（后端转换/部署，展示报错）、GET /{code}/versions
 * 后端未就绪时优雅空态（不造假数据）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { FlowDesigner, type FlowDesignerHandle } from "@/pages/workflow/designer/flow/flow-designer"
import type { ProcessModel } from "@/pages/workflow/designer/flow/model"
import { dingtalkToProcessModel } from "@/pages/workflow/designer/flow/dingtalk-adapter"
import type { ValidationIssue as FlowValidationIssue } from "@/pages/workflow/designer/flow/validate"
import { DingtalkProcessDesigner } from "@/pages/workflow/designer/dingtalk/process-designer"
import { ensureNodeIdSeq, type StepNode } from "@/pages/workflow/designer/dingtalk/model"
import {
  deserializeDingtalk,
  isBackendDesignerJson,
  serializeDingtalk,
} from "@/pages/workflow/designer/dingtalk/serialize"
import { defaultFlowConfig, type FlowConfig, type FormFieldOption, type ProcessBase } from "@/pages/workflow/designer/shared/config"
import { hasBlockingIssue, validateFlow, type ValidationIssue } from "@/pages/workflow/designer/shared/validate"
import { FormRenderer } from "@/components/form-renderer"
import { parseFormSchema, type FormWidget as WfFormWidget, type WfFormData } from "@/types/workflow"
import { widgetsToFields } from "@/pages/workflow/designer/form/fields"
import { ensureWidgetIdSeq, type FormWidget } from "@/pages/workflow/designer/form/model"
import {
  WF_STATUS_META,
  type DesignerType,
  type FormDefItem,
  type FormType,
  type NodePropsMap,
  type ProcessDefItem,
} from "@/pages/workflow/designer/types"

const DESIGNER_META: Record<DesignerType, { label: string; description: string; icon: typeof Workflow }> = {
  DINGTALK: { label: "仿钉钉（简易）", description: "线性步骤 + 条件分支，适合审批场景，零门槛配置", icon: GitBranch },
  GRAPH: { label: "流程图（专业）", description: "react-flow 图设计器，支持网关/子流程/定时/脚本等复杂结构", icon: Workflow },
  // 旧 bpmn-js 设计器已下线；存量 BPMN 定义编辑时经 /api/wf/models/import 迁移为 GRAPH。
  BPMN: { label: "BPMN（旧）", description: "旧版设计器已下线，编辑时自动迁移为流程图", icon: Workflow },
}

/** 新建时可选的设计器类型（BPMN 旧设计器已下线，不再提供入口） */
const CREATE_DESIGNER_TYPES: DesignerType[] = ["DINGTALK", "GRAPH"]

/** .bpmn XML → 归一化 ProcessModel（POST /api/wf/models/import 返回结构） */
interface BpmnImportResult {
  model: ProcessModel
  warnings?: string[]
}

/** 仿钉钉初始节点树（一条主管审批） */
function initialSteps(): StepNode[] {
  return [{ id: "n_root_1", kind: "approval", name: "审批人", assignees: [], mode: "any" }]
}

/** GRAPH 空白模型：开始 → 审批 → 结束（前端画布坐标已就绪，后端据此生成 BPMN DI） */
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

/** flow 校验问题（level: error|warning）→ 共享发布校验清单（level: error|warn） */
function mapFlowIssues(issues: FlowValidationIssue[]): ValidationIssue[] {
  return issues.map((i) => ({
    nodeId: i.nodeId ?? i.edgeId,
    level: i.level === "warning" ? "warn" : "error",
    message: i.message,
  }))
}

/** 组合 formKey（formCode:version）供 GRAPH 各 userTask 继承 */
function composeFormKey(formCode?: string | null, formVersion?: number | null): string | undefined {
  if (!formCode) return undefined
  return formVersion != null ? `${formCode}:${formVersion}` : formCode
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
  /** GRAPH 设计器的归一化模型（DINGTALK 时忽略） */
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
    designerType: "DINGTALK",
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

/** 解析表单 schema（字符串或对象）→ widgets */
function parseWidgets(raw: unknown): FormWidget[] {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    const widgets = Array.isArray((obj as { widgets?: unknown })?.widgets)
      ? ((obj as { widgets: FormWidget[] }).widgets)
      : []
    ensureWidgetIdSeq(widgets)
    return widgets
  } catch {
    return []
  }
}

export default function WorkflowDefsPage() {
  const [rows, setRows] = useState<ProcessDefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"network" | string | null>(null)

  // 后端搜索 + 后端分页（避免只拉前 N 条本地搜索导致搜不全）
  const [keyword, setKeyword] = useState("")
  const [pageNum, setPageNum] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)

  const [publishedForms, setPublishedForms] = useState<FormDefItem[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    defCode: "",
    name: "",
    category: "",
    designerType: "DINGTALK" as DesignerType,
    formType: "DYNAMIC" as FormType,
    formCode: "",
    formSubmitPath: "",
    formViewPath: "",
  })

  // 发布校验清单（编辑器"保存并发布"或列表发布前）
  const [publishIssues, setPublishIssues] = useState<ValidationIssue[]>([])

  const [editorOpen, setEditorOpen] = useState(false)
  const [editor, setEditor] = useState<EditorState>(emptyEditor)
  const [saving, setSaving] = useState(false)
  const flowRef = useRef<FlowDesignerHandle>(null)

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

  useEffect(() => {
    void loadForms()
  }, [loadForms])

  // 关键词/分页变化时查后端（关键词防抖 250ms）
  useEffect(() => {
    const timer = setTimeout(() => void load(keyword, pageNum, pageSize), keyword ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, keyword, pageNum, pageSize])

  /** 拉表单最新 schema → 字段选项 + 版本 */
  const resolveFormFields = async (
    formCode: string,
  ): Promise<{ fields: FormFieldOption[]; version: number | null }> => {
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

  const startCreate = () => {
    setCreateForm({
      defCode: "",
      name: "",
      category: "",
      designerType: "DINGTALK",
      formType: "DYNAMIC",
      formCode: "",
      formSubmitPath: "",
      formViewPath: "",
    })
    setCreateOpen(true)
  }

  const confirmCreate = async () => {
    if (!createForm.defCode.trim() || !createForm.name.trim()) {
      toast.error("请填写流程名称与编码")
      return
    }
    if (createForm.formType === "CUSTOM" && !createForm.formSubmitPath.trim()) {
      toast.error("自定义表单需填写发起页路由")
      return
    }
    // 动态表单才解析字段；自定义表单无可绑定字段
    const { fields, version } =
      createForm.formType === "DYNAMIC"
        ? await resolveFormFields(createForm.formCode)
        : { fields: [], version: null }
    setEditor({
      ...emptyEditor(),
      defCode: createForm.defCode.trim(),
      name: createForm.name.trim(),
      category: createForm.category.trim(),
      designerType: createForm.designerType,
      formType: createForm.formType,
      formCode: createForm.formType === "DYNAMIC" ? createForm.formCode : "",
      formVersion: version,
      formSubmitPath: createForm.formSubmitPath.trim(),
      formViewPath: createForm.formViewPath.trim(),
      formFields: fields,
    })
    setCreateOpen(false)
    setEditorOpen(true)
  }

  const openEdit = async (row: ProcessDefItem) => {
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

    let detail: ProcessDefItem | null = null
    try {
      detail = await api<ProcessDefItem>(`/api/wf/process-defs/${row.defCode}/latest`)
    } catch {
      detail = row
    }
    if (detail?.remark != null) next.description = detail.remark
    if (detail?.icon != null) next.icon = detail.icon
    if (detail?.formType) next.formType = detail.formType
    if (detail?.formSubmitPath != null) next.formSubmitPath = detail.formSubmitPath
    if (detail?.formViewPath != null) next.formViewPath = detail.formViewPath
    if (row.designerType === "DINGTALK") {
      try {
        const raw = detail?.designerJson
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
        if (isBackendDesignerJson(parsed)) {
          // 后端格式 { nodes: [...] } → 反序列化回内部模型
          const { steps, nodeProps, flowConfig } = deserializeDingtalk(parsed)
          ensureNodeIdSeq(steps)
          next.steps = steps.length ? steps : initialSteps()
          next.nodeProps = nodeProps
          next.flowConfig = flowConfig
        } else if (Array.isArray((parsed as { root?: unknown })?.root)) {
          // 兼容早期 { root, nodeProps } 草稿
          const root = (parsed as { root: StepNode[] }).root
          ensureNodeIdSeq(root)
          next.steps = root
          next.nodeProps = ((parsed as { nodeProps?: NodePropsMap })?.nodeProps ?? {}) as NodePropsMap
        } else {
          next.steps = initialSteps()
        }
      } catch {
        next.steps = initialSteps()
      }
    } else if (row.designerType === "GRAPH") {
      // GRAPH：designerJson 存归一化 ProcessModel，直接载入 flow 设计器
      next.designerType = "GRAPH"
      next.graphModel =
        parseGraphModel(detail?.designerJson) ??
        blankGraphModel(row.defCode, row.name, composeFormKey(row.formCode, row.formVersion))
    } else {
      // 存量 BPMN（旧 bpmn-js 定义，已下线）：经 /api/wf/models/import 迁移为 ProcessModel，改用 flow 设计器编辑
      next.designerType = "GRAPH"
      const xml = detail?.bpmnXml
      let migrated: ProcessModel | null = null
      if (xml) {
        try {
          const res = await api<BpmnImportResult>("/api/wf/models/import", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: xml,
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
    setEditor(next)
    setEditorOpen(true)
  }

  /**
   * 实验入口：用新 react-flow 设计器打开一条 DINGTALK 旧定义。
   * 把该定义的钉钉 `designerJson` 经 `dingtalkToProcessModel` 转成归一化 ProcessModel，载入 FlowDesigner
   * 编辑（与存量 BPMN 经 /api/wf/models/import 迁移一致）。**不动钉钉设计器本身**——仅多一个「在新设计器打开」的通道。
   * 转换失败给清晰 toast 提示，不进入设计器。
   */
  const openInNewDesigner = async (row: ProcessDefItem) => {
    const next = emptyEditor()
    next.id = row.id
    next.defCode = row.defCode
    next.name = row.name
    next.category = row.category ?? ""
    next.icon = row.icon ?? ""
    next.description = row.remark ?? ""
    next.formType = row.formType ?? "DYNAMIC"
    next.formCode = row.formCode ?? ""
    next.formSubmitPath = row.formSubmitPath ?? ""
    next.formViewPath = row.formViewPath ?? ""

    let detail: ProcessDefItem | null = null
    try {
      detail = await api<ProcessDefItem>(`/api/wf/process-defs/${row.defCode}/latest`)
    } catch {
      detail = row
    }
    if (detail?.remark != null) next.description = detail.remark
    if (detail?.icon != null) next.icon = detail.icon
    if (detail?.formType) next.formType = detail.formType
    if (detail?.formSubmitPath != null) next.formSubmitPath = detail.formSubmitPath
    if (detail?.formViewPath != null) next.formViewPath = detail.formViewPath

    // 钉钉 designerJson（字符串或对象）→ ProcessModel
    const raw = detail?.designerJson
    let parsed: unknown
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      toast.error("无法用新设计器打开：钉钉流程定义（designerJson）不是合法 JSON")
      return
    }
    let model: ProcessModel
    try {
      model = dingtalkToProcessModel(parsed, {
        key: row.defCode,
        name: row.name,
        formKey: composeFormKey(row.formCode, row.formVersion),
      })
    } catch (err) {
      toast.error(err instanceof Error ? `钉钉流程转换失败：${err.message}` : "钉钉流程转换失败")
      return
    }

    next.designerType = "GRAPH"
    next.graphModel = model

    const { fields, version } = await resolveFormFields(row.formCode ?? "")
    next.formFields = fields
    next.formVersion = row.formVersion ?? version
    setEditor(next)
    setEditorOpen(true)
    toast.info("已用新流程图设计器打开（实验）：保存后将迁移为「流程图」定义")
  }

  const doSave = async (): Promise<ProcessDefItem | null> => {
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
      // 序列化为后端格式 { nodes: [...], flowConfig }（属性内联，见 designer/dingtalk/serialize.ts）；
      // 后端 designerJson 字段为 JSON 字符串，需 stringify
      base.designerJson = JSON.stringify(serializeDingtalk(editor.steps, editor.nodeProps, editor.flowConfig))
    } else {
      // GRAPH：designerJson 存归一化 ProcessModel（flow 设计器 getModel 产出，含坐标）。
      // 存量 BPMN 编辑时已在 openEdit 迁移为 GRAPH，故此处统一走 GRAPH 分支。
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
      if (saved?.id) setEditor((e) => ({ ...e, id: saved.id }))
      reload()
      return saved
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }

  /**
   * 打开发布确认：可传入编辑器现场校验的 issues（DINGTALK/GRAPH 设计器内发布）；
   * 未传时按 target.designerJson 现解析跑校验（列表「发布」按钮，仅 DINGTALK 有前端校验）。
   */
  const openPublish = (target: ProcessDefItem, precomputed?: ValidationIssue[]) => {
    let issues: ValidationIssue[] = precomputed ?? []
    if (!precomputed && target.designerType === "DINGTALK" && target.designerJson) {
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
        // GRAPH：走图直译一站式部署端点（ProcessModel → BpmnModel → Flowable 部署 + wf_process_ext 落库）
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
      // 后端转换/部署报错：留在弹窗内展示，方便排查
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
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void openEdit(row.original)}>
              <Pencil className="size-3.5" />
              编辑
            </Button>
            {row.original.designerType === "DINGTALK" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-violet-600 hover:text-violet-600"
                title="把这条仿钉钉旧定义转成流程图，用新 react-flow 设计器打开（实验）"
                onClick={() => void openInNewDesigner(row.original)}
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

      {/* 新建：选择设计器类型 + 绑定表单 */}
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

            {/* 表单绑定：二选一（动态表单 / 自定义表单） */}
            <div className="space-y-2">
              <Label>表单绑定</Label>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { type: "DYNAMIC", label: "动态表单", desc: "选择已发布的表单定义，可视化渲染" },
                    { type: "CUSTOM", label: "自定义表单", desc: "指定 React 路由页面作发起 / 详情表单" },
                  ] as const
                ).map((opt) => {
                  const active = createForm.formType === opt.type
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setCreateForm((f) => ({ ...f, formType: opt.type }))}
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
              {createForm.formType === "DYNAMIC" ? (
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
                    <Label htmlFor="pd-submit-path" className="text-xs text-muted-foreground">
                      发起页路由（formSubmitPath）
                    </Label>
                    <Input
                      id="pd-submit-path"
                      value={createForm.formSubmitPath}
                      onChange={(e) => setCreateForm((f) => ({ ...f, formSubmitPath: e.target.value }))}
                      placeholder="如 /flow/leave/create"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pd-view-path" className="text-xs text-muted-foreground">
                      详情查看路由（formViewPath）
                    </Label>
                    <Input
                      id="pd-view-path"
                      value={createForm.formViewPath}
                      onChange={(e) => setCreateForm((f) => ({ ...f, formViewPath: e.target.value }))}
                      placeholder="如 /flow/leave/view"
                      className="font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    发起 / 详情由自定义 React 页面渲染（运行时由 C 对齐 formType/路径契约）。
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
            <Button onClick={() => void confirmCreate()}>进入设计器</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 全屏设计器 Modal */}
      <Modal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={
          <span className="flex items-center gap-2">
            <Workflow className="size-4 text-primary" />
            {editor.id ? "编辑流程" : "设计流程"} · {editor.name}
            <Badge variant="secondary" className="ml-1 gap-1">
              {editor.designerType === "DINGTALK" ? "仿钉钉" : "流程图"}
            </Badge>
          </span>
        }
        description={
          editor.formCode
            ? `绑定表单：${formName(editor.formCode)} · 条件/审批人可引用表单字段`
            : "未绑定表单：条件与表单字段规则暂无可选字段"
        }
        width={1200}
        height={740}
        bodyClassName="p-0"
        footer={
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              编码 <span className="font-mono">{editor.defCode}</span>
            </span>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void doSave()}>
              {saving ? "保存中…" : "保存草稿"}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={saving}
              onClick={async () => {
                const saved = await doSave()
                if (saved?.id) {
                  // 设计器内发布：用编辑器现场校验（DINGTALK 走 validateFlow；GRAPH 走 flow 设计器 validate）
                  const issues =
                    editor.designerType === "DINGTALK"
                      ? validateFlow(editor.steps, editor.nodeProps)
                      : mapFlowIssues(flowRef.current?.validate() ?? [])
                  openPublish(saved, issues)
                }
              }}
            >
              <Send className="size-3.5" />
              保存并发布
            </Button>
          </>
        }
      >
        {editor.designerType === "DINGTALK" ? (
          <div className="h-full bg-muted/20">
            <DingtalkProcessDesigner
              steps={editor.steps}
              onStepsChange={(updater) =>
                setEditor((e) => ({
                  ...e,
                  steps:
                    typeof updater === "function" ? (updater as (s: StepNode[]) => StepNode[])(e.steps) : updater,
                }))
              }
              nodeProps={editor.nodeProps}
              onNodePropsChange={(updater) =>
                setEditor((e) => ({
                  ...e,
                  nodeProps:
                    typeof updater === "function"
                      ? (updater as (n: NodePropsMap) => NodePropsMap)(e.nodeProps)
                      : updater,
                }))
              }
              formFields={editor.formFields}
              base={{
                name: editor.name,
                description: editor.description,
                icon: editor.icon,
                category: editor.category,
              }}
              onBaseChange={(next: ProcessBase) =>
                setEditor((e) => ({
                  ...e,
                  name: next.name,
                  description: next.description,
                  icon: next.icon,
                  category: next.category,
                }))
              }
              flowConfig={editor.flowConfig}
              onFlowConfigChange={(flowConfig: FlowConfig) => setEditor((e) => ({ ...e, flowConfig }))}
            />
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-hidden bg-muted/20 p-3">
            <FlowDesigner
              key={editor.id ?? editor.defCode}
              ref={flowRef}
              embedded
              initialModel={editor.graphModel}
              processKey={editor.defCode}
              formKey={composeFormKey(editor.formCode, editor.formVersion)}
              base={{
                name: editor.name,
                description: editor.description,
                icon: editor.icon,
                category: editor.category,
              }}
              onBaseChange={(next: ProcessBase) =>
                setEditor((e) => ({
                  ...e,
                  name: next.name,
                  description: next.description,
                  icon: next.icon,
                  category: next.category,
                }))
              }
              formFields={editor.formFields}
            />
          </div>
        )}
      </Modal>

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
            <Button
              disabled={publishing || hasBlockingIssue(publishIssues)}
              onClick={() => void doPublish()}
            >
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
            <Button
              className="gap-1.5"
              disabled={ttSubmitting}
              onClick={() => void submitTimeTravel({})}
            >
              <Send className="size-3.5" /> 提交补审
            </Button>
          )}
        </div>
      </Modal>
    </div>
  )
}
