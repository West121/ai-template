/**
 * BPMN 设计器核心（从 demo/bpmn 抽出的可复用组件）：
 * bpmn-js Modeler + 中文化 + 工具栏 + 自定义属性面板（处理人 OrgPicker）。
 * demo 页与 /workflow/defs 的流程定义设计器（BPMN 模式）共用。
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react"
import Modeler from "bpmn-js/lib/Modeler"
import GridModule from "diagram-js-grid"
import "bpmn-js/dist/assets/diagram-js.css"
import "bpmn-js/dist/assets/bpmn-js.css"
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css"
import {
  Bot,
  Circle,
  Diamond,
  Download,
  Expand,
  FilePlus2,
  FileUp,
  Image,
  Maximize,
  MousePointerClick,
  Redo2,
  ShieldCheck,
  Shrink,
  Spline,
  Square,
  Timer,
  Undo2,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { oaBusinessModule } from "./oa/providers"
import { oaModdleDescriptor } from "./oa/moddle"
import {
  readFlowConfig,
  readNodeConfig,
  writeFlowConfig,
  writeNodeConfig,
} from "./oa/serde"
import { validateBpmn, type ValidationIssue } from "./oa/validate"
import { PropertyPanel } from "../shared/property-panel"
import type { FormFieldOption, ProcessBase, ProcessConfig } from "../shared/config"
import type { WfNodeProps } from "../types"

/** 空白流程（仅一个开始事件） */
export const BLANK_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_Blank" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Blank" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="开始" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_Blank">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="200" y="200" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="207" y="243" width="22" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

/** 新建流程定义（BPMN 模式）默认图：开始 → 审批 → 结束 */
export const DEFAULT_PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_Proc" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="开始">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Approve" name="审批">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_1" name="结束">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Approve" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="180" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="187" y="223" width="22" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approve_di" bpmnElement="Task_Approve">
        <dc:Bounds x="280" y="158" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="452" y="180" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="459" y="223" width="22" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="216" y="198" />
        <di:waypoint x="280" y="198" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="380" y="198" />
        <di:waypoint x="452" y="198" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

/* ---------- bpmn-js 服务的精简类型（官方类型较宽松，这里按用到的部分收敛） ---------- */

interface BpmnBusinessObject {
  id: string
  name?: string
  $type: string
  documentation?: Array<{ text?: string }>
  conditionExpression?: { body?: string }
}

export interface BpmnElement {
  id: string
  type: string
  businessObject: BpmnBusinessObject
}

interface ModelingService {
  updateProperties(element: BpmnElement, props: Record<string, unknown>): void
}
interface CanvasService {
  zoom(scale?: number | "fit-viewport"): number
  getRootElement(): BpmnElement
}
interface CommandStackService {
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
}
interface BpmnFactoryService {
  create(type: string, props: Record<string, unknown>): unknown
}
interface ElementRegistryService {
  getAll(): BpmnElement[]
}

type ModelerInstance = InstanceType<typeof Modeler> & {
  get(name: "modeling"): ModelingService
  get(name: "canvas"): CanvasService
  get(name: "commandStack"): CommandStackService
  get(name: "bpmnFactory"): BpmnFactoryService
  get(name: "elementRegistry"): ElementRegistryService
  on(event: string, callback: (event: never) => void): void
}

/** serde / validate 期望的服务形状（与本文件精简类型对齐，调用处做窄化转换） */
type SerdeModeling = Parameters<typeof writeNodeConfig>[0]
type SerdeFactory = Parameters<typeof writeNodeConfig>[1]
type SerdeElement = Parameters<typeof writeNodeConfig>[2]

/* ---------- 中文化 ---------- */

