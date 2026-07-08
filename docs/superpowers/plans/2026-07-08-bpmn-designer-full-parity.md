# BPMN 设计器功能补全（复用共享 PropertyPanel）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 BPMN 设计器复用共享 `PropertyPanel`，一次补齐全部节点/流程配置区块（事件/超时/字段权限/审核菜单/票签/办理选项 + 流程操作/启动权限/任务标题/变量 + 网关条件），并使两设计器永久同步。

**Architecture:** BPMN 编辑器的节点面板(UserTask/CC)、流程面板、网关条件面板全部改用共享 `PropertyPanel`（target=node/process/condition），配置经 serde 桥接到共享类型 `WfNodeProps`/`FlowConfig`；网关条件存 sequenceFlow 的 `oa:condition`(结构化 JSON) 并编译 UEL 到 `conditionExpression`。后端不改。

**Tech Stack:** React 19 + TS strict + bpmn-js（moddle 扩展、elementRegistry/modeling）；共享 `shared/property-panel.tsx`。

## Global Constraints
- TS strict：类型导入用 `import type`；删除未用导入（旧 `NodeConfig`/`MULTI_MODES` 等）；无 noUnusedLocals 违规。
- 统一到共享类型：节点 `WfNodeProps`（`../../types`）、流程 `FlowConfig` + `ProcessConfig`（`../../shared/config`）。删除 BPMN 本地 `NodeConfig`/`FlowConfig` 类型与 `oa:showApprovalRecord` 写入。
- 规范扩展格式沿用：`oa:<name>` 逐元素；新增 `oa:condition`(JSON `BranchCondition`) 挂 sequenceFlow。moddle `tagAlias:"lowerCase"` → 类型名 `Condition` 对应标签 `oa:condition`。
- 共享 PropertyPanel props（不改该组件）：
  - process: `{ target:"process", config: ProcessConfig, onChange:(ProcessConfig)=>void, formFields }`
  - node: `{ target:{nodeId,nodeType:"approval"|"cc"|"condition"}, config: WfNodeProps, onChange:(WfNodeProps)=>void, formFields, nodeName?, onNodeNameChange?, branchMeta?, nodeOptions?, flowConfig? }`
- 网关条件 UEL 编译规则同 `JsonToBpmnConverter`：`${field op value}`，多条按 `&&`/`||`（AND/OR）拼；`isDefault` 分支不写 conditionExpression，改设源网关 `default` 指向该 flow。
- 向后兼容：读旧 `oa:NodeConfig` 迁移（已有）；`showApprovalRecord` 读到忽略。
- 后端不改；仿钉钉设计器行为不变（仅被复用）。
- git 分支操作在特性分支；提交 body 结尾必须是 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: 类型统一 + 节点/流程面板复用共享 PropertyPanel

`NodeConfig→WfNodeProps` 类型变更同时波及 moddle/serde/editor/validate，必须同批落地过 tsc；连同节点面板+流程面板复用、defs 传参，合为一个任务。

**Files:**
- Modify: `src/pages/workflow/designer/bpmn/oa/moddle.ts`
- Modify: `src/pages/workflow/designer/bpmn/oa/serde.ts`
- Modify: `src/pages/workflow/designer/bpmn/oa/validate.ts`
- Modify: `src/pages/workflow/designer/bpmn/editor.tsx`
- Modify: `src/pages/workflow/defs.tsx`

**Interfaces:**
- Consumes：共享 `PropertyPanel`（签名见 Global Constraints）；`WfNodeProps`（`../../types`）；`FlowConfig`/`ProcessConfig`/`ProcessBase`/`FormFieldOption`/`defaultFlowConfig`（`../../shared/config`）。
- Produces：`readNodeConfig(bo): WfNodeProps`、`writeNodeConfig(modeling,factory,el,cfg:WfNodeProps)`、`readFlowConfig(bo): FlowConfig`、`writeFlowConfig(...)`；BPMN 编辑器组件新增 props `{ base: ProcessBase; onBaseChange:(b:ProcessBase)=>void; formFields: FormFieldOption[] }`。

- [ ] **Step 1: moddle.ts —— 类型换共享 + 注册 oa:condition + 删 showApprovalRecord**

