# 流程设计器企业级升级设计（对标 warm-flow / 宜搭 / 钉钉）

> 依据用户 14 张参考图 + 探索确认的现状。目标：把流程设计器的属性配置提升到企业级工作流平台水平。

## 0. 现状（探索确认，关键）

| 设计器 | 状态 | 能力 |
|---|---|---|
| **仿钉钉（dingtalk）** | ✅ 主力，能持久化 | 审批人规则(ORG/LEADER/FORM_FIELD/INITIATOR)、串并签/依次、空值策略、结构化条件分支、抄送、子流程/定时/触发/AI 四类高级节点；serialize.ts 双向序列化到后端 `{nodes}` |
| **BPMN（bpmn-js）** | ⚠️ 演示态 | 只有 画图+名称+备注+顺序流条件 能落库；**处理人/优先级配了保存即丢**（editor.tsx 明确标注"演示存储、不写回 XML"），无执行语义、无校验 |

**两个设计器都缺**：流程级属性面板、办理选项、按钮操作白名单、节点/流程事件配置、自定义表单、发布校验。

**但后端 P1/P2/P3 已实现大量对应能力**（办理人求值 AssigneeResolver、全部中国式操作 allowedOps、事件 OaEventDelegate、超时、驳回策略、票签、包容分支…）——**属性面板的本质是把已有后端能力暴露成配置 UI**，不是从零造引擎。

**核心建议**：企业级属性面板做在**仿钉钉设计器**（主力、已持久化、扩展成本低）；BPMN 设计器只修基础问题（校验 + 菜单业务化），不强推它承载全部企业级属性（moddle 扩展持久化成本极高、收益低）。

## 1. 你的 5 个问题 → 设计方案

### 问题1：发布前流程校验（图13）
发布/保存前前端校验 + 画布高亮错误节点 + 错误清单，阻止非法发布：
- 唯一开始节点、必须可达结束
- **每个审批节点必须配办理人**（否则报错）
- 条件分支必须有默认分支或条件互斥完备
- 无悬空/不可达节点、无死循环
- BPMN 模式额外：非并行网关节点单出口（图13 审批节点两个出口→需网关或报错）

### 问题2：replace menu 英文+定位（图14）
BPMN 原生"更改类型"菜单列的是 BPMN 类型（Task/Service task…）与我们业务节点不符。方案：**自定义 palette + contextPad + popupMenu provider**，只提供业务节点（审批/抄送/条件网关/并行网关/子流程/定时/触发/AI/开始/结束），全中文，修正弹窗定位。（仿钉钉设计器本是自定义画布，无此问题。）

### 问题3：流程属性 + 事件配置面板（图15-21,24,25）
**统一属性面板**（右侧固定，`基础属性 / 高级属性` 双 Tab，参考图18）：

**A. 流程级**（点画布空白）
- 基础信息：名称*/说明/图标/分类（图15）
- 流程操作（开关+配置，对应 P2 后端能力，图15）：作废、收回、催办、撤销 + 撤销选项(清空历史审批记录/指定节点后不允许撤销)、跟踪(禁止查看表单数据/跟踪方式 BPMN图|时间线)
- 流程启动（图16）：启动权限(OrgPicker 多选)、任务标题(支持表单字段 fx 变量)、任务摘要、移动端启动、传递、新页签打开、**启动流程选身份/办理任务选身份**(兼任场景，对应已实现的 assignment 切换)
- 流程安全（图17）：保密级别、表单安全
- 其他设置（图17）：合理完成时限、宽延警告时限、流程级别(顶层/子流程)、模型分类
- 高级属性（图18）：流程变量、事件触发器、信号、消息、扩展属性

**B. 节点级**（点节点，图19）
- 基础信息：名称*/审批记录开关/表单应用(节点可操作表单+字段权限)/任务通知
- 审核菜单（图20）：无特殊动作 / 跳转(开始节点|指定节点|跳转等待) / 退回(历史节点) —— 对应 P2 jump/reject
- 按钮操作（图21，对应 P2 的 allowedOps）：办理/传阅(抄送)/转办/特批/加签/复杂加签/会签/阅办/协同 —— 开关式，可调顺序
- 办理人（见问题4）
- 办理选项（见问题4）
- 规则设置、节点事件

**事件类型**（18 种，图24/25，对应后端 OaEventDelegate 钩子）：
`ACTIVITY_CONFIRM_PARTICIPANTS`(节点就绪参与者)/`TASK_BEFORE_COMPLETE`/`TASK_AFTER_COMPLETE`/`TASK_BEFORE_UNDO`/`TASK_AFTER_UNDO`/`TASK_AFTER_CREATED`/`TASK_SUSPEND`/`TASK_RESUME`/`FORM_TOOLBAR_BUILD`/`FORM_COMPLETE_VALIDATE`(表单办理前校验)/`FORM_BEFORE_LOAD`/`FORM_AFTER_LOAD`/`FORM_BEFORE_SAVE`/`FORM_AFTER_SAVE`/`FORM_BEFORE_REMOVE`… 每个事件配 动作(通知/Webhook/脚本)。

