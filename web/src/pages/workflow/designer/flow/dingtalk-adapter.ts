/**
 * 钉钉 designerJson → 归一化 `ProcessModel` 迁移适配器（收尾三小项 · 项3，附录 A.4「树→图的一次性转写」）。
 *
 * 目的：让旧钉钉线性/分支树定义也能在新 react-flow 设计器打开。旧 `designerJson` 是
 * **嵌套线性树**（`nodes[]` + `branches[].steps[]`），没有 startEvent/endEvent、没有网关节点、
 * 没有边、没有坐标；本适配器把它展开为扁平 `nodes[]` + 显式 `edges[]` 的图：
 *  - 合成唯一 `startEvent` / `endEvent`；
 *  - 叶子节点按附录 A.3 映射（approval→userTask、cc→cc、subprocess→callActivity、timer→timerCatch、
 *    trigger/autoApprove/autoReject→serviceTask{impl}、ai→ai）；
 *  - condition/inclusive/parallel → 成对网关（split/join）+ 分支出边，分支条件搬到 `edge.condition`、
 *    默认分支搬到 `edge.isDefault`（附录 A.4 条件位置搬迁）；
 *  - autoReject 显式尾接 `endEvent{terminate:true}`（附录 C.3 迁移工具自动补 terminate end）；
 *  - 最后跑一次 dagre 自动布局补坐标（旧模型无坐标）。
 *
 * 复用既有 `deserializeDingtalk`：先把原始 designerJson 解析成内部 `{ steps, nodeProps, flowConfig }`
 * （沿用其办理人规则归一化 + 条件符号↔枚举映射，避免重复且降漂移），再做树→图转写。
 *
 * 完成度 / 已知边界（详见收尾报告）：
 *  - 覆盖：线性链 + condition/inclusive/parallel 分支（含嵌套）+ 全部叶子节点类型 + autoReject 终止。
 *  - **不覆盖**：钉钉模型本就没有的能力（嵌入式 subProcess、timerBoundary、parallel 的显式 join 语义
 *    差异、trigger.TIMER 前置延时的显式 timerCatch 拆分）——这些旧定义里不存在，故不失真。
 *  - autoReject 后若仍挂后继步骤（异常老数据），后继视为不可达并丢弃（终止端之后无出边）。
 *
 * 禁 any；类型导入一律 import type（verbatimModuleSyntax）。
 */
import type { BranchCondition, NodePropsMap } from "../types"
import { isBranchContainer } from "../dingtalk/model"
import type { BranchContainerStep, StepNode } from "../dingtalk/model"
import { deserializeDingtalk, isBackendDesignerJson } from "../dingtalk/serialize"
import type { FlowNode, ProcessModel, SequenceFlow } from "./model"
import { fromProcessModel, toProcessModel } from "./serialize"
import { layoutFlow } from "./layout"

/** 迁移元信息（覆盖 process key/name/formKey；缺省给占位） */
export interface DingtalkMigrateMeta {
  key?: string
  name?: string
  formKey?: string
}

/** 转写累加器 */
interface Builder {
  nodes: FlowNode[]
  edges: SequenceFlow[]
  edgeSeq: number
}

/** 边的可选装饰（仅条件/默认；id/source/target 由 mkEdge 控制） */
interface EdgeExtra {
  condition?: BranchCondition
  isDefault?: boolean
}

function mkEdge(b: Builder, source: string, target: string, extra: EdgeExtra = {}): void {
  const e: SequenceFlow = { id: `edge_${b.edgeSeq++}`, source, target }
  if (extra.condition) e.condition = extra.condition
  if (extra.isDefault) e.isDefault = true
  b.edges.push(e)
}

const ORIGIN = { x: 0, y: 0 }