删除本地 `NodeConfig`/`FlowConfig`/`defaultNodeConfig`/`defaultFlowConfig` 里的 `showApprovalRecord`/`mobileStart`。改为：
```ts
import type { WfNodeProps } from "../../types"
import type { FlowConfig, ProcessBase } from "../../shared/config"
export { defaultFlowConfig } from "../../shared/config"
export function defaultNodeConfig(): WfNodeProps {
  return { assigneeRules: [], multiMode: "ANY", emptyStrategy: "TO_ADMIN", ccUsers: [], allowedOps: ["approve","reject","transfer"], handleOptions: defaultHandleOptions() }
}
```
moddle `types` 数组：保留既有 `bodyType(...)`，新增 `bodyType("Condition")`（→ 标签 `oa:condition`）。删除 `ShowApprovalRecord` 的注册（若有）。导出的 `NodeConfig` 类型别名改为 `export type { WfNodeProps as NodeConfig }` 或全局替换引用为 `WfNodeProps`（推荐后者，避免误导）。

- [ ] **Step 2: serde.ts —— 读写 WfNodeProps/FlowConfig，去 showApprovalRecord**

`readNodeConfig` 返回 `WfNodeProps`：逐元素读 `assigneeRules/multiMode/emptyStrategy/voteConfig/ccUsers/allowedOps/handleOptions/auditMenu/timeout/formPerms/commentRequired/events`（已有），删除对 `showApprovalRecord` 的读写。`writeNodeConfig(cfg: WfNodeProps)`：`put` 列表删掉 `showApprovalRecord`；其余不变（单次 updateProperties 的 `rebuildExtensions/applyExtensions` 保留）。`readFlowConfig/writeFlowConfig` 用共享 `FlowConfig`（`start:{scope,taskTitle}`，无 mobileStart）。旧 `oa:NodeConfig` 迁移分支保留；`migrateLegacyNode` 里 `showApprovalRecord` 字段丢弃（不进 WfNodeProps）。

- [ ] **Step 3: editor.tsx —— 节点面板复用共享 PropertyPanel**

`NodeConfigSection` 手搓 JSX 整体替换为共享面板（保留组件外壳与 modeler 取值）：
```tsx
import { PropertyPanel } from "../shared/property-panel"
// ...在组件内：
const cfg = readNodeConfig(element.businessObject as unknown as { $type: string })
const isCc = element.type === "bpmn:Task"
const others = (elementRegistry.getAll?.() ?? [])
  .filter((e) => e.type === "bpmn:UserTask" && e.id !== element.id)
  .map((e) => ({ id: e.id, name: (e.businessObject?.name as string) || e.id }))
const rootBo = modeler.get("canvas").getRootElement().businessObject
return (
  <PropertyPanel
    target={{ nodeId: element.id, nodeType: isCc ? "cc" : "approval" }}
    config={cfg}
    onChange={(next) => writeNodeConfig(modeling as unknown as SerdeModeling, bpmnFactory as unknown as SerdeFactory, element as unknown as SerdeElement, next)}
    formFields={formFields}
    nodeName={element.businessObject.name as string}
    onNodeNameChange={(name) => modeling.updateProperties(element as unknown as SerdeElement, { name })}
    nodeOptions={others}
    flowConfig={readFlowConfig(rootBo as unknown as { $type: string })}
  />
)
```
（`formFields` 由组件 props 传入——见 Step 5 的 props 新增。）删除旧的 OrgPicker 办理人/多人 Select/allowedOps switch/展示审批记录/备注 等手搓 JSX（这些现由共享面板提供；备注若共享面板无对应区，可保留一个独立小节，但优先删除避免重复）。

- [ ] **Step 4: editor.tsx —— 流程面板复用（替换"暂不可用"）**

把渲染"流程级属性（暂不可用）"的分支（约 442-467 行）替换为：
```tsx
const rootEl = modeler.get("canvas").getRootElement()
const flow = readFlowConfig(rootEl.businessObject as unknown as { $type: string })
return (
  <PropertyPanel
    target="process"
    config={{ base, flow }}
    onChange={(next) => {
      onBaseChange(next.base)
      writeFlowConfig(modeling as unknown as SerdeModeling, bpmnFactory as unknown as SerdeFactory, rootEl as unknown as SerdeElement, next.flow)
    }}
    formFields={formFields}
  />
)
```

- [ ] **Step 5: editor.tsx + defs.tsx —— 新增 base/onBaseChange/formFields props 并接线**