const zhTranslations: Record<string, string> = {
  "Activate hand tool": "手抓工具",
  "Activate lasso tool": "框选工具",
  "Activate create/remove space tool": "空间调整工具",
  "Activate global connect tool": "全局连接工具",
  "Create start event": "创建开始事件",
  "Create end event": "创建结束事件",
  "Create intermediate/boundary event": "创建中间/边界事件",
  "Create gateway": "创建网关",
  "Create task": "创建任务",
  "Create user task": "创建用户任务",
  "Create data object reference": "创建数据对象",
  "Create data store reference": "创建数据存储",
  "Create expanded sub-process": "创建子流程",
  "Create pool/participant": "创建泳池",
  "Create group": "创建分组",
  "Append task": "追加任务",
  "Append end event": "追加结束事件",
  "Append gateway": "追加网关",
  "Append intermediate/boundary event": "追加中间事件",
  "Append text annotation": "添加文本注释",
  "Add text annotation": "添加文本注释",
  "Connect to other element": "连接到其他元素",
  "Connect using association": "关联连接",
  "Connect using sequence/message flow or association": "连接（顺序流/消息流/关联）",
  Delete: "删除",
  Remove: "移除",
  "Change element": "更改类型",
  "Change type": "更改类型",
  "Append element": "追加元素",
  "Append task element": "追加任务",
  "Open element": "打开元素",
}

function customTranslate(template: string, replacements?: Record<string, string>) {
  let text = zhTranslations[template] ?? template
  if (replacements) {
    text = text.replace(/\{([^}]+)\}/g, (_, key: string) => replacements[key] ?? `{${key}}`)
  }
  return text
}

const customTranslateModule = { translate: ["value", customTranslate] as const }

/* ---------- 元素类型展示 ---------- */

const elementTypeMeta: Record<string, { label: string; icon: typeof Circle; color: string }> = {
  "bpmn:StartEvent": { label: "开始", icon: Circle, color: "bg-emerald-500/10 text-emerald-600" },
  "bpmn:EndEvent": { label: "结束", icon: Circle, color: "bg-rose-500/10 text-rose-600" },
  "bpmn:IntermediateCatchEvent": { label: "定时", icon: Timer, color: "bg-amber-500/10 text-amber-600" },
  "bpmn:IntermediateThrowEvent": { label: "中间事件", icon: Circle, color: "bg-amber-500/10 text-amber-600" },
  "bpmn:UserTask": { label: "审批", icon: ShieldCheck, color: "bg-blue-500/10 text-blue-600" },
  "bpmn:Task": { label: "抄送", icon: Users, color: "bg-sky-500/10 text-sky-600" },
  "bpmn:ServiceTask": { label: "AI 节点", icon: Bot, color: "bg-violet-500/10 text-violet-600" },
  "bpmn:ExclusiveGateway": { label: "排它网关", icon: Diamond, color: "bg-orange-500/10 text-orange-600" },
  "bpmn:ParallelGateway": { label: "并行网关", icon: Diamond, color: "bg-orange-500/10 text-orange-600" },
  "bpmn:SequenceFlow": { label: "顺序流", icon: Spline, color: "bg-slate-500/10 text-slate-600" },
  "bpmn:CallActivity": { label: "子流程", icon: Square, color: "bg-cyan-500/10 text-cyan-600" },
  "bpmn:SubProcess": { label: "子流程", icon: Square, color: "bg-cyan-500/10 text-cyan-600" },
  "bpmn:Process": { label: "流程", icon: Square, color: "bg-muted text-muted-foreground" },
}

function typeMetaOf(type: string) {
  return (
    elementTypeMeta[type] ?? {
      label: type.replace("bpmn:", ""),
      icon: Square,
      color: "bg-muted text-muted-foreground",
    }
  )
}

const isTaskLike = (type: string) => type === "bpmn:UserTask" || type === "bpmn:Task" || type === "bpmn:ServiceTask"

/* ---------- 节点业务配置：复用共享 PropertyPanel（../shared/property-panel），不再手搓 ---------- */

/**
 * UserTask/Task/ServiceTask 的业务属性区：复用仿钉钉设计器同款共享面板（基础信息 + 按 nodeType 分区
 * 的高级属性：办理选项/审核菜单/超时/表单字段权限/节点事件），不再手搓 OrgPicker/Select/Switch。
 * 配置读写 businessObject 的 `<bpmn:extensionElements>`（oa:<name> 逐元素），saveXML() 即含这些数据。
 */
