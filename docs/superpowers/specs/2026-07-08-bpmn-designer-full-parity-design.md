# BPMN 设计器功能补全：复用共享 PropertyPanel

日期：2026-07-08
状态：设计已确认（复用共享面板），待细化实施

## 背景与定位

用户定调：**BPMN 设计器是主力设计器**（往后测试以 BPMN 为主、仿钉钉次之）。当前 BPMN 编辑器功能残缺——只有办理人/多人/空值/按钮/备注，缺：**节点事件、超时、表单字段权限、审核菜单、票签配置、办理选项、审批意见必填**，以及**整个流程级配置**（现为"流程级属性暂不可用"）。

关键发现：共享 `PropertyPanel`（`shared/property-panel.tsx`）**已实现全部区块**，且按 `target: "process" | {nodeId,nodeType}` 参数化，仿钉钉设计器直接复用。BPMN 编辑器却自己手搓了残缺面板（`NodeConfigSection`）。

**方案（已确认）**：让 BPMN 编辑器**复用共享 PropertyPanel**，一次补齐全部功能，且两设计器以后永久同步（改一处两边都在）。

## 目标

- BPMN 节点面板（UserTask/CC）改用共享 `PropertyPanel`（target=node），获得全部节点区块。
- BPMN 流程面板（选中画布空白/流程）改用共享 `PropertyPanel`（target=process），替换"暂不可用"。
- BPMN 存储统一到共享类型：节点 `WfNodeProps`、流程 `FlowConfig`（`shared/config`）、`ProcessConfig`。
- serde 读/写共享 `WfNodeProps`/`FlowConfig`（延续已有规范 `oa:<name>` 逐元素格式），兼容旧定义。

## 设计

### 1. 类型统一（moddle.ts / serde.ts）
- 废弃 BPMN 本地 `NodeConfig`/`FlowConfig` 类型，改用共享 `WfNodeProps`（`../../types`）与 `FlowConfig`（`../../shared/config`）。
  - `WfNodeProps` 比旧 BPMN `NodeConfig` 多 `voteConfig`/`condition`、少 `showApprovalRecord`（`showApprovalRecord` 已在仿钉钉侧精简，随之删除 BPMN 的 `oa:showApprovalRecord` 写入；读旧定义忽略）。
  - 共享 `FlowConfig` = `{operations, start:{scope,taskTitle}, variables}`；旧 BPMN `FlowConfig` 的 `start.mobileStart` 删除、补 `taskTitle`。
- serde：
  - `readNodeConfig(bo): WfNodeProps` —— 逐元素读 `oa:assigneeRules/multiMode/emptyStrategy/voteConfig/ccUsers/allowedOps/handleOptions/auditMenu/timeout/formPerms/commentRequired/events`（已有），新增 `condition`（`oa:condition` JSON，供条件分支——见 §4 范围）；缺省回退旧 `oa:NodeConfig` 迁移（已有）。
  - `writeNodeConfig(...,cfg: WfNodeProps)` —— 逐元素写（单次 updateProperties，已有 `rebuildExtensions/applyExtensions`），去掉 `oa:showApprovalRecord`。
  - `readFlowConfig/writeFlowConfig` 用共享 `FlowConfig`。

### 2. 节点面板复用（editor.tsx `NodeConfigSection`）
把手搓 JSX 整体替换为共享面板：
```tsx
<PropertyPanel
  target={{ nodeId: element.id, nodeType: isCc ? "cc" : "approval" }}
  config={readNodeConfig(element.businessObject)}
  onChange={(next) => writeNodeConfig(modeling, bpmnFactory, element, next)}
  formFields={formFields}                    // BPMN 表单字段来源（暂 []，见 §5）
  nodeName={element.businessObject.name}
  onNodeNameChange={(name) => modeling.updateProperties(element, { name })}
  nodeOptions={otherUserTasks}               // elementRegistry 里其它 UserTask，排除自身
  flowConfig={readFlowConfig(rootBo)}        // 供"来自变量"选流程变量
/>
```