### 问题4：办理人体系（图22/23）
**类型扩展**（对齐图22）：账户/角色岗位/部门/单位/复杂找主管/群组/服务API/其他 + **来源**(与流程申请人相关→流程申请人/部门主管等)。当前 4 类(ORG/LEADER/FORM_FIELD/INITIATOR)扩展为这套。
**办理选项**（图23，多为后端已支持能力的开关化）：串/并签、候选人(认领,P2 claim)、历史优先(同节点历史办理人)、账户排序、限制范围(角色/岗位内)、包含自己、包含兼任、账户选中(默认勾选)、账户禁选(只读)、自动跳过(符合规则跳过)、合理完成时限、宽延警告时限。

### 问题5：自定义表单（图26）
表单绑定二选一：
- **动态表单**：可视化表单设计器创建（现状）
- **自定义表单**：指定 React 路由路径(提交路径 + 查看路径)，用自定义页面作表单。ProcessDef 增 `formType:DYNAMIC|CUSTOM` + `formSubmitPath`/`formViewPath`；发起/详情按类型渲染动态表单或路由到自定义页面。

## 2. UI 形态
参考图采用**右侧固定属性面板 + 基础/高级 Tab + 可折叠分区(Collapsible)**，取代现状的 Drawer。流程级/节点级共用面板框架，按选中对象切换内容。

## 3. 后端配套（多为字段扩展，引擎能力已具备）
- ProcessDef 扩展：flowConfig(流程操作开关/启动权限/时限/安全)、formType/自定义表单路径。
- 节点 nodeProps 扩展：allowedOps、办理选项(候选/历史优先/包含兼任…)、审核菜单、节点事件、表单字段权限、超时。
- 转换器 JsonToBpmn 读取新配置生成对应 BPMN/监听器；运行时按配置执行(大部分 P2/P3 已实现，补配置读取)。

## 4. 分期
- **P1（先做，修痛点+核心）**：发布校验 + BPMN 业务化菜单/中文化 + 仿钉钉右侧属性面板框架(基础/高级Tab) + 流程级基础(流程信息/流程操作开关/启动权限) + 自定义表单二选一 + 节点按钮操作白名单(allowedOps 开关)。
- **P2（办理体系）**：办理人类型扩展+来源 + 办理选项全套 + 审核菜单(跳转/退回配置) + 节点超时/审批意见必填/表单字段权限。
- **P3（事件+高级）**：18 种节点/流程事件配置面板 + 流程变量/信号/消息 + 任务标题fx变量 + 流程安全/其他设置 + (可选)BPMN moddle 扩展持久化。

## 5. 待确认决策
1. 主设计器投入：仿钉钉增强(推荐) / BPMN 也做到持久化 / 两者共享属性面板
2. 分期节奏：按 P1→P2→P3 分批 / 一次全做
3. 自定义表单：需要(React 路径) / 暂不需要

---

# P1 数据契约（三 agent 共同依据）

> 决策：两设计器共享属性面板 + BPMN 也持久化；分批 P1→P2→P3；自定义表单要(React 路径)。

## 流程级 flowConfig（存 ProcessDef，仿钉钉存 designerJson.flowConfig / BPMN 存 process extensionElements oa:flowConfig）
```jsonc
{
  "operations": {                     // 流程操作开关（对应 P2 后端能力）
    "terminate": true, "retrieve": false, "urge": false, "cancel": true,
    "cancelOptions": { "clearHistory": false, "forbidAfterNodes": [] },
    "track": { "enabled": true, "hideFormData": false, "mode": "BPMN" } // BPMN|TIMELINE
  },
  "start": {                          // 流程启动
    "scope": [OrgRef],                // 启动权限(空=不限)
    "taskTitle": "", "taskSummary": [],
    "mobileStart": true, "startChooseIdentity": false, "handleChooseIdentity": true
  },
  "security": { "secretLevel": 0, "formSecurity": false },
  "misc": { "completeLimit": null, "warnLimit": null, "level": "TOP", "modelCategory": "" }
}
```

## 节点级 nodeConfig（扩展 WfNodeProps / dingtalk StepNode / BPMN oa:nodeConfig）
现有：assigneeRules / multiMode / emptyStrategy / ccUsers / condition。P1 新增：
```jsonc
{
  "allowedOps": ["approve","reject","transfer","delegate","addSign","counterSign","assist","retrieve","print"], // 按钮操作白名单(P2 已实现这些操作)
  "showApprovalRecord": true,
  "handleOptions": {                  // 办理选项(P1 预留结构, P2 落地全部)
    "candidate": false, "historyFirst": true, "includeSelf": true, "includeConcurrent": true
  }
  // P2: auditMenu / 更多 handleOptions; P3: events / formPerms
}
```