function NodeConfigPanel({
  modeler,
  modeling,
  bpmnFactory,
  element,
  formFields,
}: {
  modeler: ModelerInstance
  modeling: ModelingService
  bpmnFactory: BpmnFactoryService
  element: BpmnElement
  formFields: FormFieldOption[]
}) {
  const cfg = readNodeConfig(element.businessObject as unknown as { $type: string })
  const isCc = element.type === "bpmn:Task"

  // 本流程其它 UserTask（供「指定节点办理人」来源选择），排除当前节点自身
  const others = modeler
    .get("elementRegistry")
    .getAll()
    .filter((e) => e.type === "bpmn:UserTask" && e.id !== element.id)
    .map((e) => ({ id: e.id, name: e.businessObject.name || e.id }))

  const rootBo = modeler.get("canvas").getRootElement().businessObject

  return (
    <PropertyPanel
      target={{ nodeId: element.id, nodeType: isCc ? "cc" : "approval" }}
      config={cfg}
      onChange={(next: WfNodeProps) =>
        writeNodeConfig(
          modeling as unknown as SerdeModeling,
          bpmnFactory as unknown as SerdeFactory,
          element as unknown as SerdeElement,
          next,
        )
      }
      formFields={formFields}
      nodeName={element.businessObject.name}
      onNodeNameChange={(name) => modeling.updateProperties(element, { name })}
      nodeOptions={others}
      flowConfig={readFlowConfig(rootBo as unknown as { $type: string })}
    />
  )
}

/** 流程级配置区：未选中节点 / 选中流程根时展示，复用共享 PropertyPanel（target="process"） */
function FlowConfigSection({
  modeler,
  base,
  onBaseChange,
  formFields,
}: {
  modeler: ModelerInstance
  base: ProcessBase
  onBaseChange: (b: ProcessBase) => void
  formFields: FormFieldOption[]
}) {
  const [root, setRoot] = useState<BpmnElement | null>(null)
  // 在提交后读取根元素：getRootElement() 首次访问会 fire 事件，放渲染期会触发
  // “setState during render” 告警，故移入 effect。
  useEffect(() => {
    try {
      setRoot(modeler.get("canvas").getRootElement())
    } catch {
      setRoot(null)
    }
  }, [modeler])

  // 画布尚未导入 / 根不是 Process（如协作图）时给出空态，避免在渲染期崩溃
  if (!root || root.businessObject?.$type !== "bpmn:Process") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <MousePointerClick className="size-5" />
        </div>
        <div className="text-sm">点击画布中的节点</div>
        <div className="text-xs text-muted-foreground/70">选中节点或连线可编辑其属性</div>
      </div>
    )
  }

  const modeling = modeler.get("modeling")
  const bpmnFactory = modeler.get("bpmnFactory")
  const flow = readFlowConfig(root.businessObject as unknown as { $type: string })

  return (
    <PropertyPanel
      target="process"
      config={{ base, flow }}
      onChange={(next: ProcessConfig) => {
        onBaseChange(next.base)
        writeFlowConfig(
          modeling as unknown as SerdeModeling,
          bpmnFactory as unknown as SerdeFactory,
          root as unknown as SerdeElement,
          next.flow,
        )
      }}
      formFields={formFields}
    />
  )
}


/* ---------- 属性面板 ---------- */