### 3. 流程面板复用（editor.tsx 流程级区）
把"流程级属性（暂不可用）"替换为：
```tsx
<PropertyPanel
  target="process"
  config={{ base: bpmnBase, flow: readFlowConfig(rootBo) }}
  onChange={(next) => { writeFlowConfig(modeling, bpmnFactory, rootEl, next.flow); onBaseChange?.(next.base) }}
  formFields={formFields}
/>
```
- **base（name/remark/icon/category）—— 本轮纳入**：base 是 ProcessDef 表列、不在 BPMN XML。`defs.tsx` 已持有 `editor.base` + 变更入口（仿钉钉设计器已用）。做法：BPMN 编辑器组件**新增 `base` + `onBaseChange` props**（由 defs.tsx 传入，与仿钉钉同源），流程面板的"基础信息"区真编辑 def 名称/说明/图标/分类，onChange 拆分：`next.base`→`onBaseChange`、`next.flow`→`writeFlowConfig`。

### 4. 条件/网关 —— 本轮纳入
BPMN 排它网关的分支条件在 **outgoing sequenceFlow** 上。做法：
- bpmn-js 选中一条"排它网关的 outgoing sequenceFlow"（`element.type==="bpmn:SequenceFlow"` 且 source 是 `bpmn:ExclusiveGateway`）→ 渲染共享 `PropertyPanel` target=`{nodeId: flowId, nodeType:"condition"}`，`branchMeta` 按是否 default 流判定。
- 存储：结构化条件存该 sequenceFlow 的 `oa:condition`（JSON `BranchCondition`，与节点 oa:* 同机制，serde 扩展读写）；**同时**把编译后的 UEL 写到 sequenceFlow 的 `conditionExpression`（供 Flowable 执行）——编译规则同 `JsonToBpmnConverter`（`${field op value}` + AND/OR 拼接；isDefault 分支不写 conditionExpression，改设网关 `default` 指向它）。
- 读回：优先解析 `oa:condition`（结构化）；无则从 `conditionExpression` 兜底展示原始 UEL（只读文本）。

### 5. formFields 来源 —— 本轮接上
`defs.tsx` 已从绑定表单解析出 `editor.formFields`（`resolveFormFields`→`widgetsToFields`）。BPMN 编辑器**新增 `formFields` prop**（defs.tsx 传入），供：条件字段选择、FORM_FIELD 办理人来源、表单字段权限区的字段候选。无绑定表单时为 `[]`（各区优雅降级，不崩）。

## 向后兼容
- 旧 BPMN 定义（`oa:NodeConfig` 单块 / `oa:showApprovalRecord`）：readNodeConfig 回退迁移（已有），`showApprovalRecord` 读到即忽略。
- 转换器生成的定义（`oa:assigneeRules` 等）：已被读；本轮扩展读全部区块。

## 测试
- `tsc -b` + `pnpm build` 退出 0。
- 浏览器（以 BPMN 为主）：`purchase_approval` 打开 → 节点面板出现**基础/高级双 tab**，高级 tab 含 办理选项/审核菜单/超时/表单字段权限/节点事件；票签模式可配 voteConfig；选画布空白 → 流程面板可配 流程操作/启动权限/任务标题/流程变量（不再"暂不可用"）。校验 0 错误。
- 端到端：BPMN 设计器配一个**节点事件 NOTIFY** + **超时**，保存→发起→验证事件触发（对齐仿钉钉刚测过的路径）。
- 回归：仿钉钉设计器不受影响（共享面板未改行为，仅被 BPMN 复用）；smoke 保持全绿。

## 影响文件
- `bpmn/oa/moddle.ts`（类型换共享 WfNodeProps/FlowConfig + 注册 `oa:condition`）、`bpmn/oa/serde.ts`（读写 WfNodeProps/FlowConfig + sequenceFlow 的 oa:condition/conditionExpression 编译）、`bpmn/editor.tsx`（节点/流程/网关三 target 复用共享 PropertyPanel + 新增 base/onBaseChange/formFields props + sequenceFlow 选中处理）、`bpmn/oa/validate.ts`（按 WfNodeProps 校验）。
- `src/pages/workflow/defs.tsx`（给 BPMN 编辑器传 base/onBaseChange/formFields，与仿钉钉同源）。
- 复用（不改）：`shared/property-panel.tsx`。

## 非目标（YAGNI）
- 不改后端（运行时已读规范格式的 oa:assigneeRules/conditionExpression）。
- 不改仿钉钉设计器行为（共享面板仅被 BPMN 复用，行为不变）。
- 不做包容/并行网关的条件（仅排它网关 sequenceFlow 条件；包容网关如需另议）。
- 不引入新的 oa 扩展语义之外的东西（沿用既有 oa:<name> 逐元素格式）。
