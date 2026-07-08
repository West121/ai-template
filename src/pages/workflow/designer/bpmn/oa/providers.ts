/**
 * OA 业务节点 provider 套件：把 bpmn-js 的 palette / contextPad / 更改类型(popupMenu)
 * 三处替换为「业务节点」。
 *
 * - OaPaletteProvider   覆盖 DI 名 `paletteProvider`：左侧面板只列业务节点 + 基础工具。
 * - OaReplaceMenuProvider 覆盖 DI 名 `replaceMenuProvider`：「更改类型」弹窗只给业务候选、全中文，
 *                        原生 Task/Service task/Send/Receive… 不再出现（图14 痛点）。
 * - OaContextPadProvider 追加的低优先级 contextPad provider：剪掉原生 append.* 并换成业务追加。
 */
import { is } from "bpmn-js/lib/util/ModelUtil"
import {
  BUSINESS_NODES,
  createAttrsOf,
  isCurrentBusinessType,
  replaceTargetOf,
  type BusinessNode,
} from "./business-nodes"

/* ---------- 精简服务类型 ---------- */

interface PaletteService {
  registerProvider(provider: unknown): void
}
interface CreateService {
  start(event: unknown, shape: unknown, context?: unknown): void
}
interface ElementFactoryService {
  createShape(attrs: Record<string, unknown>): unknown
}
interface SelectionTool {
  activateSelection(event: unknown): void
}
interface HandToolService {
  activateHand(event: unknown): void
}
interface GlobalConnectService {
  start(event: unknown): void
}
interface PopupMenuService {
  registerProvider(id: string, provider: unknown): void
}
interface BpmnReplaceService {
  replaceElement(element: unknown, target: Record<string, unknown>): unknown
}
interface RulesService {
  allowed(action: string, context: Record<string, unknown>): boolean
}
interface ContextPadService {
  registerProvider(priority: number, provider: unknown): void
}
interface AutoPlaceService {
  append(source: unknown, shape: unknown): void
}

interface ElementLike {
  id: string
  type: string
  businessObject: {
    $type: string
    eventDefinitions?: Array<{ $type: string }>
  }
}

type PaletteEntries = Record<string, unknown>
type PopupEntries = Record<string, unknown>
type ContextPadEntries = Record<string, unknown>

/* ========================= Palette ========================= */

export class OaPaletteProvider {
  static $inject = [
    "palette",
    "create",
    "elementFactory",
    "spaceTool",
    "lassoTool",
    "handTool",
    "globalConnect",
  ]

  private _create: CreateService
  private _elementFactory: ElementFactoryService
  private _spaceTool: SelectionTool
  private _lassoTool: SelectionTool
  private _handTool: HandToolService
  private _globalConnect: GlobalConnectService

  constructor(
    palette: PaletteService,
    create: CreateService,
    elementFactory: ElementFactoryService,
    spaceTool: SelectionTool,
    lassoTool: SelectionTool,
    handTool: HandToolService,
    globalConnect: GlobalConnectService,
  ) {
    this._create = create
    this._elementFactory = elementFactory
    this._spaceTool = spaceTool
    this._lassoTool = lassoTool
    this._handTool = handTool
    this._globalConnect = globalConnect
    palette.registerProvider(this)
  }

  getPaletteEntries(): PaletteEntries {
    const create = this._create
    const elementFactory = this._elementFactory
    const entries: PaletteEntries = {
      "hand-tool": {
        group: "tools",
        className: "bpmn-icon-hand-tool",
        title: "手抓工具",
        action: { click: (e: unknown) => this._handTool.activateHand(e) },
      },
      "lasso-tool": {
        group: "tools",
        className: "bpmn-icon-lasso-tool",
        title: "框选工具",
        action: { click: (e: unknown) => this._lassoTool.activateSelection(e) },
      },
      "space-tool": {
        group: "tools",
        className: "bpmn-icon-space-tool",
        title: "空间调整工具",
        action: { click: (e: unknown) => this._spaceTool.activateSelection(e) },
      },
      "global-connect-tool": {
        group: "tools",
        className: "bpmn-icon-connection-multi",
        title: "全局连接工具",
        action: { click: (e: unknown) => this._globalConnect.start(e) },
      },
      "tool-separator": { group: "tools", separator: true },
    }

    for (const node of BUSINESS_NODES) {
      const start = (event: unknown) => {
        const shape = elementFactory.createShape(createAttrsOf(node))
        create.start(event, shape)
      }
      entries[`create.${node.id}`] = {
        group: node.group,
        className: node.className,
        title: `创建${node.label}`,
        action: { dragstart: start, click: start },
      }
    }
    return entries
  }
}

/* ========================= 更改类型（popupMenu / bpmn-replace） ========================= */

export class OaReplaceMenuProvider {
  static $inject = ["popupMenu", "modeling", "bpmnReplace", "rules"]