function PropertiesPanel({
  modeler,
  element,
  version,
  base,
  onBaseChange,
  formFields,
}: {
  modeler: ModelerInstance | null
  element: BpmnElement | null
  version: number
  base: ProcessBase
  onBaseChange: (b: ProcessBase) => void
  formFields: FormFieldOption[]
}) {
  const [docText, setDocText] = useState("")
  const [condition, setCondition] = useState("")

  // 选中元素或元素变化时同步表单值
  useEffect(() => {
    if (!element) return
    setDocText(element.businessObject.documentation?.[0]?.text ?? "")
    setCondition(element.businessObject.conditionExpression?.body ?? "")
    // version 变化说明画布内属性被修改，需要重新读取
  }, [element, version])

  if (!modeler) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <MousePointerClick className="size-5" />
        </div>
        <div className="text-sm">加载中…</div>
      </div>
    )
  }

  // 未选中节点 / 选中流程根 → 展示流程级属性（复用共享 PropertyPanel）
  if (!element || element.type === "bpmn:Process") {
    return (
      <FlowConfigSection key={version} modeler={modeler} base={base} onBaseChange={onBaseChange} formFields={formFields} />
    )
  }

  const modeling = modeler.get("modeling")
  const bpmnFactory = modeler.get("bpmnFactory")

  // 任务节点（审批/抄送/AI）：整体交给共享 PropertyPanel（基础信息 + 高级属性一体），不再叠加手搓的
  // 基础信息/备注小节，避免与共享面板内已有的节点名称等区块重复。
  if (isTaskLike(element.type)) {
    return (
      <NodeConfigPanel
        key={`${element.id}-${version}`}
        modeler={modeler}
        modeling={modeling}
        bpmnFactory={bpmnFactory}
        element={element}
        formFields={formFields}
      />
    )
  }

  const meta = typeMetaOf(element.type)

  const saveDoc = () => {
    modeling.updateProperties(element, {
      documentation: docText ? [bpmnFactory.create("bpmn:Documentation", { text: docText })] : [],
    })
  }

  const saveCondition = () => {
    modeling.updateProperties(element, {
      conditionExpression: condition
        ? bpmnFactory.create("bpmn:FormalExpression", { body: condition })
        : undefined,
    })
    toast.success("条件表达式已保存")
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4">
        {/* 元素信息头 */}
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", meta.color)}>
            <meta.icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{meta.label}</span>
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground">{element.id}</div>
          </div>
        </div>

        <Separator />

        {/* 基础信息 */}
        <section className="space-y-3">
          <Label className="text-xs text-muted-foreground">基础信息</Label>
          <div className="space-y-1.5">
            <Label htmlFor="bpmn-name" className="text-xs">
              名称
            </Label>
            <Input
              id="bpmn-name"
              value={element.businessObject.name ?? ""}
              onChange={(e) => modeling.updateProperties(element, { name: e.target.value })}
              placeholder="请输入名称"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">元素 ID</Label>
            <Input value={element.id} readOnly className="h-8 bg-muted/50 font-mono text-xs" />
          </div>
        </section>

        {/* 顺序流条件 */}
        {element.type === "bpmn:SequenceFlow" && (
          <>
            <Separator />
            <section className="space-y-3">
              <Label className="text-xs text-muted-foreground">条件表达式</Label>
              <Textarea
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="如：${days >= 3}"
                rows={3}
                className="font-mono text-xs"
              />
              <Button size="sm" className="h-7 w-full text-xs" onClick={saveCondition}>
                保存条件
              </Button>
            </section>
          </>
        )}

        {/* 备注 */}
        <Separator />
        <section className="space-y-3">
          <Label className="text-xs text-muted-foreground">备注说明</Label>
          <Textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            onBlur={saveDoc}
            placeholder="节点的补充说明，失焦自动保存"
            rows={3}
            className="text-sm"
          />
        </section>
      </div>
    </ScrollArea>
  )
}

/* ---------- 工具栏按钮 ---------- */

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Undo2
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClick} disabled={disabled}>
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ---------- 设计器组件 ---------- */

export interface BpmnDesignerHandle {
  /** 取当前画布的 BPMN XML（格式化，含 oa:nodeConfig / oa:flowConfig） */
  getXml: () => Promise<string | undefined>
  /** 覆盖导入 XML */
  importXml: (xml: string, successMessage?: string) => void
  /** 发布前校验：返回问题清单（含 error 应阻止发布），并高亮画布错误元素 */
  validate: () => ValidationIssue[]
}

export interface BpmnDesignerProps {
  /** 初始 XML；后续变更不触发重载（用 handle.importXml） */
  initialXml?: string
  /** 画布区高度 class，默认与 demo 一致 */
  heightClass?: string
  /** 隐藏「导入/导出/SVG」等文件类工具（嵌入流程定义弹窗时用） */
  hideFileTools?: boolean
  ref?: Ref<BpmnDesignerHandle>
  className?: string
  /**
   * 流程级基础信息（映射 ProcessDef name/remark/icon/category），供流程属性面板「基础信息」编辑。
   * 嵌入 /workflow/defs 时应受控传入（与 ProcessDef 同步）；独立 demo 场景可不传，组件内部兜底维护。
   */
  base?: ProcessBase
  onBaseChange?: (base: ProcessBase) => void
  /** 绑定表单的字段，供节点/流程面板条件、表单字段权限、办理人来源等选择；未绑定表单时为空 */
  formFields?: FormFieldOption[]
}