/** 叶子步骤 → 单个 FlowNode（审批域属性从 nodeProps 取）。分支容器与 autoReject 另行处理。 */
function leafNode(step: StepNode, nodeProps: NodePropsMap): FlowNode {
  switch (step.kind) {
    case "approval": {
      const node: FlowNode = { id: step.id, type: "userTask", name: step.name, position: ORIGIN }
      const props = nodeProps[step.id]
      if (props) node.props = props
      return node
    }
    case "cc": {
      const node: FlowNode = { id: step.id, type: "cc", name: step.name, position: ORIGIN }
      const props = nodeProps[step.id]
      if (props) node.props = props
      return node
    }
    case "subprocess":
      return {
        id: step.id,
        type: "callActivity",
        name: step.name,
        position: ORIGIN,
        callActivity: { calledElement: step.defCode, async: step.async, paramMap: step.paramMap },
      }
    case "timer":
      return {
        id: step.id,
        type: "timerCatch",
        name: step.name,
        position: ORIGIN,
        timer: { mode: step.mode, value: step.value },
      }
    case "trigger": {
      const node: FlowNode = {
        id: step.id,
        type: "serviceTask",
        name: step.name,
        position: ORIGIN,
        service: {
          impl: "trigger",
          triggerType: step.triggerType,
          ...(step.handler ? { handler: step.handler } : {}),
          ...(step.webhookUrl ? { webhookUrl: step.webhookUrl } : {}),
          ...(step.timer ? { timer: step.timer } : {}),
        },
      }
      return node
    }
    case "ai":
      return {
        id: step.id,
        type: "ai",
        name: step.name,
        position: ORIGIN,
        ai: {
          model: step.model,
          systemPrompt: step.systemPrompt,
          formContext: step.formContext,
          outputMap: step.outputMap,
        },
      }
    case "autoApprove":
      return { id: step.id, type: "serviceTask", name: step.name, position: ORIGIN, service: { impl: "autoApprove" } }
    case "autoReject":
      return { id: step.id, type: "serviceTask", name: step.name, position: ORIGIN, service: { impl: "autoReject" } }
    default:
      // 分支容器不应走到这里（由 emitStep 分流）
      throw new Error(`leafNode：非叶子步骤「${step.kind}」`)
  }
}

/** 单步 → 图片段，返回入口节点 id 与开放出口（需连向后继的节点 id 集）。 */
function emitStep(
  step: StepNode,
  nodeProps: NodePropsMap,
  b: Builder,
): { entry: string; exits: string[] } {
  if (isBranchContainer(step)) return emitContainer(step, nodeProps, b)

  if (step.kind === "autoReject") {
    // 附录 C.3：自动拒绝显式尾接 terminate 结束事件，本分支到此终止（无开放出口）
    b.nodes.push(leafNode(step, nodeProps))
    const termId = `${step.id}_term`
    b.nodes.push({ id: termId, type: "endEvent", name: "已拒绝", position: ORIGIN, terminate: true })
    mkEdge(b, step.id, termId)
    return { entry: step.id, exits: [] }
  }

  b.nodes.push(leafNode(step, nodeProps))
  return { entry: step.id, exits: [step.id] }
}

/** 步骤序列 → 链，返回链入口（空链为 null）与末端开放出口。终止端之后的步骤视为不可达并丢弃。 */
function emitList(
  steps: StepNode[],
  nodeProps: NodePropsMap,
  b: Builder,
): { entry: string | null; exits: string[] } {
  if (steps.length === 0) return { entry: null, exits: [] }
  const first = emitStep(steps[0], nodeProps, b)
  let open = first.exits
  for (let i = 1; i < steps.length; i++) {
    if (open.length === 0) break // 前一步为终止端（autoReject），后继不可达
    const cur = emitStep(steps[i], nodeProps, b)
    for (const o of open) mkEdge(b, o, cur.entry)
    open = cur.exits
  }
  return { entry: first.entry, exits: open }
}

type GatewayType = "exclusiveGateway" | "parallelGateway" | "inclusiveGateway"

const GATEWAY_TYPE: Record<BranchContainerStep["kind"], GatewayType> = {
  condition: "exclusiveGateway",
  inclusive: "inclusiveGateway",
  parallel: "parallelGateway",
}

/** 构造网关 FlowNode（switch 让 type 收窄到具体网关变体，满足判别联合类型检查）。 */
function gatewayNode(id: string, type: GatewayType, name: string): FlowNode {
  switch (type) {
    case "exclusiveGateway":
      return { id, type, name, position: ORIGIN }
    case "parallelGateway":
      return { id, type, name, position: ORIGIN }
    case "inclusiveGateway":
      return { id, type, name, position: ORIGIN }
  }
}