## 自定义表单（ProcessDef 扩展）
```jsonc
{ "formType": "DYNAMIC" | "CUSTOM",
  "formCode": "leave", "formVersion": 1,        // DYNAMIC 用
  "formSubmitPath": "/flow/leave/create",       // CUSTOM 用: 发起页 React 路由
  "formViewPath": "/flow/leave/view" }          // CUSTOM 用: 详情查看路由
```
发起：CUSTOM → 跳 formSubmitPath；详情：CUSTOM → 内嵌/跳 formViewPath；DYNAMIC → 现有动态表单渲染。

## 共享属性面板组件（A 建，BPMN/仿钉钉共用）
`src/pages/workflow/designer/shared/PropertyPanel`：右侧固定，`基础属性 / 高级属性` Tab，Collapsible 分区。
- props: `{ target: "process" | { nodeId, nodeType }, config, onChange, formFields, ... }`
- process target → 流程级面板；node target → 节点级面板（按 nodeType 显示审批/抄送/条件等对应分区）。
- 两设计器把各自选中态映射成统一 config 传入，onChange 回写各自模型。

## 发布校验（A 建通用规则 + 各设计器补特有）
`validateFlow(model)` → `[{ nodeId?, level:"error"|"warn", message }]`：唯一开始/可达结束/审批节点必配办理人/条件分支默认分支或完备/无悬空节点。发布前调用，有 error 阻止 + 画布高亮 + 清单。

---

# P2 / P3 数据契约（属性面板深化，前端顺序 P2→P3 + 后端配套）

## P2 办理体系（扩展 WfNodeProps / nodeConfig）
### 办理人模型（AssigneeRule：类型 × 来源 二维正交，现状契约 —— 取代下方旧扁平说明）

> **本节为当前权威契约**（2026-07-08 起，assignee-model-2d 重构后）。之前版本把"类型"和"来源/解析策略"混在一个扁平 `kind`（如 `ROLE_POST/UNIT/FIND_LEADER/GROUP/SERVICE_API/FORM_FIELD`）里，概念不正交；已重构为两个正交维度。本文档后面（P2/P3 实现记录、校准清单等）出现的旧 `kind` 列表（`ROLE_POST/UNIT/FIND_LEADER/GROUP/SERVICE_API` 等）均为历史记录，已被本节取代，不再是当前实现。

**类型（AssigneeKind，WHO，6 项，只保留我们自己的组织实体）**

| 类型 | 语义 | 备注 |
|---|---|---|
| `ACCOUNT` 账户 | 具体人员 | 动态来源都挂在这里 |
| `ROLE` 角色 | 角色 | 只做固定选 |
| `POST` 岗位 | 岗位 | 只做固定选 |
| `DEPT` 部门 | 部门 | 固定选 / 与申请人相关 |
| `LEADER` 发起人主管 | 快捷：申请人第 N 级主管 | 预置来源，无需选来源 |
| `INITIATOR` 发起人本人 | 快捷：申请人本人 | 预置来源，无需选来源 |

**来源（AssigneeSource，HOW，运行时解析策略，7 项）**

| 来源 | 含义 | 后端实现 |
|---|---|---|
| `FIXED` 固定 | picker 直接选（按类型限定范围） | `expandOrgRef` |
| `FORM_FIELD` 来自表单 | 表单选人/选组织字段 | 读 execution 变量 |
| `VARIABLE` 来自变量 | 流程变量（前置服务/脚本算出） | 读变量，与表单同路径 |
| `FORMULA` 来自公式 | 低代码公式 | `FormulaEvaluator` |
| `APPLICANT` 与申请人相关 | 申请人所在部门 | `resolveApplicantSource` |
| `PREV_HANDLER` 与上个办理人相关 | 上个节点 assignee（可选取其主管） | `HistoryService` 查询本实例最近已完成 userTask |
| `NODE_HANDLER` 与指定节点办理人相关 | 选定节点 assignee（可选取其主管） | `HistoryService` 按 `taskDefinitionKey=fromNodeId` 查询本实例该节点已完成任务 |

**来源矩阵（哪个类型挂哪些来源）**

| 类型 | 可选来源 |
|---|---|
| 账户 ACCOUNT | 固定 FIXED · 来自表单 FORM_FIELD · 来自变量 VARIABLE · 来自公式 FORMULA · 与上个办理人 PREV_HANDLER · 与指定节点办理人 NODE_HANDLER |
| 角色 ROLE | 固定 FIXED |
| 岗位 POST | 固定 FIXED |
| 部门 DEPT | 固定 FIXED · 与申请人相关 APPLICANT（申请人所在部门） |
| 发起人主管 LEADER | （快捷：第 N 级主管，无来源选择） |
| 发起人本人 INITIATOR | （快捷：无来源选择） |

