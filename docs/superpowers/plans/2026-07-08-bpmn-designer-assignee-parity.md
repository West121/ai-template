# BPMN 设计器办理人模型对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 BPMN 设计器的节点配置（办理人/多人模式/空值策略）全对齐到共享二维模型 + 规范扩展格式（独立 `oa:<name>` 元素，与 `JsonToBpmnConverter` / 后端 `AssigneeResolver` 一致），使 BPMN 原生定义**首次真正可执行**并与仿钉钉一致。

**Architecture:** BPMN 设计器 `NodeConfig` 的 `assigneeRules/multiMode/emptyStrategy` 改用共享类型（`../../types`）；`serde` 读/写从单块 `oa:NodeConfig` JSON 改为**逐个 `oa:<name>` 独立元素**（读时回退旧 `oa:NodeConfig` 并做值映射迁移）；`editor` 办理人 UI 复用共享 `AssigneeRulesEditor`；moddle 注册各 `oa:<name>` 类型。后端不改（已读规范格式）。

**Tech Stack:** React 19 + TS strict + bpmn-js（moddle 扩展）；共享 `shared/property-panel.tsx` 的 `AssigneeRulesEditor`；smoke-test.mjs 端到端。

## Global Constraints

- TS strict：`verbatimModuleSyntax`（类型导入用 `import type`）、`noUnusedLocals`、`erasableSyntaxOnly`。
- **规范词汇（后端读的，唯一真源）**：`multiMode ∈ {ANY,ALL,SEQUENCE,VOTE}`；`emptyStrategy ∈ {AUTO_PASS,TO_ADMIN,BLOCK}`；`assigneeRules: AssigneeRule[]`（`{kind,source,...}`）。禁止再用 BPMN 本地的 `and/or/sequence`、`skip/admin/initiator/toManager`、`OrgRef[]` 办理人。
- **规范扩展元素名**（与转换器一致，逐个独立元素，body 为 JSON 或纯文本）：`oa:assigneeRules`(JSON) `oa:multiMode`(text) `oa:emptyStrategy`(text) `oa:voteConfig`(JSON) `oa:allowedOps`(JSON) `oa:handleOptions`(JSON) `oa:auditMenu`(JSON) `oa:timeout`(JSON) `oa:formPerms`(JSON) `oa:commentRequired`(text/JSON) `oa:events`(JSON)；CC 节点 `oa:ccUsers`(JSON)；Process `oa:flowConfig`(JSON)。
- 向后兼容：读旧 `oa:NodeConfig`/`oa:FlowConfig` 单块 JSON 并迁移（值映射见下），不崩、能打开；下次保存落成新格式。
- 旧值映射：`or→ANY, and→ALL, sequence→SEQUENCE`；`skip→AUTO_PASS, admin→TO_ADMIN, toManager→TO_ADMIN, initiator→TO_ADMIN`；旧 `assigneeRules: OrgRef[]` → `[{kind:"ACCOUNT",source:"FIXED",refs:<oldRefs>}]`（后端 `expandOrgRef` 按各 ref 自身 kind 展开，解析等价）。
- 后端运行时**不改**；只前端 + 可选 smoke 用例。
- git 已初始化（分支 `main`）；每任务提交，提交信息 body 结尾必须是：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: BPMN 设计器前端全对齐（moddle + serde + editor + validate）

`NodeConfig` 类型变更同时波及四个文件，必须同批落地才能过 tsc，故合为一个任务，末尾 tsc+build+浏览器一次性转绿。

**Files:**
- Modify: `src/pages/workflow/designer/bpmn/oa/moddle.ts`
- Modify: `src/pages/workflow/designer/bpmn/oa/serde.ts`
- Modify: `src/pages/workflow/designer/bpmn/editor.tsx`
- Modify: `src/pages/workflow/designer/bpmn/oa/validate.ts`

**Interfaces:**
- Consumes（共享）：`AssigneeRule, MultiMode, EmptyStrategy, MULTI_MODE_META, EMPTY_STRATEGY_META`（`../../types`）；`AssigneeRulesEditor`（`../../shared/property-panel`，签名 `{ rules, onChange, fields, nodeOptions, variableOptions }`）；`FormFieldOption`（`../../shared/config`）。
- Produces（后端契约，已被运行时消费）：UserTask 扩展逐个 `oa:<name>` 元素，`oa:assigneeRules` body 为 `AssigneeRule[]` JSON、`oa:multiMode`/`oa:emptyStrategy` body 为规范文本。