/** 分支容器 → 成对网关（split/join）+ 各分支子链，分支条件/默认搬到出边。 */
function emitContainer(
  step: BranchContainerStep,
  nodeProps: NodePropsMap,
  b: Builder,
): { entry: string; exits: string[] } {
  const gwType = GATEWAY_TYPE[step.kind]
  const splitId = `${step.id}_split`
  const joinId = `${step.id}_join`
  b.nodes.push(gatewayNode(splitId, gwType, step.name))
  b.nodes.push(gatewayNode(joinId, gwType, `${step.name}·汇聚`))

  const isParallel = step.kind === "parallel"
  const lastIndex = step.branches.length - 1
  let joinHasIncoming = false

  step.branches.forEach((branch, i) => {
    // 条件/包容：最后一条为默认分支（与 dingtalk serialize 口径一致）；并行无条件无默认
    const isDefault = !isParallel && i === lastIndex
    const stored = nodeProps[branch.id]?.condition
    const extra: EdgeExtra = {}
    if (isDefault) {
      extra.isDefault = true
    } else if (!isParallel && stored && stored.items.length > 0) {
      extra.condition = { logic: stored.logic, items: stored.items }
    }

    const inner = emitList(branch.steps, nodeProps, b)
    if (inner.entry === null) {
      // 空分支：split 直连 join，条件挂在这条边
      mkEdge(b, splitId, joinId, extra)
      joinHasIncoming = true
    } else {
      mkEdge(b, splitId, inner.entry, extra)
      for (const ex of inner.exits) {
        mkEdge(b, ex, joinId)
        joinHasIncoming = true
      }
    }
  })

  // 全分支皆终止端（无回流到 join）→ join 无入边，容器无开放出口
  return { entry: splitId, exits: joinHasIncoming ? [joinId] : [] }
}

/**
 * 钉钉 designerJson（后端 `{ nodes, flowConfig }` 格式）→ 归一化 `ProcessModel`（含 dagre 补出的坐标）。
 * @throws 当 designerJson 非可识别的钉钉后端格式（缺 nodes 数组）时抛清晰错误。
 */
export function dingtalkToProcessModel(designerJson: unknown, meta: DingtalkMigrateMeta = {}): ProcessModel {
  if (!isBackendDesignerJson(designerJson)) {
    throw new Error("dingtalkToProcessModel：无法识别的钉钉 designerJson（应为含 nodes 数组的后端格式）")
  }
  const { steps, nodeProps, flowConfig } = deserializeDingtalk(designerJson)

  const b: Builder = { nodes: [], edges: [], edgeSeq: 0 }
  const startId = "start"
  const endId = "end"
  b.nodes.push({ id: startId, type: "startEvent", name: "开始", position: ORIGIN })

  const body = emitList(steps, nodeProps, b)

  // 结束事件：主链有开放出口时接入；空流程 start 直连 end
  const endNode: FlowNode = { id: endId, type: "endEvent", name: "结束", position: ORIGIN }
  b.nodes.push(endNode)
  if (body.entry === null) {
    mkEdge(b, startId, endId)
  } else {
    mkEdge(b, startId, body.entry)
    for (const ex of body.exits) mkEdge(b, ex, endId)
  }

  const pm0: ProcessModel = {
    schemaVersion: 1,
    key: meta.key ?? "migrated_process",
    name: meta.name ?? "迁移流程",
    nodes: b.nodes,
    edges: b.edges,
    flowConfig,
  }
  if (meta.formKey) pm0.formKey = meta.formKey

  // 旧模型无坐标：跑一次 dagre 自动布局补 position（只改坐标，其余无损）
  const rf = fromProcessModel(pm0)
  const laid = layoutFlow(rf.nodes, rf.edges)
  return toProcessModel(laid, rf.edges, {
    key: pm0.key,
    name: pm0.name,
    ...(pm0.formKey ? { formKey: pm0.formKey } : {}),
    flowConfig,
  })
}