取舍：账户是"人"，动态来源全挂账户下；角色/岗位只做"固定选"（要动态角色用「账户+公式」的 `ROLE()` 函数）；"与申请人相关"只留在部门下（本人/主管已被两个快捷类型覆盖）。**不引入**单位/群组/服务API/共享任务/动态角色岗位。

**AssigneeRule 结构（各来源专属字段）**

```ts
interface AssigneeRule {
  kind: "ACCOUNT" | "ROLE" | "POST" | "DEPT" | "LEADER" | "INITIATOR"
  source?: "FIXED" | "FORM_FIELD" | "VARIABLE" | "FORMULA" | "APPLICANT" | "PREV_HANDLER" | "NODE_HANDLER"
  // 来源专属字段：
  refs?: OrgRef[]             // FIXED（账户/角色/部门）：按 kind 限定 picker 范围
  postName?: string           // FIXED（岗位）：岗位名/编码，逗号分隔多个
  field?: string               // FORM_FIELD：选人字段 key
  varName?: string             // VARIABLE：流程变量名（从 flowConfig.variables 选）
  formula?: string             // FORMULA：公式表达式
  applicantValue?: "DEPT"      // APPLICANT：目前仅"申请人所在部门"
  fromNodeId?: string          // NODE_HANDLER：目标节点 id
  takeLeader?: boolean         // PREV_HANDLER/NODE_HANDLER：取其直属主管
  level?: number               // LEADER：第 N 级主管
}
```

**后端解析（AssigneeResolver.evalRule，来源优先分发）**：先看 `source` 分发解析策略；`kind` 在"固定"时决定 `expandOrgRef` 展开方式，在跨节点来源时决定要不要取主管。`VARIABLE` → `execution.getVariable(varName)` → 解析 userId 集合；`PREV_HANDLER`/`NODE_HANDLER` → 注入 `HistoryService` 查本实例已完成 userTask 的 assignee（`NODE_HANDLER` 按 `taskDefinitionKey=fromNodeId` 精确匹配），`takeLeader=true` 时再解析其部门主管。多条规则取并集去重。离线预测（`resolveOffline`）：跨节点来源无历史可查时返回空集合，前端标注"运行时确定"。

**向后兼容（不强制迁移旧 designerJson）**

后端 `evalRule` 同时认新旧两种形状：新 `source` 优先分发；老 `type=LEADER/INITIATOR/FORM_FIELD/FORMULA/ACCOUNT/ROLE/POST/DEPT` 与老 `source=RELATED_TO_APPLICANT+sourceValue` 继续解析，已发布老定义不重存也能跑。前端 `deserializeDingtalk` 把老扁平映射到新 `{kind, source}`，下次保存落成新形状：

| 旧 | 新 |
|---|---|
| `type:LEADER, level` | `kind:LEADER, level` |
| `type:INITIATOR` | `kind:INITIATOR` |
| `type:FORM_FIELD, field` | `kind:ACCOUNT, source:FORM_FIELD, field` |
| `type:FORMULA, formula` | `kind:ACCOUNT, source:FORMULA, formula` |
| `type:ORG/ACCOUNT, refs` | `kind:ACCOUNT, source:FIXED, refs` |
| `type:ROLE, refs` | `kind:ROLE, source:FIXED, refs` |
| `type:POST, postName` | `kind:POST, source:FIXED, postName` |
| `type:DEPT, refs` | `kind:DEPT, source:FIXED, refs` |
| `source:RELATED_TO_APPLICANT, sourceValue:APPLICANT` | `kind:INITIATOR` |
| `source:RELATED_TO_APPLICANT, sourceValue:APPLICANT_DEPT_LEADER` | `kind:LEADER, level:1` |
| `source:RELATED_TO_APPLICANT, sourceValue:APPLICANT_DEPT` | `kind:DEPT, source:APPLICANT` |

详见设计稿 `docs/superpowers/specs/2026-07-08-assignee-model-2d-design.md`。