BPMN 编辑器组件 props 接口新增 `base: ProcessBase; onBaseChange: (b: ProcessBase) => void; formFields: FormFieldOption[]`，向下传到 NodeConfigSection/流程面板。`defs.tsx` 渲染 BPMN 编辑器处，按仿钉钉同源传入：`base={{ name: editor.name, description: editor.remark ?? "", icon: editor.icon ?? "", category: editor.category ?? "" }}`（字段名以 defs.tsx 里 editor state 实际字段为准，grep `editor.name`/`ProcessBase` 确认）、`onBaseChange={(b) => setEditor((s) => ({ ...s, name: b.name, remark: b.description, icon: b.icon, category: b.category }))}`、`formFields={editor.formFields}`。grep `bpmnRef`/`BpmnDesigner`/`<Bpmn` 定位渲染点与现有 props。

- [ ] **Step 6: validate.ts —— 按 WfNodeProps**

`readNodeConfig` 现返回 `WfNodeProps`；`审批节点必配处理人`判据 `cfg.assigneeRules.length === 0` 不变（类型更新即可）。确认无对已删字段（showApprovalRecord）的引用。

- [ ] **Step 7: tsc + build**

Run: `cd /Users/west/dev/code/claude-code/ai-template && npx tsc -b && pnpm build`
Expected: 均退出 0；清理未用导入。

