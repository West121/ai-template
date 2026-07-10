/**
 * 下一代流程设计器 · 预览页（切片 2）。
 *
 * 打通「建模 → 校验 → 序列化」闭环：
 *  - 左侧调色板拖拽 / 点击新增全部 14 类节点（onDrop 计算落点写入 position）。
 *  - 连线时按 BPMN 规则即时校验（非法连接拒绝 + toast 提示）。
 *  - 点选节点/边/画布，复用共享 PropertyPanel 编辑属性（面板本身不改）。
 *  - 「校验」按钮跑模型级校验器，列出 error/warning；「序列化」出 ProcessModel + 往返自检。
 *
 * 复用共享 PropertyPanel（不重写）：
 *  - 点击空白/流程 → target="process"，读写 ProcessConfig。
 *  - 点击 userTask → approval 分区；cc → 抄送分区；其余类型 → 通用（仅节点名）。
 *  - 点击边 → nodeType="condition"，编辑结构化分支条件 + 默认分支开关。
 *
 * 节点专属 config（ai/webhook/timer/service…）的深度编辑面板、elkjs 自动布局、
 * 旧 designerJson 迁移、只读运行时高亮、表单字段清单接入 —— 推迟到后续切片。
 */
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react"
import { addEdge, useEdgesState, useNodesState, type Connection, type Edge } from "@xyflow/react"
import { AlertTriangle, CircleCheck, Info, LayoutDashboard } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { FormulaDesigner } from "@/components/formula-designer"
import { ScriptEditor } from "@/components/script-editor"
import { FieldPermsEditor } from "@/components/field-perms-editor"
import { ErrorBoundary } from "@/components/error-boundary"
import "@/pages/workflow/forms" // 触发 CODE 表单登记（registerForm 副作用）
import { PropertyPanel } from "../shared/property-panel"
import { defaultFlowConfig, type FormFieldOption, type ProcessBase, type ProcessConfig } from "../shared/config"
import type { BranchCondition, WfNodeProps } from "../types"
import type { FlowNodeType, Point, ProcessModel, ScriptConfig, ServiceTaskConfig } from "./model"
import { FlowCanvas, type FlowCanvasApi } from "./canvas"
import { layoutFlow, needsLayout } from "./layout"
import { FlowPalette } from "./flow-palette"
import { PALETTE_INDEX } from "./node-catalog"
import { FormFieldsContext, NodeActionsContext, type NodeActions } from "./nodes/node-chrome"
import {
  SEQUENCE_FLOW_EDGE_TYPE,
  fromProcessModel,
  toProcessModel,
  type WfRfEdge,
  type WfRfNode,
  type WfValidationState,
} from "./serialize"
import { validateConnection, validateProcessModel, type ValidationIssue } from "./validate"

/** 是否为开发自检脚手架（序列化/往返自检 UI）——正式设计器隐藏（W-19） */
const DEV_SCAFFOLD = import.meta.env.DEV

/** 属性面板深度配置尚未开放的节点类型（W-20：给占位说明而非空白死胡同） */
const CONFIG_PENDING_TYPES = new Set(["ai", "webhook", "timerCatch", "timerBoundary", "callActivity", "subProcess"])

/* ---------- 演示种子（以 ProcessModel 契约撰写，经 fromProcessModel 载入，天然演示一次往返） ---------- */