### 办理人类型（AssigneeRule.type 扩展，对齐参考图22）—— 历史记录，已被上方两维模型取代
现有 ORG/LEADER/FORM_FIELD/INITIATOR，P2 细化为：
```jsonc
{ "kind": "ACCOUNT|ROLE_POST|DEPT|UNIT|FIND_LEADER|GROUP|SERVICE_API|FORM_FIELD|INITIATOR",
  "refs": [OrgRef],           // ACCOUNT/DEPT/ROLE_POST 用
  "source": "RELATED_TO_APPLICANT|SPECIFIED",  // 来源：与流程申请人相关 / 指定
  "sourceValue": "APPLICANT|APPLICANT_DEPT_LEADER|...",  // 来源具体值
  "level": 1,                 // FIND_LEADER 用（第 N 级主管）
  "field": "approver",        // FORM_FIELD 用
  "apiUrl": "" }              // SERVICE_API 用
```
### 办理选项（handleOptions 全套，对齐参考图23）
```jsonc
{ "signMode": "ANY|ALL|SEQUENCE|VOTE",  // 串/并签(与 multiMode 统一)
  "candidate": false,        // 候选人认领
  "historyFirst": true,      // 历史审批人优先
  "accountSort": false,      // 账户排序(串签顺序)
  "limitRange": false,       // 限制在角色/岗位范围内
  "includeSelf": true,       // 包含发起人自己
  "includeConcurrent": true, // 包含兼任
  "accountChecked": true,    // 默认勾选所有办理人
  "accountDisabled": false,  // 办理人只读不可改
  "autoSkip": false,         // 符合规则自动跳过
  "completeLimit": null, "warnLimit": null }  // 合理完成/宽延警告时限
```
### 审核菜单（auditMenu，对齐参考图20）
```jsonc
{ "special": "NONE|JUMP_START|JUMP_NODE|JUMP_WAIT_NODE|JUMP_WAIT_END|JUMP_WAIT_HISTORY|RETURN_HISTORY",
  "targetNodeId": "" }       // JUMP_NODE/等待用
```
### 节点其他 P2：`commentRequired`(审批意见必填)、`timeout:{hours,action,remindEvery}`、`formPerms:{field:HIDDEN|READ|EDIT}`

## P3 事件与高级
### 节点事件（events，对齐参考图24/25 的 18 种）
```jsonc
[{ "trigger": "ACTIVITY_CONFIRM_PARTICIPANTS|TASK_BEFORE_COMPLETE|TASK_AFTER_COMPLETE|TASK_BEFORE_UNDO|TASK_AFTER_UNDO|TASK_AFTER_CREATED|TASK_SUSPEND|TASK_RESUME|FORM_TOOLBAR_BUILD|FORM_COMPLETE_VALIDATE|FORM_BEFORE_LOAD|FORM_AFTER_LOAD|FORM_BEFORE_SAVE|FORM_AFTER_SAVE|FORM_BEFORE_REMOVE",
   "action": "NOTIFY|WEBHOOK|SCRIPT",
   "notify": {to:[OrgRef], template}, "webhookUrl": "", "script": "" }]
```
### 流程高级（flowConfig 扩展）
```jsonc
{ "variables": [{name, type, defaultValue}],   // 流程变量
  "signals": [{name, scope}], "messages": [{name}],  // 信号/消息
  "start": { "taskTitle": "{申请人}的请假 ${days}天" },  // fx 变量(表单字段插值)
  "security": {secretLevel, formSecurity}, "misc": {completeLimit,warnLimit,level,modelCategory} }
```

## 后端配套（多为读取已有引擎能力）
- 办理人类型 resolver 扩展（AssigneeResolver 增 ROLE_POST/UNIT/FIND_LEADER/GROUP/SERVICE_API/source 解析）。
- 办理选项：candidate→candidateGroup认领、historyFirst→查历史办理人、autoSkip→自动跳过、includeConcurrent 已支持。
- 审核菜单：JUMP/RETURN 对应 P2 已实现的 jump/reject(ChangeActivityState)，节点配置声明可用动作。
- 节点事件：转换器写 taskListener/executionListener extensionElements → OaEventDelegate 统一分发(P1/P2/P3 事件基建已有)。
- 任务标题 fx：发起时按 taskTitle 模板插值表单字段。

## 实施顺序（前端一个 agent 顺序 P2→P3；后端一个 agent 配套；两者并行）
每阶段：property-panel 扩展 + serialize/types + bpmn moddle + 后端读取 + smoke + tsc/build。

---

# 跟踪图按设计器类型渲染（待 P2/P3 完成后做）

> 需求：流程定义是钉钉→详情跟踪图用钉钉风格；是 BPMN→用 bpmn 图。当前详情统一用 bpmn-js 渲染（不管设计器类型），需分流。

## 方案
- **后端** InstanceService.buildDetail 详情返回增 `designerType`(DINGTALK|BPMN) + `designerJson`(钉钉模型；BPMN 已有 bpmnXml)。highlight.completed/active 的节点 id 两种设计器通用（转换器保留节点 id）。
- **前端** 新建只读钉钉跟踪图组件 `DingtalkTrack`（复用 dingtalk canvas/layout 渲染 designerJson，按 highlight 高亮节点 id，节点只读、无编辑）。instance-detail 的流程跟踪 Drawer 内按 `detail.designerType` 选 `DingtalkTrack`(钉钉) 或 `BpmnTrack`(现状)。
- 高亮映射：钉钉节点 id = 转换器生成的 BPMN activity id（mgr/gm/cc1…），highlight 直接可用；BPMN 特有的网关/flow id 在钉钉模型无对应，忽略即可。