- [ ] **Step 8: Commit**（分支 `feat/bpmn-full-parity`）
```bash
git add -A && git commit -m "$(printf 'feat(bpmn-designer): 节点/流程面板复用共享 PropertyPanel，统一到 WfNodeProps/FlowConfig\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 9: 控制器浏览器验证（评审时）**
BPMN 打开 purchase_approval：审批节点面板出现**基础/高级双 tab**，高级 tab 含 办理选项/审核菜单/超时/表单字段权限/节点事件；多人模式选票签→出现票签配置；选画布空白→流程面板可配 操作/启动权限/任务标题/变量（不再"暂不可用"），基础信息改名能回写 def。校验 0 错误。

---

### Task 2: BPMN 排它网关 sequenceFlow 条件结构化编辑

**Files:**
- Modify: `src/pages/workflow/designer/bpmn/oa/serde.ts`（sequenceFlow 的 oa:condition 读写 + UEL 编译）
- Modify: `src/pages/workflow/designer/bpmn/editor.tsx`（选中 sequenceFlow → condition 面板）

**Interfaces:**
- Consumes：Task 1 的 serde 工具 + 共享 `PropertyPanel` target=`{nodeId,nodeType:"condition"}`（config `WfNodeProps`，用其 `condition: BranchCondition`）。
- Produces：`readFlowCondition(flowBo): BranchCondition | undefined`、`writeFlowCondition(modeling,factory,flowEl, cond, gatewayEl)`。

- [ ] **Step 1: serde.ts —— sequenceFlow 条件读写 + UEL 编译**
```ts
import type { BranchCondition, ConditionItem } from "../../types"
const OP_UEL: Record<string,string> = { eq:"==", ne:"!=", gt:">", gte:">=", lt:"<", lte:"<=", contains:"contains", notContains:"notContains" }
function compileUel(cond: BranchCondition): string {
  if (!cond.items?.length) return ""
  const join = cond.logic === "OR" ? " || " : " && "
  const parts = cond.items.map((it: ConditionItem) => {
    const v = isNaN(Number(it.value)) ? `'${it.value}'` : it.value
    if (it.operator === "contains") return `${it.field}.contains(${v})`
    if (it.operator === "notContains") return `!${it.field}.contains(${v})`
    return `${it.field} ${OP_UEL[it.operator]} ${v}`
  })
  return "${" + parts.join(join) + "}"
}
export function readFlowCondition(bo: { $type: string; extensionElements?: unknown; conditionExpression?: { body?: string } } | undefined): BranchCondition | undefined {
  const j = bo ? jsonOf<BranchCondition>(bo as never, "oa:Condition") : undefined
  return j
}
export function writeFlowCondition(modeling: ModelingLike, bpmnFactory: BpmnFactoryLike, flowEl: ElementLike, cond: BranchCondition): void {
  // oa:condition 结构化 + conditionExpression UEL（isDefault 分支两者都不写，交由 Step 2 设网关 default）
  const patches = cond.isDefault ? [] : [{ type: "oa:Condition", body: JSON.stringify(cond) }]
  applyExtensions(modeling, bpmnFactory, flowEl, ["oa:Condition"], patches)
  if (cond.isDefault) { modeling.updateProperties(flowEl, { conditionExpression: undefined }); return }
  const uel = compileUel(cond)
  const expr = uel ? bpmnFactory.create("bpmn:FormalExpression", { body: uel }) : undefined
  modeling.updateProperties(flowEl, { conditionExpression: expr })
}
```
（`jsonOf`/`applyExtensions` 复用 Task 1 已有的；类型签名以 serde.ts 实际为准，必要时放宽 `ModelingLike`/`ElementLike` 以接受 conditionExpression。）

- [ ] **Step 2: editor.tsx —— 选中 sequenceFlow 渲染条件面板 + 设 default**

在面板分发处，新增判断：`element.type === "bpmn:SequenceFlow"` 且其 `businessObject.sourceRef?.$type === "bpmn:ExclusiveGateway"` → 渲染：
```tsx
const gw = element.businessObject.sourceRef
const outs = gw.outgoing ?? []
const isDefault = gw.default?.id === element.id
const cond = readFlowCondition(element.businessObject) ?? { logic: "AND", items: [], isDefault }
return (
  <PropertyPanel
    target={{ nodeId: element.id, nodeType: "condition" }}
    config={{ condition: { ...cond, isDefault } }}
    onChange={(next) => {
      const c = next.condition ?? { logic: "AND", items: [], isDefault }
      writeFlowCondition(modeling, bpmnFactory, element, c)
      if (c.isDefault) modeling.updateProperties(gwElement, { default: element.businessObject }) // 设网关 default 指向本 flow
    }}
    formFields={formFields}
    branchMeta={{ isDefault, priority: outs.findIndex((o) => o.id === element.id) + 1 }}
  />
)
```
（`gwElement` = elementRegistry.get(gw.id)；default 回写用 modeling.updateProperties 设 `default`。非 default 时若原来是 default 需清除，视实现补。）

- [ ] **Step 3: tsc + build**
Run: `npx tsc -b && pnpm build` → 均 0。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "$(printf 'feat(bpmn-designer): 排它网关 sequenceFlow 条件结构化编辑（oa:condition + UEL）\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 5: 控制器浏览器验证**
BPMN 打开 purchase_approval，选中"预算判断"网关出去的某条 sequenceFlow → 出现条件编辑器（字段下拉来自 formFields、操作符、值）；配 `budget > 50000` 保存 → GET bpmnXml 确认该 flow 有 `<oa:condition>` + `conditionExpression` UEL `${budget > 50000}`；默认分支设为网关 default。

---

### Task 3: 验证 + 回归

**Files:** 可选 `server/smoke-test.mjs`（如需补 BPMN 条件/事件端到端断言）。

- [ ] **Step 1: 浏览器全量（BPMN 主）**
控制器逐屏：节点高级 tab 全区块可配 + 票签；流程面板全可配；网关条件可编辑；**BPMN 设计器配一个节点事件 NOTIFY + 超时 → 保存并发布 → 发起 → 验证通知落库/超时登记**（对齐已验证的仿钉钉事件路径）；校验 0 错误。

- [ ] **Step 2: 仿钉钉不回归**
控制器打开 leave_approval（仿钉钉）：节点/流程/条件面板与改前一致（共享面板行为未变）；发起走一遍正常。

- [ ] **Step 3: smoke + 终验**
Run: `cd server && node smoke-test.mjs 2>&1 | tail -5`（保持全绿）；`cd .. && npx tsc -b && pnpm build`（0）。

- [ ] **Step 4: Commit（如有 smoke 改动）**

---

## Self-Review
**Spec 覆盖**：类型统一(T1 S1/S2)、节点面板(T1 S3)、流程面板+base(T1 S4/S5)、defs 接线(T1 S5)、formFields(T1 S5)、validate(T1 S6)、网关条件(T2)、验证/回归(T3) —— 均有任务。
**Placeholder**：关键代码（默认 config、面板复用、UEL 编译、条件面板分发）给出具体代码；defs 字段名/网关 default 清除给了 grep/实现指引而非留空。
**类型一致**：`WfNodeProps`/`FlowConfig`/`ProcessConfig`/`BranchCondition` 全程同引共享；moddle 类型名 `Condition`↔标签 `oa:condition`；serde/editor/defs 的 props 名一致。