  private _bpmnReplace: BpmnReplaceService
  private _rules: RulesService

  constructor(
    popupMenu: PopupMenuService,
    _modeling: unknown,
    bpmnReplace: BpmnReplaceService,
    rules: RulesService,
  ) {
    this._bpmnReplace = bpmnReplace
    this._rules = rules
    popupMenu.registerProvider("bpmn-replace", this)
  }

  /** 更改类型无表头（去掉原生多实例/循环等表头项） */
  getPopupMenuHeaderEntries(): PopupEntries {
    return {}
  }

  getPopupMenuEntries(target: ElementLike): PopupEntries {
    if (Array.isArray(target)) return {}
    if (!this._rules.allowed("shape.replace", { element: target })) return {}

    const bo = target.businessObject
    // 目标所属业务分组：只在同组内提供候选（任务↔任务、网关↔网关）
    const group = groupOfBusinessObject(bo)
    if (!group) return {}

    const candidates = BUSINESS_NODES.filter(
      (n) => n.group === group && !isCurrentBusinessType(n, bo),
    )
    return this._createEntries(target, candidates)
  }

  private _createEntries(target: ElementLike, nodes: BusinessNode[]): PopupEntries {
    const entries: PopupEntries = {}
    const replace = this._bpmnReplace
    for (const node of nodes) {
      entries[`replace-with-oa-${node.id}`] = {
        label: node.label,
        className: node.className,
        action: () => replace.replaceElement(target, replaceTargetOf(node)),
      }
    }
    return entries
  }
}

/** 元素当前落在哪个业务分组（用于「更改类型」限定候选集） */
function groupOfBusinessObject(bo: { $type: string }): "task" | "gateway" | null {
  if (is(bo, "bpmn:Gateway")) return "gateway"
  if (
    is(bo, "bpmn:UserTask") ||
    is(bo, "bpmn:ServiceTask") ||
    is(bo, "bpmn:Task") ||
    is(bo, "bpmn:CallActivity") ||
    is(bo, "bpmn:SubProcess")
  ) {
    return "task"
  }
  return null
}

/* ========================= ContextPad（追加业务节点） ========================= */

/** 只在追加菜单里放这些业务节点，避免出现原生 Send/Receive/Manual 等 */
const APPEND_NODE_IDS = ["approval", "cc", "exclusive", "parallel", "timer", "end"]

export class OaContextPadProvider {
  static $inject = ["contextPad", "create", "elementFactory", "autoPlace"]

  private _create: CreateService
  private _elementFactory: ElementFactoryService
  private _autoPlace: AutoPlaceService

  constructor(
    contextPad: ContextPadService,
    create: CreateService,
    elementFactory: ElementFactoryService,
    autoPlace: AutoPlaceService,
  ) {
    this._create = create
    this._elementFactory = elementFactory
    this._autoPlace = autoPlace
    // 低于默认优先级(1000)，保证本 updater 在原生 provider 之后执行，能剪裁其结果
    contextPad.registerProvider(500, this)
  }

  getContextPadEntries(element: ElementLike) {
    return (entries: ContextPadEntries): ContextPadEntries => {
      // 剪掉全部原生 append.*（它们会创建原生 Task/Send/Receive… 等）
      const kept: ContextPadEntries = {}
      for (const key of Object.keys(entries)) {
        if (!key.startsWith("append.")) kept[key] = entries[key]
      }
      // 结束节点 / 连线 / 非流程节点不追加后继
      if (is(element, "bpmn:FlowNode") && !is(element, "bpmn:EndEvent")) {
        for (const id of APPEND_NODE_IDS) {
          const node = BUSINESS_NODES.find((n) => n.id === id)
          if (node) kept[`append.oa-${node.id}`] = this._appendEntry(node)
        }
      }
      return kept
    }
  }

  private _appendEntry(node: BusinessNode) {
    const elementFactory = this._elementFactory
    const autoPlace = this._autoPlace
    const create = this._create
    return {
      group: "model",
      className: node.className,
      title: `追加${node.label}`,
      action: {
        click: (_event: unknown, element: unknown) => {
          const shape = elementFactory.createShape(createAttrsOf(node))
          autoPlace.append(element, shape)
        },
        dragstart: (event: unknown, element: unknown) => {
          const shape = elementFactory.createShape(createAttrsOf(node))
          create.start(event, shape, { source: element })
        },
      },
    }
  }
}

/* ========================= 模块 ========================= */

/** 传入 Modeler.additionalModules；覆盖 palette/replaceMenu，追加 contextPad provider */
export const oaBusinessModule = {
  __init__: ["oaContextPadProvider"],
  paletteProvider: ["type", OaPaletteProvider],
  replaceMenuProvider: ["type", OaReplaceMenuProvider],
  oaContextPadProvider: ["type", OaContextPadProvider],
}