## 为何排在 P2/P3 之后
依赖 dingtalk 画布(canvas/layout/model) 与 server 的 InstanceService.buildDetail——**正是 P2/P3 两个 agent 此刻在改的文件**，现在做会冲突。P2/P3 完成后统一做，且那时 dingtalk 模型已含 P2/P3 全部节点属性，跟踪图能一并正确渲染。

---

# P2 / P3 前端实现完成记录（前端 agent，供后端联调对齐）

> 状态：**P2 + P3 前端已完成**，`tsc --noEmit` 通过（designer/ 域 0 错误）。共享属性面板 + 仿钉钉序列化 + BPMN oa 类型均已落地。字段名严格按上文「P2/P3 数据契约」，后端按同一契约读取。

## 已交付
### P2 办理体系
- **办理人类型扩展**（`types.ts` `AssigneeRule`）：由旧判别联合(`type: ORG/LEADER/FORM_FIELD/INITIATOR`)改为扁平 `kind` 契约：`ACCOUNT|ROLE_POST|DEPT|UNIT|FIND_LEADER|GROUP|SERVICE_API|FORM_FIELD|INITIATOR` + `source`(RELATED_TO_APPLICANT|SPECIFIED) + `sourceValue`(APPLICANT|APPLICANT_DEPT_LEADER|APPLICANT_DEPT|APPLICANT_UNIT) + `refs`/`level`/`field`/`apiUrl`。`property-panel.tsx` `AssigneeRulesEditor` 重写为「类型下拉 + 来源下拉 + 专属字段」（参考图22）。
- **办理选项全套**（`HandleOptions`）：`signMode`(ANY|ALL|SEQUENCE|VOTE) + `candidate/historyFirst/accountSort/limitRange/includeSelf/includeConcurrent/accountChecked/accountDisabled/autoSkip` + `completeLimit/warnLimit`。高级 Tab「办理选项」分区（参考图23，浏览器自检已确认渲染）。
- **审核菜单**（`AuditMenu`）：`special`(NONE|JUMP_START|JUMP_NODE|JUMP_WAIT_NODE|JUMP_WAIT_END|JUMP_WAIT_HISTORY|RETURN_HISTORY) + `targetNodeId`（参考图20）。
- **节点其他**：`commentRequired`(意见必填)、`timeout:{hours,action:NOTIFY|AUTO_PASS|AUTO_REJECT|TRANSFER,remindEvery}`、`formPerms: Record<fieldKey, HIDDEN|READ|EDIT>`。

### P3 事件与高级
- **节点事件**（`NodeEvent[]`）：`trigger`(18 种，见 `EVENT_TRIGGER_META`) + `action`(NOTIFY|WEBHOOK|SCRIPT) + `notify:{to:OrgRef[],template}`/`webhookUrl`/`script`。高级 Tab「节点事件」分区。
- **流程高级**（`FlowConfig` 扩展）：`variables:[{name,type:STRING|NUMBER|BOOLEAN|DATE|JSON,defaultValue}]`、`signals:[{name,scope}]`、`messages:[{name}]`；任务标题 fx 复用 `flow.start.taskTitle`；`misc.modelCategory` 输入；流程安全 `security` 沿用 P1。流程级高级 Tab 落地。

## 序列化结构
- **仿钉钉**（`dingtalk/serialize.ts`）：审批节点内联 `assigneeRules(kind 契约)/handleOptions/auditMenu/commentRequired/timeout/formPerms/events`；flowConfig 顶层含 `variables/signals/messages`。双向（`serializeDingtalk`/`deserializeDingtalk`）。**反序列化兼容旧 `type` 判别字段**：`ORG→ACCOUNT`、`LEADER→FIND_LEADER(level)`、`FORM_FIELD/INITIATOR` 原样（`LEGACY_TYPE_TO_KIND`）。已用 seed 数据 `leave_approval` 验证：旧 `LEADER` 正确回显为「复杂找主管」。
- **BPMN**（`bpmn/oa/moddle.ts`+`serde.ts`）：`NodeConfig` 增 `handleOptions`(全套，复用 `defaultHandleOptions`)/`auditMenu/commentRequired/timeout/formPerms/events`；`FlowConfig` 增 `variables/signals/messages`。整体 JSON 存 `oa:NodeConfig`/`oa:FlowConfig` body，随 `saveXML` 持久化、加载反序列化（round-trip 自动生效）。注意：BPMN 设计器仍用自有属性面板（`editor.tsx`），本次仅保证新字段类型/默认值可持久化 round-trip；BPMN 面板 UI 未加新分区（其 `assigneeRules` 为扁平 `OrgRef[]`，与仿钉钉 kind 结构不同，需后续统一）。