const SEED_MODEL: ProcessModel = {
  schemaVersion: 1,
  key: "demo_leave",
  name: "请假审批（示例）",
  // 绑定 CODE 示范表单（registry 已登记 'leave'）：审批节点即可拉字段清单配字段权限
  formKey: "leave",
  flowConfig: defaultFlowConfig(),
  nodes: [
    { id: "start", type: "startEvent", name: "开始", position: { x: 260, y: 20 } },
    {
      id: "apply",
      type: "userTask",
      name: "部门主管审批",
      position: { x: 210, y: 130 },
      props: { assigneeRules: [{ kind: "LEADER", level: 1 }], multiMode: "ANY" },
    },
    { id: "gw", type: "exclusiveGateway", name: "金额判断", position: { x: 258, y: 280 } },
    {
      id: "mgr",
      type: "userTask",
      name: "总经理审批",
      position: { x: 430, y: 400 },
      props: { assigneeRules: [{ kind: "ACCOUNT", source: "FIXED", refs: [] }], multiMode: "ANY" },
    },
    { id: "end", type: "endEvent", name: "结束", position: { x: 260, y: 540 } },
  ],
  edges: [
    { id: "e_start_apply", source: "start", target: "apply" },
    { id: "e_apply_gw", source: "apply", target: "gw" },
    {
      id: "e_gw_mgr",
      source: "gw",
      target: "mgr",
      condition: { logic: "AND", items: [{ field: "days", operator: "gt", value: "3" }] },
    },
    { id: "e_gw_end", source: "gw", target: "end", isDefault: true },
    { id: "e_mgr_end", source: "mgr", target: "end" },
  ],
}

/* ---------- 供属性面板选择的示例表单字段（后续切片改由 FormFieldManifest 拉取） ---------- */

const SAMPLE_FIELDS: FormFieldOption[] = [
  { key: "days", label: "请假天数", isUser: false },
  { key: "reason", label: "请假事由", isUser: false },
  { key: "applicant", label: "申请人", isUser: true },
]

let idSeq = 0
const genId = (prefix: string) => `${prefix}_${(idSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`

type Selection = { kind: "process" } | { kind: "node"; id: string } | { kind: "edge"; id: string }

/** react-flow node.type → 共享面板分区键：userTask→approval、cc→cc，其余走通用（仅节点名） */
function panelNodeType(type: string | undefined): string {
  if (type === "userTask") return "approval"
  if (type === "cc") return "cc"
  return type ?? "node"
}

/** 命令式句柄：供嵌入方（流程定义页）在保存/发布时取当前 ProcessModel 与跑校验 */
export interface FlowDesignerHandle {
  /** 取当前画布的归一化 ProcessModel（含坐标，供 GRAPH 部署 / 保存 designerJson） */
  getModel: () => ProcessModel
  /** 保存前全量校验，返回问题清单（error 应阻止保存/发布） */
  validate: () => ValidationIssue[]
}

export interface FlowDesignerProps {
  /** 初始模型；缺省用内置示例（demo 页）。嵌入时由定义 designerJson 载入 */
  initialModel?: ProcessModel
  /** BPMN process id / defCode（写入 ProcessModel.key）；缺省取 initialModel.key */
  processKey?: string
  /** 绑定表单 formKey（formCode:version）；缺省取 initialModel.formKey */
  formKey?: string
  /** 流程级基础信息（受控）；嵌入 /workflow/defs 时与 ProcessDef 同步 */
  base?: ProcessBase
  onBaseChange?: (base: ProcessBase) => void
  /** 绑定表单字段，供条件/字段权限/办理人来源选择；缺省用内置示例字段 */
  formFields?: FormFieldOption[]
  /** 嵌入模式：隐藏页面级 PageHeader 与开发自检脚手架 */
  embedded?: boolean
  ref?: Ref<FlowDesignerHandle>
}