- [ ] **Step 1: moddle.ts —— 类型换共享 + 注册各 oa 元素 + 默认值**

改 `NodeConfig`：`assigneeRules: OrgRef[]` → `AssigneeRule[]`；`multiMode: MultiMode`（共享）；`emptyStrategy: EmptyStrategy`（共享）。删除本地 `type MultiMode`、`type EmptyStrategy`、`MULTI_MODES`、`EMPTY_STRATEGIES`（editor 改引共享 `MULTI_MODE_META`/`EMPTY_STRATEGY_META`）。`ALLOWED_OPS` 可保留（BPMN 本地展示用，值与共享 AllowedOp 对齐即可）或改引共享，二选一并保证 tsc。导入：

```ts
import type { AssigneeRule, AuditMenu, EmptyStrategy, FormPerms, HandleOptions, MultiMode, NodeEvent, NodeTimeout, VoteConfig } from "../../types"
```

`NodeConfig` 增补 `voteConfig?: VoteConfig`（与规范一致）。`defaultNodeConfig()` 改为 `multiMode: "ANY"`、`emptyStrategy: "TO_ADMIN"`、`assigneeRules: []`。

moddle `types` 数组：**新增**下列各类型（供 bpmn-js 解析/序列化独立元素），每个仅一个 body value；tagAlias `lowerCase` 使类型名首字母小写成标签（`AssigneeRules`→`oa:assigneeRules`，与转换器一致）：

```ts
const bodyType = (name: string) => ({ name, superClass: ["Element"], properties: [{ name: "value", type: "String", isBody: true }] })
// types: [ ...保留 NodeConfig/FlowConfig（仅读旧用）, bodyType("AssigneeRules"), bodyType("MultiMode"),
//   bodyType("EmptyStrategy"), bodyType("VoteConfig"), bodyType("AllowedOps"), bodyType("HandleOptions"),
//   bodyType("AuditMenu"), bodyType("Timeout"), bodyType("FormPerms"), bodyType("CommentRequired"),
//   bodyType("Events"), bodyType("CcUsers"), bodyType("FlowConfig") ]
```

（`oaModdleDescriptor` 是 `as const`；把 types 改为普通数组构造再 `as const`，或直接展开写全，保证 bpmnFactory 能 create 这些类型。）

- [ ] **Step 2: 验证 moddle 单文件类型**

Run: `cd /Users/west/dev/code/claude-code/ai-template && npx tsc -b`
Expected: 仅 serde/editor/validate 因 NodeConfig 变更报错（moddle 本身无错）。本步只确认 moddle 内部一致。

- [ ] **Step 3: serde.ts —— 逐元素读写 + 旧格式回退迁移**

新增元素名常量与读写工具。`readNodeConfig`：优先逐个独立元素读，缺失才回退旧 `oa:NodeConfig`：

```ts
const NODE_ELEMS = { assigneeRules:"oa:AssigneeRules", multiMode:"oa:MultiMode", emptyStrategy:"oa:EmptyStrategy",
  voteConfig:"oa:VoteConfig", allowedOps:"oa:AllowedOps", handleOptions:"oa:HandleOptions", auditMenu:"oa:AuditMenu",
  timeout:"oa:Timeout", formPerms:"oa:FormPerms", commentRequired:"oa:CommentRequired", events:"oa:Events", ccUsers:"oa:CcUsers" } as const

const bodyOf = (bo: BusinessObjectLike, type: string): string | undefined => findOaElement(bo, type)?.value
const jsonOf = <T,>(bo: BusinessObjectLike, type: string): T | undefined => { const v = bodyOf(bo, type); if (v==null) return undefined; try { return JSON.parse(v) as T } catch { return undefined } }

export function readNodeConfig(bo: BusinessObjectLike | undefined): NodeConfig {
  const base = defaultNodeConfig()
  if (!bo) return base
  const hasNew = !!findOaElement(bo, NODE_ELEMS.assigneeRules) || !!findOaElement(bo, NODE_ELEMS.multiMode)
  if (hasNew) {
    return {
      ...base,
      assigneeRules: jsonOf<AssigneeRule[]>(bo, NODE_ELEMS.assigneeRules) ?? [],
      multiMode: (bodyOf(bo, NODE_ELEMS.multiMode) as MultiMode) ?? base.multiMode,
      emptyStrategy: (bodyOf(bo, NODE_ELEMS.emptyStrategy) as EmptyStrategy) ?? base.emptyStrategy,
      voteConfig: jsonOf(bo, NODE_ELEMS.voteConfig),
      ccUsers: jsonOf<OrgRef[]>(bo, NODE_ELEMS.ccUsers) ?? [],
      allowedOps: jsonOf<string[]>(bo, NODE_ELEMS.allowedOps) ?? base.allowedOps,
      handleOptions: { ...base.handleOptions, ...jsonOf(bo, NODE_ELEMS.handleOptions) },
      auditMenu: jsonOf(bo, NODE_ELEMS.auditMenu),
      timeout: jsonOf(bo, NODE_ELEMS.timeout),
      formPerms: jsonOf(bo, NODE_ELEMS.formPerms),
      commentRequired: jsonOf<boolean>(bo, NODE_ELEMS.commentRequired),
      events: jsonOf(bo, NODE_ELEMS.events),
    }
  }
  // 回退：旧 oa:NodeConfig 单块 JSON + 值映射迁移
  const el = findOaElement(bo, "oa:NodeConfig")
  if (!el?.value) return base
  try { return migrateLegacyNode(JSON.parse(el.value), base) } catch { return base }
}
```