## 与后端联调点
1. **办理人 `kind` 契约**：后端 `AssigneeResolver` 需支持 `kind` + `source`/`sourceValue`（与申请人相关时不看 refs）+ `level`(FIND_LEADER)/`field`(FORM_FIELD)/`apiUrl`(SERVICE_API)。旧 `type` 数据前端已兼容读，但**新写出一律为 `kind`**——后端读取应认 `kind`（可保留 `type` 兜底）。
2. **办理选项**：`signMode` 与节点 `multiMode` 二者并存（面板 multiMode 仍在基础 Tab，handleOptions.signMode 在高级 Tab）；后端以哪个为准需约定（建议 signMode 优先，multiMode 兜底）。
3. **审核菜单/超时/事件/表单权限/流程变量**：均为新增内联字段，后端转换器 `JsonToBpmn` 需读取并生成对应 taskListener/executionListener/超时边界事件/字段权限。
4. **审核菜单 targetNodeId**：当前 UI 为文本输入节点 id（面板无全量节点列表）；后端按 id 解析跳转/退回目标。

## 未尽事项
- BPMN 设计器属性面板未接入共享 `PropertyPanel`（成本高、结构差异大），新 P2/P3 字段仅类型层 round-trip，无编辑 UI。
- 浏览器自检：因**并行会话共用同一 Chrome**（另一 agent 正在 `/workflow/instances/2` 测 `wf-op-dialogs`），多步导航被反复抢占，仅稳定截到 P2 办理人类型扩展 + 办理选项全套两屏（均正常）；审核菜单/超时/事件/流程变量分区为同构渲染 + tsc 校验通过。
- `pnpm build` 当前被 `src/components/wf-op-dialogs.tsx`（并行 agent 正在编辑，报未用 import，与本次改动无关）阻断；designer/ 域 `tsc -b` 0 错误。

## 待查 bug（P2/P3 联调发现）
- **taskTitle fx 多占位符插值**：模板含多个占位（如 `{申请人}的事假${days}天`）时，`${表单字段}` 偶发插值为空（`{申请人}` 正常）；但 minimal `X${days}Y` 与后端 smoke 均通过。疑 interpolateTitle 的 Matcher.appendReplacement 在中文 literal + 多 match 下的边界问题，待后端复现修复。

---

# 设计校准与补全（用户多轮反馈汇总，按我们的设计来，去照搬）

> 核心：P2/P3 过度照搬 warm-flow/钉钉参考图，加了我们系统没有的概念；同时漏了我们自己设计的特色(票签)与该有的节点分支。本节是校准+补全的完整清单，**待跟踪图 agent 完成后系统实施**(避免 dingtalk model/canvas + server 冲突)。

## A. 办理人体系（按我们组织模型：用户/部门树/岗位/角色/任职）

> 本节的类型精简目标已达成，并在此基础上进一步做了类型×来源二维正交重构（`FORM_FIELD/FORMULA` 从"类型"归位为"来源"，新增 `VARIABLE/PREV_HANDLER/NODE_HANDLER` 来源）。**当前权威契约见前文「办理人模型（AssigneeRule：类型 × 来源 二维正交，现状契约）」节**，本节以下内容为历史决策记录。

- **精简类型**，保留：指定人员(ACCOUNT) / 角色(ROLE) / 岗位(POST) / 部门(DEPT) / 发起人主管(LEADER,N级) / 表单人员字段(FORM_FIELD) / 发起人本人(INITIATOR)。
- **去掉**：群组(GROUP) / 单位(UNIT) / 服务API(SERVICE_API) / 复杂找主管(合并进发起人主管)。前端 config.ts ASSIGNEE_KIND_META + property-panel AssigneeRulesEditor + serialize + 后端 AssigneeResolver 一并删。
- **新增「自定义公式」类型**（用户要，参考低代码计算公式，前端+后端）：
  - 前端 **公式编辑器**(FormulaEditor)：函数库分类面板(取人:USER/ROLE/DEPT/POST/DEPT_LEADER/INITIATOR；逻辑:IF/AND/OR/NOT；比较运算)+ 字段引用(插入表单字段)+ 表达式输入 + 实时语法校验。参考简道云/宜搭公式编辑器交互。
  - 后端 **公式求值引擎**：解析表达式→求值出 userId 集合(结合表单数据/申请人上下文)。可基于受限表达式解析(白名单函数)，返回办理人集合。
  - 场景示例：`IF(days>3, ROLE("总经理"), DEPT_LEADER(1))`。

## B. 消除重复：多人审批模式
- 删除高级「办理选项」里的「签署模式」(signMode)——与基础属性「多人审批模式」(multiMode) 重复。**统一用 multiMode**(或签/会签/依次/票签)。config HandleOptions 删 signMode + SIGN_MODE_META；property-panel HandleOptionsSection 删签署模式 Select；serialize 去 signMode；后端只读 multiMode(转换器本就读 multiMode)。

