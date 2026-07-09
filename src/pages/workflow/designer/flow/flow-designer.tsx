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
import { useCallback, useMemo, useState } from "react"
import { addEdge, useEdgesState, useNodesState, type Connection } from "@xyflow/react"
import { AlertTriangle, CircleCheck, Info } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { FormulaDesigner } from "@/components/formula-designer"
import { PropertyPanel } from "../shared/property-panel"
import { defaultFlowConfig, type FormFieldOption, type ProcessConfig } from "../shared/config"
import type { BranchCondition, WfNodeProps } from "../types"
import type { FlowNodeType, Point, ProcessModel } from "./model"
import { FlowCanvas } from "./canvas"
import { FlowPalette } from "./flow-palette"
import { PALETTE_INDEX } from "./node-catalog"
import {
  SEQUENCE_FLOW_EDGE_TYPE,
  fromProcessModel,
  toProcessModel,
  type WfRfEdge,
  type WfRfNode,
} from "./serialize"
import { validateConnection, validateProcessModel, type ValidationIssue } from "./validate"

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

let idSeq = 0
const genId = (prefix: string) => `${prefix}_${(idSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`

type Selection = { kind: "process" } | { kind: "node"; id: string } | { kind: "edge"; id: string }

/** react-flow node.type → 共享面板分区键：userTask→approval、cc→cc，其余走通用（仅节点名） */
function panelNodeType(type: string | undefined): string {
  if (type === "userTask") return "approval"
  if (type === "cc") return "cc"
  return type ?? "node"
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
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)

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

  /* ---- 调色板新增节点（点击默认位置 / 拖拽落点） ---- */
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
    (paletteKey: string) => addNodeFromPalette(paletteKey, { x: 480, y: 40 + nodes.length * 22 }),
    [addNodeFromPalette, nodes.length],
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
        key: SEED_MODEL.key,
        name: processConfig.base.name,
        flowConfig: processConfig.flow,
      }),
    [nodes, edges, processConfig],
  )

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

  const nodeOptions = useMemo(
    () => nodes.filter((n) => n.type === "userTask").map((n) => ({ id: n.id, name: n.data.name })),
    [nodes],
  )

  const selectedNode = selection.kind === "node" ? nodes.find((n) => n.id === selection.id) : undefined
  const selectedEdge = selection.kind === "edge" ? edges.find((e) => e.id === selection.id) : undefined

  const errorCount = issues?.filter((i) => i.level === "error").length ?? 0

  return (
    <div className="space-y-3">
      <PageHeader
        title="下一代流程设计器（切片 2）"
        description="14 类节点 + 调色板拖拽新增 + BPMN 连接规则校验（连线即时 / 保存前）+ ProcessModel 序列化往返"
      />

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">从左侧调色板拖拽或点击新增节点</span>
        <div className="ml-auto flex items-center gap-2">
          {roundTripOk !== null && (
            <span className={roundTripOk ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
              {roundTripOk ? "往返一致 ✓" : "往返不一致 ✗"}
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleValidate}>
            校验
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSerialize}>
            序列化 ProcessModel
          </Button>
        </div>
      </div>

      {/* 校验结果 */}
      {issues !== null && (
        <div className="rounded-lg border bg-card px-3 py-2 text-xs">
          {issues.length === 0 ? (
            <div className="flex items-center gap-1.5 text-emerald-600">
              <CircleCheck className="size-3.5" /> 校验通过，无问题
            </div>
          ) : (
            <ul className="space-y-1">
              {issues.map((it, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-1.5",
                    it.level === "error" ? "text-rose-600" : "text-amber-600",
                  )}
                >
                  {it.level === "error" ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  <span>{it.message}</span>
                </li>
              ))}
            </ul>
          )}
          {errorCount > 0 && <p className="mt-1.5 text-muted-foreground">共 {errorCount} 个错误应在保存前修复。</p>}
        </div>
      )}

      {/* 调色板 + 画布 + 属性面板 */}
      <div className="flex h-[68vh] overflow-hidden rounded-lg border">
        <FlowPalette onPick={pickFromPalette} />

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
            onDropNode={addNodeFromPalette}
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
              <div className="min-h-0 flex-1 overflow-y-auto">
                <PropertyPanel
                  target={{ nodeId: selectedEdge.id, nodeType: "condition" }}
                  config={{ condition: selectedEdge.data?.condition }}
                  onChange={(next: WfNodeProps) => updateEdgeCondition(selectedEdge.id, next.condition)}
                  formFields={SAMPLE_FIELDS}
                  branchMeta={{ isDefault: selectedEdge.data?.isDefault ?? false, priority: 1 }}
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
                    fields={SAMPLE_FIELDS}
                  />
                </div>
              </div>
            </>
          ) : (
            <PropertyPanel target="process" config={processConfig} onChange={setProcessConfig} formFields={SAMPLE_FIELDS} />
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