新增迁移函数（旧枚举/旧 OrgRef 办理人 → 新）：

```ts
const MULTI_MAP: Record<string, MultiMode> = { or:"ANY", and:"ALL", sequence:"SEQUENCE", ANY:"ANY", ALL:"ALL", SEQUENCE:"SEQUENCE", VOTE:"VOTE" }
const EMPTY_MAP: Record<string, EmptyStrategy> = { skip:"AUTO_PASS", admin:"TO_ADMIN", toManager:"TO_ADMIN", initiator:"TO_ADMIN", AUTO_PASS:"AUTO_PASS", TO_ADMIN:"TO_ADMIN", BLOCK:"BLOCK" }

function migrateLegacyNode(parsed: Record<string, unknown>, base: NodeConfig): NodeConfig {
  const rawRules = Array.isArray(parsed.assigneeRules) ? (parsed.assigneeRules as unknown[]) : []
  // 旧 OrgRef[]（元素有 type/id 无 kind）→ 单条 ACCOUNT+FIXED 规则
  const isLegacyRefs = rawRules.length > 0 && rawRules.every((r) => r && typeof r === "object" && "type" in (r as object) && !("kind" in (r as object)))
  const assigneeRules: AssigneeRule[] = isLegacyRefs ? [{ kind: "ACCOUNT", source: "FIXED", refs: rawRules as OrgRef[] }] : (rawRules as AssigneeRule[])
  return {
    ...base, ...parsed,
    assigneeRules,
    multiMode: MULTI_MAP[String(parsed.multiMode)] ?? base.multiMode,
    emptyStrategy: EMPTY_MAP[String(parsed.emptyStrategy)] ?? base.emptyStrategy,
    handleOptions: { ...base.handleOptions, ...(parsed.handleOptions as object) },
  } as NodeConfig
}
```

`writeNodeConfig`：改为逐元素写（先删旧 `oa:NodeConfig`，再对每个非空字段 upsert 独立元素）。扩展 `upsertExtension` 为可一次替换多个类型，或循环调用。示意：

```ts
export function writeNodeConfig(modeling, bpmnFactory, element, config: NodeConfig): void {
  const put = (type: string, body: string | undefined) => upsertOne(modeling, bpmnFactory, element, type, body)
  put(NODE_ELEMS.assigneeRules, JSON.stringify(config.assigneeRules))
  put(NODE_ELEMS.multiMode, config.multiMode)
  put(NODE_ELEMS.emptyStrategy, config.emptyStrategy)
  put(NODE_ELEMS.voteConfig, config.voteConfig ? JSON.stringify(config.voteConfig) : undefined)
  put(NODE_ELEMS.allowedOps, JSON.stringify(config.allowedOps))
  put(NODE_ELEMS.handleOptions, JSON.stringify(config.handleOptions))
  put(NODE_ELEMS.ccUsers, JSON.stringify(config.ccUsers))
  put(NODE_ELEMS.auditMenu, config.auditMenu ? JSON.stringify(config.auditMenu) : undefined)
  put(NODE_ELEMS.timeout, config.timeout ? JSON.stringify(config.timeout) : undefined)
  put(NODE_ELEMS.formPerms, config.formPerms ? JSON.stringify(config.formPerms) : undefined)
  put(NODE_ELEMS.commentRequired, config.commentRequired != null ? String(config.commentRequired) : undefined)
  put(NODE_ELEMS.events, config.events ? JSON.stringify(config.events) : undefined)
  // 迁移：清掉旧单块元素
  removeExtension(modeling, bpmnFactory, element, "oa:NodeConfig")
}
```