## C. 票签完整（我们的设计特色）
- multiMode=VOTE(票签「按比例」) 选中时，基础属性展开 voteConfig 配置：**通过阈值**(threshold 0-1,显示百分比) + **权重**(可选,对指定人员/角色配权重,默认1)。serialize voteConfig{threshold,weights}。
- **后端 pass 调整**：WfVoteService.pass 无 weights 时**按比例**(每人等权,赞成数/总数>threshold 通过)，而非现在的退化"一票通过"。使"按比例"名副其实。

## D. 补节点/分支（后端引擎能力已有的补前端；新节点前后端做）
- **并行分支**(parallel)：fork 多分支并行→join 汇聚。后端 parallelGateway 已有，补 dingtalk 节点模型+画布+转换器映射。
- **包容分支**(inclusive)：满足的多分支都走，全不满足走默认。后端 inclusiveGateway 已有，补前端暴露。
- **自动通过**(auto-approve)：无需人审到达即自动通过的节点(serviceTask→自动 complete, 记录 action=AUTO_APPROVE)。
- **自动拒绝**(auto-reject)：到达即自动拒绝(常配合条件分支做自动驳回)。
- 路由分支：**不做**(用户明确)。

## E. 全面功能回归检查（"别搞没了"）
经多轮 agent 改动，系统巡检确认无回归：后端 smoke 全量 + 前端 tsc/build + 浏览器巡检所有关键页(工作台/我的审批六Tab/发起/监控/流程定义/表单定义/系统管理各页/组件示例/详情页) + 三大设计器(表单/仿钉钉/BPMN)。列出任何缺失/损坏。

## 实施方式
待跟踪图 agent 完成 → 前端 agent(办理人精简+公式编辑器+删signMode+票签UI+补4节点) + 后端 agent(resolver精简+公式求值+票签pass+新节点转换器) 并行 → 我做全面功能检查。

---

# 空壳精简执行清单（诚实审计后，用户决策：空壳全删 + 有意义的修好）

## 删除（纯空壳，前端UI+序列化+后端读取一并删；后端 grep 无读取者）
1. **节点事件**：EventTrigger 只保留 6 种真触发（ACTIVITY_CONFIRM_PARTICIPANTS/TASK_AFTER_CREATED/TASK_BEFORE_COMPLETE/TASK_AFTER_COMPLETE/TASK_BEFORE_UNDO/TASK_AFTER_UNDO）；删 TASK_BEFORE_CREATE/SUSPEND/RESUME/TIMEOUT + FORM_* 8种(共12种)。EventAction 删 SCRIPT（只留 NOTIFY/WEBHOOK）。
2. **办理选项 handleOptions**：删 accountSort/limitRange/includeSelf/includeConcurrent/completeLimit/warnLimit（保留 candidate/historyFirst/autoSkip；accountChecked/accountDisabled 标为纯前端办理页行为保留）。
3. **节点属性**：删 showApprovalRecord、taskNotify（只写不读）。
4. **timeout.action**：删 TRANSFER 选项（未实现，只留 NOTIFY/AUTO_PASS/AUTO_REJECT）。
5. **flowConfig 空壳**：删 operations.cancelOptions、operations.track、security(secretLevel/formSecurity)、misc(completeLimit/warnLimit/level/modelCategory)、signals、messages；start 删 mobileStart/startChooseIdentity/handleChooseIdentity/taskSummary。
6. **auditMenu**：简化为「是否允许跳转 allowJump / 是否允许退回 allowReturn」两个布尔（删 special 的 6 个 JUMP_WAIT_*/RETURN 细分——执行不由节点声明驱动）。

## 修复（有意义，接好线让其真生效，前后端）
1. **POST 岗位**（真 bug）：后端 AssigneeResolver.evalRule 的 POST 分支用 `postName`→按岗位名查岗位→展开该岗位任职用户（现在只遍历 refs 导致解析 0 人）。前端 POST 产出 postName 不变。
2. **start.scope 发起权限**（安全隐患）：后端 startable 只返回当前用户在 scope 内(用户/角色/部门/无限制)的流程；start 校验发起人是否在 scope。前端流程属性配 scope(OrgPicker)。
3. **flowConfig.operations 开关**（terminate/retrieve/urge/cancel）：后端读开关——详情 canCancel、可终止/收回/催办按流程定义的开关决定是否允许（关掉则该操作不可用）。
4. **emptyStrategy BLOCK**：后端真正阻塞（审批人为空时流程报错/挂起，而非静默转管理员）；与 TO_ADMIN 区分。
5. **allowedOps 服务端强制**：WfTaskService 的 approve/reject/transfer/addSign 等操作前校验该操作在节点 allowedOps 白名单内，不在则 403（不再仅驱动 UI）。

## 实施：前端 agent(删UI+序列化) + 后端 agent(删读取+修5项) 并行，契约对齐；完后 smoke + 全面检查。
