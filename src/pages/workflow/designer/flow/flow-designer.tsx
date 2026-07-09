/**
 * 下一代流程设计器 · 最小可用页面（切片 1）。
 *
 * 打通「建模 → 序列化」闭环：加开始/审批/网关/结束节点、连线、点选节点/边/画布编辑属性、
 * 一键序列化出 `ProcessModel` 并做一次往返自检（console + 页面展示）。
 *
 * 复用共享 PropertyPanel（不重写）：
 *  - 点击空白/流程 → target="process"，读写 ProcessConfig。
 *  - 点击 userTask 节点 → target={nodeId,nodeType:"approval"}，props 读写走 node.data.props。
 *  - 点击其它节点 → 通用 target（仅节点名）。
 *  - 点击边 → target={nodeId:edgeId,nodeType:"condition"}，编辑该顺序流的结构化分支条件；
 *    默认分支开关在面板上方单独提供（ConditionEditor 本身不含 isDefault 切换）。
 *
 * 调色板拖拽、其余节点类型、BPMN 连接规则校验、自动布局、.bpmn 导入导出、只读高亮 —— 推迟。
 */
import { useCallback, useMemo, useState } from "react"
import { addEdge, useEdgesState, useNodesState, type Connection } from "@xyflow/react"
import { CircleDot, GitFork, Square, UserCheck } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { PropertyPanel } from "../shared/property-panel"
import { defaultFlowConfig, type FormFieldOption, type ProcessConfig } from "../shared/config"
import type { BranchCondition, WfNodeProps } from "../types"
import type { FlowNodeType, ProcessModel } from "./model"
import { FlowCanvas } from "./canvas"
import {
  SEQUENCE_FLOW_EDGE_TYPE,
  fromProcessModel,
  toProcessModel,
  type WfNodeData,
  type WfRfEdge,
  type WfRfNode,
} from "./serialize"

/* ---------- 演示种子（以 ProcessModel 契约撰写，经 fromProcessModel 载入，天然演示一次往返） ---------- */