export function FlowDesigner({
  initialModel = SEED_MODEL,
  processKey,
  formKey,
  base,
  onBaseChange,
  formFields,
  embedded = false,
  ref,
}: FlowDesignerProps) {
  const fields = formFields ?? SAMPLE_FIELDS
  const effKey = processKey ?? initialModel.key
  const effFormKey = formKey ?? initialModel.formKey
  // 初始画布状态由 initialModel 派生一次（后续开合不同定义时由外层 key 强制重挂）
  const [seed] = useState(() => fromProcessModel(initialModel))
  const [nodes, setNodes, onNodesChange] = useNodesState<WfRfNode>(seed.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<WfRfEdge>(seed.edges)
  const [selection, setSelection] = useState<Selection>({ kind: "process" })
  const [processConfig, setProcessConfig] = useState<ProcessConfig>({
    base: base ?? { name: initialModel.name, description: "", icon: "📝", category: "人事" },
    flow: initialModel.flowConfig ?? defaultFlowConfig(),
  })
  // 流程级配置变更：更新本地态并把基础信息回传给嵌入方（与 ProcessDef 同步）
  const handleProcessConfigChange = useCallback(
    (next: ProcessConfig) => {
      setProcessConfig(next)
      onBaseChange?.(next.base)
    },
    [onBaseChange],
  )
  const [serialized, setSerialized] = useState<string>("")
  const [roundTripOk, setRoundTripOk] = useState<boolean | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  const canvasApiRef = useRef<FlowCanvasApi | null>(null)

  /* ---- 连线（即时 BPMN 连接规则校验） ---- */
  const onConnect = useCallback(
    (c: Connection) => {
      const src = nodes.find((n) => n.id === c.source)
      const tgt = nodes.find((n) => n.id === c.target)
      if (!src?.type || !tgt?.type) return
      const result = validateConnection(
        { id: src.id, type: src.type as FlowNodeType },
        { id: tgt.id, type: tgt.type as FlowNodeType },
        edges.map((e) => ({ source: e.source, target: e.target })),
      )
      if (!result.ok) {
        toast.error("无法连接", { description: result.reason })
        return
      }
      setEdges((eds) => addEdge<WfRfEdge>({ ...c, id: genId("edge"), type: SEQUENCE_FLOW_EDGE_TYPE, data: {} }, eds))
    },
    [nodes, edges, setEdges],
  )

  /* ---- 拖拽连线过程即时合法性反馈（W-11）：复用 validateConnection ---- */
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const src = nodes.find((n) => n.id === c.source)
      const tgt = nodes.find((n) => n.id === c.target)
      if (!src?.type || !tgt?.type) return false
      return validateConnection(
        { id: src.id, type: src.type as FlowNodeType },
        { id: tgt.id, type: tgt.type as FlowNodeType },
        edges.map((e) => ({ source: e.source, target: e.target })),
      ).ok
    },
    [nodes, edges],
  )

  /* ---- 调色板新增节点（点击视口中心 / 拖拽落点，W-17） ---- */
  const addNodeFromPalette = useCallback(
    (paletteKey: string, position: Point) => {
      const item = PALETTE_INDEX[paletteKey]
      if (!item) return
      const id = genId(item.type)
      setNodes((ns) => [...ns, { id, type: item.type, position, data: item.makeData() }])
      setSelection({ kind: "node", id })
    },
    [setNodes],
  )

  const pickFromPalette = useCallback(
    (paletteKey: string) => addNodeFromPalette(paletteKey, canvasApiRef.current?.toFlowCenter() ?? { x: 240, y: 120 }),
    [addNodeFromPalette],
  )

  /* ---- 节点悬浮操作：复制 / 删除（W-12） ---- */
  const nodeActions = useMemo<NodeActions>(
    () => ({
      copy: (id) => {
        const src = nodes.find((n) => n.id === id)
        if (!src?.type) return
        const newId = genId(src.type)
        const clone: WfRfNode = {
          id: newId,
          type: src.type,
          position: { x: src.position.x + 24, y: src.position.y + 24 },
          data: structuredClone(src.data),
        }
        setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...clone, selected: true }])
        setSelection({ kind: "node", id: newId })
      },
      remove: (id) => {
        const node = nodes.find((n) => n.id === id)
        if (node?.type === "startEvent") {
          toast.warning("开始事件不可删除")
          return
        }
        setNodes((ns) => ns.filter((n) => n.id !== id))
        setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
        setSelection({ kind: "process" })
      },
    }),
    [nodes, setNodes, setEdges],
  )

  /* ---- 改节点/边 ---- */
  const updateNodeProps = useCallback(
    (id: string, props: WfNodeProps) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, props } } : n))),
    [setNodes],
  )
  const updateNodeName = useCallback(
    (id: string, name: string) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, name } } : n))),
    [setNodes],
  )
  // serviceTask 脚本体读写（仅脚本模式有意义）
  const updateNodeScript = useCallback(
    (id: string, script: ScriptConfig) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, script } } : n))),
    [setNodes],
  )
  // serviceTask 脚本模式开关：开 → service.impl=script + 初始化 script；关 → 退回 delegate 并清除 script
  const setScriptMode = useCallback(
    (id: string, on: boolean) =>
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id) return n
          if (on) {
            const service: ServiceTaskConfig = { impl: "script" }
            return {
              ...n,
              data: { ...n.data, service, script: n.data.script ?? { lang: "groovy", code: "" } },
            }
          }
          const service: ServiceTaskConfig = { impl: "delegate", delegateExpression: "" }
          const nextData = { ...n.data, service }
          delete nextData.script
          return { ...n, data: nextData }
        }),
      ),
    [setNodes],
  )
  const updateEdgeCondition = useCallback(
    (id: string, condition: BranchCondition | undefined) =>
      setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, condition } } : e))),
    [setEdges],
  )
  const toggleEdgeDefault = useCallback(
    (id: string, isDefault: boolean) =>
      setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, isDefault } } : e))),
    [setEdges],
  )
  // 边高级公式条件（expression）：空串归一化为 undefined，避免序列化残留空字段
  const updateEdgeExpression = useCallback(
    (id: string, expression: string) =>
      setEdges((es) =>
        es.map((e) =>
          e.id === id
            ? { ...e, data: { ...e.data, expression: expression.trim() === "" ? undefined : expression } }
            : e,
        ),
      ),
    [setEdges],
  )

  /* ---- 模型级校验 ---- */
  const buildModel = useCallback(
    () =>
      toProcessModel(nodes, edges, {
        key: effKey,
        name: processConfig.base.name,
        formKey: effFormKey,
        flowConfig: processConfig.flow,
      }),
    [nodes, edges, processConfig, effKey, effFormKey],
  )

  // 命令式句柄：嵌入方（流程定义页）保存/发布时取模型 + 跑校验
  useImperativeHandle(ref, () => ({ getModel: buildModel, validate: () => validateProcessModel(buildModel()) }), [buildModel])

  const handleValidate = useCallback(() => {
    const found = validateProcessModel(buildModel())
    setIssues(found)
    const errors = found.filter((i) => i.level === "error").length
    if (errors > 0) toast.error(`校验未通过：${errors} 个错误`)
    else if (found.length > 0) toast.warning(`校验通过，但有 ${found.length} 个提示`)
    else toast.success("校验通过，无问题")
  }, [buildModel])

  /* ---- 序列化 + 往返自检 ---- */
  const handleSerialize = useCallback(() => {
    const pm = buildModel()
    const back = fromProcessModel(pm)
    const pm2 = toProcessModel(back.nodes, back.edges, { key: pm.key, name: pm.name, flowConfig: pm.flowConfig })
    const ok = JSON.stringify(pm) === JSON.stringify(pm2)
    // eslint-disable-next-line no-console
    console.log("[flow] ProcessModel", pm, "| round-trip equal:", ok)
    setSerialized(JSON.stringify(pm, null, 2))
    setRoundTripOk(ok)
  }, [buildModel])

  /* ---- 自动整理布局（dagre）：仅回写各节点 position，data/边不动，往返仍一致 ---- */
  const handleAutoLayout = useCallback(() => {
    setNodes((ns) => layoutFlow(ns, edges))
    canvasApiRef.current?.fitView()
  }, [edges, setNodes])

  // 导入 .bpmn / 迁移旧定义后坐标退化（挤在兜底位、相互重叠）→ 挂载时自动整理一次
  const didAutoLayout = useRef(false)
  useEffect(() => {
    if (didAutoLayout.current) return
    didAutoLayout.current = true
    if (needsLayout(seed.nodes)) {
      setNodes((ns) => layoutFlow(ns, seed.edges))
      canvasApiRef.current?.fitView()
    }
  }, [seed, setNodes])

  const nodeOptions = useMemo(
    () => nodes.filter((n) => n.type === "userTask").map((n) => ({ id: n.id, name: n.data.name })),
    [nodes],
  )

  const selectedNode = selection.kind === "node" ? nodes.find((n) => n.id === selection.id) : undefined
  const selectedEdge = selection.kind === "edge" ? edges.find((e) => e.id === selection.id) : undefined

  const errorCount = issues?.filter((i) => i.level === "error").length ?? 0
  const warningCount = (issues?.length ?? 0) - errorCount

  /* ---- 校验错误画布锚定（W-14）：据 issues 计算错误/警告元素集，注入渲染副本的 data.validation ---- */
  const { errorNodeIds, warnNodeIds, errorEdgeIds } = useMemo(() => {
    const en = new Set<string>()
    const wn = new Set<string>()
    const ee = new Set<string>()
    for (const it of issues ?? []) {
      if (it.nodeId) (it.level === "error" ? en : wn).add(it.nodeId)
      if (it.edgeId && it.level === "error") ee.add(it.edgeId)
    }
    return { errorNodeIds: en, warnNodeIds: wn, errorEdgeIds: ee }
  }, [issues])

  const displayNodes = useMemo(
    () =>
      nodes.map((n): WfRfNode => {
        const state: WfValidationState | undefined = errorNodeIds.has(n.id)
          ? "error"
          : warnNodeIds.has(n.id)
            ? "warning"
            : undefined
        return state ? { ...n, data: { ...n.data, validation: state } } : n
      }),
    [nodes, errorNodeIds, warnNodeIds],
  )

  const displayEdges = useMemo(
    () =>
      edges.map((e) =>
        errorEdgeIds.has(e.id) ? { ...e, data: { ...e.data, validation: "error" as const } } : e,
      ),
    [edges, errorEdgeIds],
  )

  /* ---- 校验清单点击 → 选中并居中该元素（W-14②） ---- */
  const focusIssue = useCallback((it: ValidationIssue) => {
    if (it.nodeId) {
      setSelection({ kind: "node", id: it.nodeId })
      canvasApiRef.current?.focus({ nodeId: it.nodeId })
    } else if (it.edgeId) {
      setSelection({ kind: "edge", id: it.edgeId })
      canvasApiRef.current?.focus({ edgeId: it.edgeId })
    }
  }, [])

  const handleCanvasReady = useCallback((api: FlowCanvasApi) => {
    canvasApiRef.current = api
  }, [])

  const showScaffold = DEV_SCAFFOLD && !embedded

  return (
    <div className={cn(embedded ? "flex h-full min-h-0 flex-col gap-3" : "space-y-3")}>
      {!embedded && (
        <PageHeader
          title="流程设计器"
          description="从左侧拖拽或点击新增节点，连线编排审批流程；连线即时校验，保存前可一键全量校验。"
        />
      )}

      {/* 工具栏 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">从左侧调色板拖拽或点击新增节点</span>
        <div className="ml-auto flex items-center gap-2">
          {showScaffold && roundTripOk !== null && (
            <span className={roundTripOk ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
              {roundTripOk ? "往返一致 ✓" : "往返不一致 ✗"}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={handleAutoLayout}
            title="按有向图自动排布节点坐标（仅整理布局，不改配置）"
          >
            <LayoutDashboard className="size-3.5" /> 整理布局
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleValidate}>
            校验
          </Button>
          {showScaffold && (
            <Button size="sm" className="h-7 text-xs" onClick={handleSerialize}>
              序列化 ProcessModel
            </Button>
          )}
        </div>
      </div>

      {/* 校验结果（W-14：每条可点击定位到画布元素；W-15：状态色走 token） */}
      {issues !== null && (
        <div className="shrink-0 rounded-lg border bg-card px-3 py-2 text-xs">
          {issues.length === 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="size-3.5" /> 校验通过，无问题
            </div>
          ) : (
            <>
              <div className="mb-1.5 font-medium text-muted-foreground">
                共 {errorCount} 个错误 · {warningCount} 个提示
                {errorCount > 0 && "（错误应在保存前修复）"}
              </div>
              <ul className="space-y-0.5">
                {issues.map((it, i) => {
                  const locatable = Boolean(it.nodeId || it.edgeId)
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={!locatable}
                        onClick={() => focusIssue(it)}
                        className={cn(
                          "flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left",
                          it.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                          locatable ? "hover:bg-accent" : "cursor-default",
                        )}
                        title={locatable ? "点击定位到画布元素" : undefined}
                      >
                        {it.level === "error" ? (
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        ) : (
                          <Info className="mt-0.5 size-3.5 shrink-0" />
                        )}
                        <span>{it.message}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {/* 调色板 + 画布 + 属性面板 */}
      <NodeActionsContext.Provider value={nodeActions}>
        <FormFieldsContext.Provider value={fields}>
          <div
            className={cn(
              "flex overflow-hidden rounded-lg border",
              embedded ? "min-h-0 flex-1" : "h-[68vh]",
            )}
          >
            <FlowPalette onPick={pickFromPalette} />

            <div className="min-w-0 flex-1">
              <FlowCanvas
                nodes={displayNodes}
                edges={displayEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                onNodeSelect={(id) => setSelection({ kind: "node", id })}
                onEdgeSelect={(id) => setSelection({ kind: "edge", id })}
                onPaneClick={() => setSelection({ kind: "process" })}
                onDropNode={addNodeFromPalette}
                onReady={handleCanvasReady}
              />
            </div>

            <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l">
          <ErrorBoundary key={`panel:${selection.kind}:${selectedNode?.id ?? selectedEdge?.id ?? "process"}`} label="designer-panel">
          {selectedNode ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PropertyPanel
                target={{ nodeId: selectedNode.id, nodeType: panelNodeType(selectedNode.type) }}
                config={selectedNode.data.props ?? {}}
                onChange={(next: WfNodeProps) => updateNodeProps(selectedNode.id, next)}
                formFields={fields}
                nodeName={selectedNode.data.name}
                onNodeNameChange={(name) => updateNodeName(selectedNode.id, name)}
                nodeOptions={nodeOptions.filter((n) => n.id !== selectedNode.id)}
                flowConfig={processConfig.flow}
              />
              {/* 服务任务：脚本模式（scriptTask）——不改共享 PropertyPanel，在设计器侧配置区渲染脚本编辑器（参照边级高级公式条件的做法） */}
              {selectedNode.type === "serviceTask" && (
                <div className="space-y-2 border-t px-3.5 py-3">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">脚本模式（scriptTask）</span>
                    <Switch
                      checked={selectedNode.data.service?.impl === "script"}
                      onCheckedChange={(v) => setScriptMode(selectedNode.id, v)}
                    />
                  </label>
                  {selectedNode.data.service?.impl === "script" ? (
                    <ScriptEditor
                      value={selectedNode.data.script ?? { lang: "groovy", code: "" }}
                      onChange={(next) => updateNodeScript(selectedNode.id, next)}
                    />
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      开启后该服务任务改为脚本任务，序列化为 <code className="font-mono">service.impl=&quot;script&quot;</code> + <code className="font-mono">script</code>，由后端脚本引擎执行。
                    </p>
                  )}
                </div>
              )}
              {/* 节点字段权限（N-F-07）：审批类节点 + 流程有 formKey 时，按清单渲染 可见/可编辑/必填 矩阵。
                  不改共享 PropertyPanel——在设计器侧配置区渲染（同 scriptTask / 边级高级公式条件的做法）。 */}
              {selectedNode.type === "userTask" && effFormKey && (
                <div className="space-y-2 border-t px-3.5 py-3">
                  <div className="text-xs font-medium">节点字段权限</div>
                  <p className="text-[11px] text-muted-foreground">
                    按表单「{effFormKey}」字段清单配置本节点的字段显隐 / 可编辑；运行时由 <code className="font-mono">HostedForm</code> 套用。
                  </p>
                  <FieldPermsEditor
                    formKey={effFormKey}
                    value={selectedNode.data.props?.formPerms ?? {}}
                    onChange={(formPerms) =>
                      updateNodeProps(selectedNode.id, { ...(selectedNode.data.props ?? {}), formPerms })
                    }
                  />
                </div>
              )}
              {/* W-20：深度配置尚未开放的节点类型给占位说明，避免面板空白像坏了 */}
              {CONFIG_PENDING_TYPES.has(selectedNode.type ?? "") && (
                <p className="border-t px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
                  该节点的详细配置（如模型 / 回调地址 / 定时 / 子流程绑定）将在后续版本开放，当前可先编辑节点名称。
                </p>
              )}
            </div>
          ) : selectedEdge ? (
            <>
              <label className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
                <span className="text-xs font-medium">默认分支（其他条件都不满足时进入）</span>
                <Switch
                  checked={selectedEdge.data?.isDefault ?? false}
                  onCheckedChange={(v) => toggleEdgeDefault(selectedEdge.id, v)}
                />
              </label>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedEdge.data?.isDefault ? (
                  // 默认分支按 BPMN 规范无条件（附录 C.4）：不展示条件/公式编辑，给明确说明
                  <p className="px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">默认分支</span>：网关其它出边条件都不满足时进入，
                    按 BPMN 规范<span className="font-medium">无需也不可配置条件</span>。
                    如需改为「按条件进入」，请先关闭上方「默认分支」开关，再配置结构化条件或高级公式。
                  </p>
                ) : (
                  <>
                    <PropertyPanel
                      target={{ nodeId: selectedEdge.id, nodeType: "condition" }}
                      config={{ condition: selectedEdge.data?.condition }}
                      onChange={(next: WfNodeProps) => updateEdgeCondition(selectedEdge.id, next.condition)}
                      formFields={fields}
                      branchMeta={{ isDefault: false, priority: 1 }}
                    />
                    {/* 高级公式条件（Tier 1）：与上方结构化条件二选一，非空时优先（见 model.ts 边条件三态） */}
                    <div className="space-y-1.5 border-t px-3.5 py-3">
                      <div className="text-xs font-medium">高级公式条件（expression）</div>
                      <p className="text-[11px] text-muted-foreground">
                        结构化条件表达不了时用公式；与上方结构化条件二选一，配置后优先生效。前端仅即时校验/预览，提交以后端为准。
                      </p>
                      <FormulaDesigner
                        value={selectedEdge.data?.expression ?? ""}
                        onChange={(expr) => updateEdgeExpression(selectedEdge.id, expr)}
                        fields={fields}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
              ) : (
                <PropertyPanel target="process" config={processConfig} onChange={handleProcessConfigChange} formFields={fields} />
              )}
          </ErrorBoundary>
            </aside>
          </div>
        </FormFieldsContext.Provider>
      </NodeActionsContext.Provider>

      {/* 序列化结果（开发自检脚手架，W-19 正式设计器隐藏） */}
      {showScaffold && serialized && (
        <details open className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-3.5 py-2 text-xs font-medium text-muted-foreground">
            序列化 ProcessModel（JSON，已做 pm→rf→pm 往返自检）
          </summary>
          <pre className="max-h-72 overflow-auto border-t px-3.5 py-3 text-[11px] leading-relaxed">{serialized}</pre>
        </details>
      )}
    </div>
  )
}

/** 独立预览页（/demo/flow-designer 路由）：内置示例模型 + 页面头，薄封装 FlowDesigner */
export default function FlowDesignerPage() {
  return <FlowDesigner />
}