const EMPTY_PROCESS_BASE: ProcessBase = { name: "", description: "", icon: "", category: "" }

export function BpmnDesigner({
  initialXml = BLANK_BPMN_XML,
  heightClass = "h-[calc(100vh-320px)] min-h-[520px]",
  hideFileTools = false,
  ref,
  className,
  base,
  onBaseChange,
  formFields = [],
}: BpmnDesignerProps) {
  // 未受控传入 base/onBaseChange（如独立 demo 页）时内部兜底维护，避免影响未接线的旧调用方
  const [internalBase, setInternalBase] = useState<ProcessBase>(EMPTY_PROCESS_BASE)
  const effectiveBase = base ?? internalBase
  const effectiveOnBaseChange = onBaseChange ?? setInternalBase

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const xmlRef = useRef<string | null>(null)
  const [modeler, setModeler] = useState<ModelerInstance | null>(null)
  const [selected, setSelected] = useState<BpmnElement | null>(null)
  const [version, setVersion] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const dark = isDarkMode(useAppStore((s) => s.themeMode))

  // 全屏切换后画布尺寸变化，等布局稳定再重新适配视口
  useEffect(() => {
    if (!modeler) return
    const frame = requestAnimationFrame(() => modeler.get("canvas").zoom("fit-viewport"))
    return () => cancelAnimationFrame(frame)
  }, [fullscreen, modeler])

  // 全屏时 Escape 退出（正在画布内直接编辑标签时让位给编辑器自身的取消行为）
  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // 画布内直接编辑标签、或弹窗（如处理人选择）打开时，Escape 让位给它们自身的取消/关闭行为
      if (document.querySelector(".djs-direct-editing-parent")) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      setFullscreen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [fullscreen])

  // 主题切换时销毁重建 modeler（渲染色只能在初始化时指定），xmlRef 保留当前图
  useEffect(() => {
    if (!canvasRef.current) return
    const instance = new Modeler({
      container: canvasRef.current,
      additionalModules: [customTranslateModule, GridModule, oaBusinessModule],
      moddleExtensions: { oa: oaModdleDescriptor },
      bpmnRenderer: dark
        ? { defaultFillColor: "#232a3b", defaultStrokeColor: "#c3cbdc", defaultLabelColor: "#c3cbdc" }
        : { defaultFillColor: "#ffffff", defaultStrokeColor: "#22242a", defaultLabelColor: "#22242a" },
    }) as ModelerInstance

    instance.on("selection.changed", (event) => {
      const e = event as unknown as { newSelection: BpmnElement[] }
      setSelected(e.newSelection[0] ?? null)
    })
    instance.on("element.changed", () => setVersion((v) => v + 1))

    // React StrictMode 会挂载两次：实例销毁后不能再触碰 canvas
    let disposed = false
    instance.on("commandStack.changed", () => {
      const stack = instance.get("commandStack")
      setCanUndo(stack.canUndo())
      setCanRedo(stack.canRedo())
      // 持续把最新 XML 存入 ref，主题切换重建时无缝恢复
      void instance
        .saveXML()
        .then(({ xml }) => {
          if (!disposed && xml) xmlRef.current = xml
        })
        .catch(() => {})
    })

    void instance
      .importXML(xmlRef.current ?? initialXml)
      .then(() => {
        if (!disposed) instance.get("canvas").zoom("fit-viewport")
      })
      .catch(() => {})
    setModeler(instance)

    return () => {
      disposed = true
      instance.destroy()
      setModeler(null)
      setSelected(null)
    }
    // initialXml 仅首次生效（xmlRef 缓存后续状态）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])

  const importXml = useCallback(
    (xml: string, successMessage?: string) => {
      if (!modeler) return
      void modeler
        .importXML(xml)
        .then(() => {
          xmlRef.current = xml
          modeler.get("canvas").zoom("fit-viewport")
          setSelected(null)
          if (successMessage) toast.success(successMessage)
        })
        .catch(() => toast.error("XML 解析失败，请检查文件内容"))
    },
    [modeler],
  )

  useImperativeHandle(
    ref,
    () => ({
      getXml: async () => {
        if (!modeler) return xmlRef.current ?? undefined
        const { xml } = await modeler.saveXML({ format: true })
        return xml ?? undefined
      },
      importXml,
      validate: () => {
        if (!modeler) return []
        return validateBpmn(modeler as unknown as Parameters<typeof validateBpmn>[0])
      },
    }),
    [modeler, importXml],
  )

  const download = (content: string, fileName: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportXml = async () => {
    if (!modeler) return
    const { xml } = await modeler.saveXML({ format: true })
    if (xml) {
      download(xml, "process.bpmn20.xml", "application/xml")
      toast.success("已导出 BPMN XML")
    }
  }

  const exportSvg = async () => {
    if (!modeler) return
    const { svg } = await modeler.saveSVG()
    if (svg) {
      download(svg, "diagram.svg", "image/svg+xml")
      toast.success("已导出 SVG")
    }
  }

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => importXml(String(reader.result), `已导入「${file.name}」`)
    reader.readAsText(file)
  }

  const zoom = (delta: number) => {
    if (!modeler) return
    const canvas = modeler.get("canvas")
    canvas.zoom(Math.min(4, Math.max(0.2, canvas.zoom() + delta)))
  }

  const runValidate = () => {
    if (!modeler) return
    const issues = validateBpmn(modeler as unknown as Parameters<typeof validateBpmn>[0])
    const errors = issues.filter((i) => i.level === "error")
    const warns = issues.filter((i) => i.level === "warn")
    if (errors.length === 0 && warns.length === 0) {
      toast.success("校验通过，可以发布")
      return
    }
    if (errors.length > 0) {
      toast.error(`发现 ${errors.length} 个错误${warns.length ? ` · ${warns.length} 个警告` : ""}`, {
        description: errors
          .slice(0, 4)
          .map((e) => e.message)
          .join("；"),
      })
    } else {
      toast.warning(`${warns.length} 个警告`, {
        description: warns.slice(0, 4).map((w) => w.message).join("；"),
      })
    }
  }

  return (
    <Card className={cn("gap-0 overflow-hidden p-0", fullscreen && "fixed inset-0 z-50 rounded-none", className)}>
      {/* 工具栏 */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <ToolButton icon={FilePlus2} label="新建流程" onClick={() => importXml(BLANK_BPMN_XML, "已新建空白流程")} />
        {!hideFileTools && (
          <>
            <ToolButton icon={FileUp} label="导入 XML" onClick={() => fileRef.current?.click()} />
            <input
              ref={fileRef}
              type="file"
              accept=".xml,.bpmn"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ""
              }}
            />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToolButton icon={Download} label="导出 XML" onClick={() => void exportXml()} />
            <ToolButton icon={Image} label="导出 SVG" onClick={() => void exportSvg()} />
          </>
        )}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={runValidate}>
          <ShieldCheck className="size-4" />
          校验
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton icon={Undo2} label="撤销" onClick={() => modeler?.get("commandStack").undo()} disabled={!canUndo} />
          <ToolButton icon={Redo2} label="重做" onClick={() => modeler?.get("commandStack").redo()} disabled={!canRedo} />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton icon={ZoomOut} label="缩小" onClick={() => zoom(-0.1)} />
          <ToolButton icon={ZoomIn} label="放大" onClick={() => zoom(0.1)} />
          <ToolButton icon={Maximize} label="适应画布" onClick={() => modeler?.get("canvas").zoom("fit-viewport")} />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton
            icon={fullscreen ? Shrink : Expand}
            label={fullscreen ? "退出全屏" : "全屏"}
            onClick={() => setFullscreen((v) => !v)}
          />
        </div>
      </div>

      {/* 画布 + 属性面板 */}
      <div className={cn("flex", fullscreen ? "h-[calc(100dvh-48px)]" : heightClass)}>
        <div key={dark ? "dark" : "light"} ref={canvasRef} className="relative min-w-0 flex-1 bg-white dark:bg-background" />
        <aside className="w-80 shrink-0 border-l bg-card">
          <PropertiesPanel
            modeler={modeler}
            element={selected}
            version={version}
            base={effectiveBase}
            onBaseChange={effectiveOnBaseChange}
            formFields={formFields}
          />
        </aside>
      </div>
    </Card>
  )
}