const SEED_MODEL: ProcessModel = {
  schemaVersion: 1,
  key: "demo_leave",
  name: "请假审批（示例）",
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

const SEED = fromProcessModel(SEED_MODEL)

/* ---------- 供属性面板选择的示例表单字段（后续切片改由 FormFieldManifest 拉取） ---------- */

const SAMPLE_FIELDS: FormFieldOption[] = [
  { key: "days", label: "请假天数", isUser: false },
  { key: "reason", label: "请假事由", isUser: false },
  { key: "applicant", label: "申请人", isUser: true },
]

const NODE_DEFAULT_NAME: Record<FlowNodeType, string> = {
  startEvent: "开始",
  endEvent: "结束",
  userTask: "审批节点",
  exclusiveGateway: "网关",
  serviceTask: "服务任务",
  parallelGateway: "并行网关",
  inclusiveGateway: "包容网关",
  callActivity: "子流程调用",
  subProcess: "子流程",
  timerCatch: "定时",
  timerBoundary: "边界定时",
  cc: "抄送",
  ai: "AI 审批",
  webhook: "Webhook",
}

let idSeq = 0
const genId = (prefix: string) => `${prefix}_${(idSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`

type Selection = { kind: "process" } | { kind: "node"; id: string } | { kind: "edge"; id: string }

/** userTask → 面板 approval 分区；其余类型走通用（仅节点名） */
function panelNodeType(type: string | undefined): string {
  return type === "userTask" ? "approval" : type ?? "node"
}

export default function FlowDesignerPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<WfRfNode>(SEED.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<WfRfEdge>(SEED.edges)
  const [selection, setSelection] = useState<Selection>({ kind: "process" })
  const [processConfig, setProcessConfig] = useState<ProcessConfig>({
    base: { name: SEED_MODEL.name, description: "", icon: "📝", category: "人事" },
    flow: SEED_MODEL.flowConfig ?? defaultFlowConfig(),
  })
  const [serialized, setSerialized] = useState<string>("")
  const [roundTripOk, setRoundTripOk] = useState<boolean | null>(null)

  /* ---- 连线 ---- */
  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge<WfRfEdge>(
          { ...c, id: genId("edge"), type: SEQUENCE_FLOW_EDGE_TYPE, data: {} },
          eds,
        ),
      ),
    [setEdges],
  )

  /* ---- 增删改节点/边 ---- */
  const addNode = useCallback(
    (type: FlowNodeType) => {
      const id = genId(type)
      const data: WfNodeData = { name: NODE_DEFAULT_NAME[type] }
      setNodes((ns) => [
        ...ns,
        { id, type, position: { x: 460, y: 40 + ns.length * 24 }, data },
      ])
      setSelection({ kind: "node", id })
    },
    [setNodes],
  )

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

  /* ---- 序列化 + 往返自检 ---- */
  const handleSerialize = useCallback(() => {
    const pm = toProcessModel(nodes, edges, {
      key: SEED_MODEL.key,
      name: processConfig.base.name,
      flowConfig: processConfig.flow,
    })
    const back = fromProcessModel(pm)
    const pm2 = toProcessModel(back.nodes, back.edges, {
      key: pm.key,
      name: pm.name,
      flowConfig: pm.flowConfig,
    })
    const ok = JSON.stringify(pm) === JSON.stringify(pm2)
    // eslint-disable-next-line no-console
    console.log("[flow] ProcessModel", pm, "| round-trip equal:", ok)
    setSerialized(JSON.stringify(pm, null, 2))
    setRoundTripOk(ok)
  }, [nodes, edges, processConfig])

  const nodeOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "userTask")
        .map((n) => ({ id: n.id, name: n.data.name })),
    [nodes],
  )

  const selectedNode =
    selection.kind === "node" ? nodes.find((n) => n.id === selection.id) : undefined
  const selectedEdge =
    selection.kind === "edge" ? edges.find((e) => e.id === selection.id) : undefined

  return (
    <div className="space-y-3">
      <PageHeader
        title="下一代流程设计器（切片 1）"
        description="react-flow 画布核心 · 开始/审批/排它网关/结束四类节点 + 顺序流 · 序列化往返 ProcessModel"
      />

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">添加节点：</span>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => addNode("startEvent")}>
          <CircleDot className="size-3.5 text-emerald-500" /> 开始
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => addNode("userTask")}>
          <UserCheck className="size-3.5 text-orange-500" /> 审批
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => addNode("exclusiveGateway")}>
          <GitFork className="size-3.5 text-amber-500" /> 排它网关
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => addNode("endEvent")}>
          <Square className="size-3.5 text-slate-500" /> 结束
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {roundTripOk !== null && (
            <span className={roundTripOk ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
              {roundTripOk ? "往返一致 ✓" : "往返不一致 ✗"}
            </span>
          )}
          <Button size="sm" className="h-7 text-xs" onClick={handleSerialize}>
            序列化 ProcessModel
          </Button>
        </div>
      </div>

      {/* 画布 + 属性面板 */}
      <div className="flex h-[68vh] overflow-hidden rounded-lg border">
        <div className="min-w-0 flex-1">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeSelect={(id) => setSelection({ kind: "node", id })}
            onEdgeSelect={(id) => setSelection({ kind: "edge", id })}
            onPaneClick={() => setSelection({ kind: "process" })}
          />
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l">
          {selectedNode ? (
            <PropertyPanel
              target={{ nodeId: selectedNode.id, nodeType: panelNodeType(selectedNode.type) }}
              config={selectedNode.data.props ?? {}}
              onChange={(next: WfNodeProps) => updateNodeProps(selectedNode.id, next)}
              formFields={SAMPLE_FIELDS}
              nodeName={selectedNode.data.name}
              onNodeNameChange={(name) => updateNodeName(selectedNode.id, name)}
              nodeOptions={nodeOptions.filter((n) => n.id !== selectedNode.id)}
              flowConfig={processConfig.flow}
            />
          ) : selectedEdge ? (
            <>
              <label className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
                <span className="text-xs font-medium">默认分支（其他条件都不满足时进入）</span>
                <Switch
                  checked={selectedEdge.data?.isDefault ?? false}
                  onCheckedChange={(v) => toggleEdgeDefault(selectedEdge.id, v)}
                />
              </label>
              <div className="min-h-0 flex-1 overflow-hidden">
                <PropertyPanel
                  target={{ nodeId: selectedEdge.id, nodeType: "condition" }}
                  config={{ condition: selectedEdge.data?.condition }}
                  onChange={(next: WfNodeProps) => updateEdgeCondition(selectedEdge.id, next.condition)}
                  formFields={SAMPLE_FIELDS}
                  branchMeta={{ isDefault: selectedEdge.data?.isDefault ?? false, priority: 1 }}
                />
              </div>
            </>
          ) : (
            <PropertyPanel
              target="process"
              config={processConfig}
              onChange={setProcessConfig}
              formFields={SAMPLE_FIELDS}
            />
          )}
        </aside>
      </div>

      {/* 序列化结果 */}
      {serialized && (
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