`upsertOne`：`body===undefined` 时删除该类型元素；否则 `bpmnFactory.create(type, { value: body })` 并替换。一次 `updateProperties` 汇总所有变更（避免多次覆盖：建议先在内存里算出最终 `values` 数组再 `updateProperties` 一次；给出 `rebuildExtensions(existing, patches)` 辅助）。`readFlowConfig`/`writeFlowConfig` 元素名统一为 `oa:FlowConfig`（读时本已用该名，保持；如需与转换器 `oa:flowConfig` 一致，tagAlias 已 lowerCase，$type 仍 `oa:FlowConfig`，无需改）。导入补 `AssigneeRule, MultiMode, EmptyStrategy` 类型与 `OrgRef`。

- [ ] **Step 4: editor.tsx —— 办理人复用共享 AssigneeRulesEditor + 多人/空值改共享枚举**

处理人区块（约 308–340 行）：审批节点（`isApproval`）改用共享 `AssigneeRulesEditor`；抄送节点（`isCc`）保留 `OrgPicker`（抄送仍是 `OrgRef[]`）。

```tsx
import { AssigneeRulesEditor } from "../shared/property-panel"
import { MULTI_MODE_META, EMPTY_STRATEGY_META } from "../types"
// ...
{isApproval ? (
  <div className="space-y-1.5">
    <Label className="text-xs">处理人规则</Label>
    <AssigneeRulesEditor
      rules={config.assigneeRules}
      onChange={(assigneeRules) => write({ assigneeRules })}
      fields={formFields}          // 见下：BPMN 编辑器的表单字段来源
      nodeOptions={otherUserTasks} // 见下：本图其它 UserTask [{id,name}]
      variableOptions={(flowConfig?.variables ?? []).map((v) => v.name)}
    />
  </div>
) : (
  /* 抄送人 OrgPicker 保留原样 */
)}
```

`otherUserTasks`：从 bpmn-js `elementRegistry` 取所有 `bpmn:UserTask`（排除当前 element.id），映射 `{ id: el.id, name: el.businessObject.name || el.id }`。编辑器已能拿到 modeler/elementRegistry（grep `elementRegistry` / `useBpmn` 定位；若拿不到就通过 props 传入）。`formFields`：BPMN 编辑器绑定表单的字段（grep 现有 `formFields`/`FormFieldOption` 来源；若无则传 `[]` 并注释「BPMN 表单字段待接」）。`flowConfig`：`readFlowConfig(process.businessObject)` 或编辑器已有的流程配置。

多人模式 Select：`value={config.multiMode}`，选项改用 `Object.entries(MULTI_MODE_META).map(([v,m]) => ({value:v,label:m.label}))`；`onValueChange={(v)=>write({multiMode:v as MultiMode})}`。空值策略同理用 `EMPTY_STRATEGY_META`。删除对本地 `MULTI_MODES`/`EMPTY_STRATEGIES` 的引用。

- [ ] **Step 5: validate.ts —— 按新形状判空**

`readNodeConfig` 返回的 `assigneeRules` 现为 `AssigneeRule[]`；`审批节点必配处理人` 判据保持 `cfg.assigneeRules.length === 0`（类型已更新，逻辑不变）。确认 validate.ts 无对旧 `multiMode`/`emptyStrategy` 字面量的比较；有则更新为规范值。

- [ ] **Step 6: tsc + build**

Run: `cd /Users/west/dev/code/claude-code/ai-template && npx tsc -b && pnpm build`
Expected: 均退出 0；清理所有未用导入（旧 MULTI_MODES 等）。

- [ ] **Step 7: 浏览器验证（控制器在评审时做，实现者可跳过）**

（控制器负责）BPMN 设计器打开 `purchase_approval`：点审批节点 → 出现**二维办理人编辑器**（类型宫格+来源+公式弹窗），办理人正确回显（部门经理审批=发起人主管等）；点「校验」→ **0 错误**（不再"未配置处理人"）。新建一个 BPMN 定义配办理人保存 → XML 里是 `oa:assigneeRules` 等独立元素。

- [ ] **Step 8: Commit**

```bash
cd /Users/west/dev/code/claude-code/ai-template
git add -A && git commit -m "$(printf 'feat(bpmn-designer): 办理人/多人/空值全对齐共享二维模型 + 规范扩展格式\n\nBPMN 设计器 NodeConfig 改用共享 AssigneeRule[]/MultiMode/EmptyStrategy，读写从单块\noa:NodeConfig 改为逐个 oa:<name> 独立元素（与转换器/后端一致），复用共享\nAssigneeRulesEditor；读旧 oa:NodeConfig 做值映射迁移。修复 BPMN 原生定义办理人\n运行时从不生效的隐藏 bug。\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: smoke 验证 BPMN 定义可执行 + 契约 + 回归

**Files:**
- Modify: `server/smoke-test.mjs`
- Modify: `docs/flow-designer-v2.md`

**Interfaces:**
- Consumes：Task 1 产出的 BPMN 扩展格式（`oa:assigneeRules` 等）。

- [ ] **Step 1: smoke —— BPMN 定义办理人真解析用例**

在 smoke 末尾新增块：构造一个 **designerType:BPMN** 定义（bpmnXml 手写或复用一段含 `oa:assigneeRules`[{kind:"ACCOUNT",source:"FIXED",refs:[{kind:"USER",id:5}]}] 的 userTask + multiInstance collection `${wfAssigneeResolver.resolve(execution,'节点id')}`），发布→发起→断言该审批节点办理人集合含 userId 5（**非 admin 兜底**）。若手写 bpmnXml 成本高，可复用「钉钉建 DINGTALK→取转换后的 bpmnXml→改 designerType:BPMN 创建」的方式（见 scratchpad/create-purchase.mjs 思路）拿到合法 bpmnXml。断言用文件内既有 helper + `check()`。用例 def_code 加 TS 后缀走既有自动清理（`KEEP_DEF_CODES` 不含它）。

关键断言：

```js
assert(
  detail.currentNodes.some((n) => n.assignees.some((a) => String(a.userId) === "5")),
  "BPMN 定义 oa:assigneeRules 应被运行时解析（非 admin 兜底）",
)
```

- [ ] **Step 2: 跑 smoke 全量**

Run: `cd /Users/west/dev/code/claude-code/ai-template/server && node smoke-test.mjs 2>&1 | tail -5`
Expected: 全部通过（370 + 新增），失败 0；末尾"测试数据已清理（保留：leave_approval, purchase_approval）"。

- [ ] **Step 3: 契约文档**

`docs/flow-designer-v2.md` 补一节：「BPMN 设计器与仿钉钉/转换器同一扩展格式」——列规范 `oa:<name>` 元素、办理人为共享 `AssigneeRule[]`、multiMode/emptyStrategy 规范词汇，并注明「BPMN 原生定义现可执行」。

- [ ] **Step 4: Commit**

```bash
cd /Users/west/dev/code/claude-code/ai-template
git add -A && git commit -m "$(printf 'test(smoke): BPMN 定义办理人真解析用例 + 契约同步\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec 覆盖**：枚举全对齐(Task1 S1/S3/S4)、moddle 各元素(S1)、serde 逐元素读写+旧回退迁移(S3)、editor 复用共享编辑器+共享枚举(S4)、validate(S5)、smoke 可执行验证(Task2 S1)、契约(Task2 S3)、向后兼容(S3 migrateLegacyNode) —— 均有任务。

**Placeholder 扫描**：关键代码（moddle bodyType、serde read/migrate/write、editor 复用）给出具体代码；`formFields`/`nodeOptions`/`elementRegistry` 来源给了 grep 定位指引而非留空。无 TBD。

**类型一致**：`AssigneeRule/MultiMode/EmptyStrategy` 四文件同引 `../../types`；元素名常量 `NODE_ELEMS` 与 moddle 类型名（`oa:AssigneeRules` 等）、与转换器 XML 标签（`oa:assigneeRules`，tagAlias lowerCase）三者一致。
