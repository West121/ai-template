# BPMN 设计器办理人模型对齐：统一到规范扩展格式

日期：2026-07-08
状态：设计已确认，待实施

## 背景与动机

办理人「类型 × 来源」二维重构（见 `2026-07-08-assignee-model-2d-design.md`）只覆盖了**仿钉钉设计器 + 共享面板 + 后端**。BPMN 设计器是独立的一套，未被触及，仍停留在旧的扁平 `OrgRef[]` 办理人，且用**不同的扩展格式**。由此暴露两个问题：

1. **格式不一致**：把仿钉钉转换来的 BPMN 定义在 BPMN 设计器里打开，校验报"未配置处理人"。
   - 转换器 / 后端运行时：把每项配置写成**独立元素** `oa:assigneeRules` / `oa:multiMode` / `oa:emptyStrategy` / … ，`assigneeRules` 为新二维 `[{kind,source,...}]`。
   - BPMN 设计器：把整个节点配置塞进**一个** `oa:NodeConfig` 元素的 JSON body，`assigneeRules` 为旧 `OrgRef[]`。
2. **隐藏大 bug（更严重）**：后端 `AssigneeResolver` 只按元素名读 `getExtensionElements().get("assigneeRules")`，**从不读 `oa:NodeConfig`**，发布时也无规范化。因此**在 BPMN 设计器里配的办理人运行时从未生效**（一直空 → emptyStrategy 兜底到 admin）。只有仿钉钉转换出的定义（写 `oa:assigneeRules`）才真能跑。

结论：本次不仅是给 BPMN 设计器加新模型，更要让 **BPMN 设计器产出的定义第一次真正可执行**，并使「两个设计器 + 转换器 + 运行时」四方同一种扩展格式、来回打开不丢。

## 目标

- BPMN 设计器办理人升级为共享二维 `AssigneeRule[]`（复用共享编辑器），与仿钉钉一致。
- BPMN 设计器读/写统一到**规范扩展格式**（独立 `oa:<name>` 元素 = 转换器/后端读的那套）。
- 向后兼容：能读旧 `oa:NodeConfig` 定义并迁移，不崩。
- BPMN 原生定义办理人运行时真解析（修复隐藏 bug）。

## 规范扩展格式（唯一契约，以转换器 `JsonToBpmnConverter` 为准）

UserTask 扩展（每项独立 `oa:<name>` 元素，body 为 JSON 或纯文本）：

| 元素 | 内容 | 备注 |
|---|---|---|
| `oa:assigneeRules` | `AssigneeRule[]` JSON | 二维模型 |
| `oa:multiMode` | 文本 `ANY/ALL/SEQUENCE/VOTE` | |
| `oa:emptyStrategy` | 文本 `AUTO_PASS/TO_ADMIN/BLOCK` | |
| `oa:voteConfig` | JSON | multiMode=VOTE |
| `oa:allowedOps` | JSON 字符串数组 | |
| `oa:handleOptions` | JSON | |
| `oa:auditMenu` | JSON `{allowJump,allowReturn}` | |
| `oa:timeout` | JSON | |
| `oa:formPerms` | JSON | |
| `oa:commentRequired` | JSON/文本 boolean | |
| `oa:events` | JSON | |

CC serviceTask：`oa:ccUsers`（JSON `OrgRef[]`）。
Process：`oa:flowConfig`（JSON）—— 注意元素名与转换器一致（`flowConfig`），修正 BPMN 设计器此前用 `oa:FlowConfig`（大小写/命名不一致导致同样不round-trip）。

## 设计

### 0. 枚举全对齐（关键，范围扩大点）
BPMN 设计器整套 NodeConfig 模型都与规范不一致，本次一并对齐到**共享/规范词汇**（后端运行时读的）：
- `assigneeRules`: `OrgRef[]` → 共享 `AssigneeRule[]`（`{kind,source,...}`）。
- `multiMode`: BPMN `and/or/sequence` → 共享 `MultiMode` `ANY/ALL/SEQUENCE/VOTE`（复用 `../../types` 的 `MultiMode` + `MULTI_MODE_META`）。
- `emptyStrategy`: BPMN `skip/admin/initiator/toManager` → 共享 `EmptyStrategy` `AUTO_PASS/TO_ADMIN/BLOCK`（复用 `EmptyStrategy` + `EMPTY_STRATEGY_META`）。
- 删除 BPMN 本地的 `MultiMode`/`EmptyStrategy`/`MULTI_MODES`/`EMPTY_STRATEGIES`/`ALLOWED_OPS`，改引共享 `../../types` + `../../shared/config`（与仿钉钉同源，避免第三套枚举）。
读旧定义时做值映射（`or→ANY`、`and→ALL`、`sequence→SEQUENCE`；`skip→AUTO_PASS`、`admin/toManager→TO_ADMIN`、`initiator→TO_ADMIN`），保证旧 BPMN 定义能打开。

### 1. moddle（`bpmn/oa/moddle.ts`）
- `NodeConfig` 的 `assigneeRules`/`multiMode`/`emptyStrategy` 全部改用共享类型（`import type { AssigneeRule, MultiMode, EmptyStrategy } from "../../types"`）。
- moddle 定义注册上述各 `oa:<name>` 元素（供 bpmn-js 解析/序列化），每个含 `value`(isBody) 文本；保留 `oa:NodeConfig`/`oa:FlowConfig` 定义仅用于**读旧定义**（兼容），新写不再用。

### 2. 序列化（`bpmn/oa/serde.ts`）
- `readNodeConfig(bo)`：
  1. 优先按独立元素读：`oa:assigneeRules`/`oa:multiMode`/… 各自解析，组装 `NodeConfig`。
  2. 若这些元素都不存在但有旧 `oa:NodeConfig`：解析其 body JSON；`assigneeRules` 若为旧 `OrgRef[]` 形状（元素含 `type`/`id`/`name`，无 `kind`），迁移为 `[{kind:"ACCOUNT",source:"FIXED",refs:<oldRefs>}]`（后端 `expandOrgRef` 按各 ref 自身 kind 展开，解析等价）。
- `writeNodeConfig(...)`：改为写**独立元素**（逐个 upsert `oa:assigneeRules` 等），删除旧的单块 `oa:NodeConfig` 写入。空值/默认值不写该元素（保持 XML 精简）。
- `readFlowConfig`/`writeFlowConfig`：元素名统一为 `oa:flowConfig`（读时兼容旧 `oa:FlowConfig`）。

### 3. 编辑器（`bpmn/editor.tsx`）
- 办理人 UI：删除现有简单 `OrgPicker`（`assigneeRules: OrgRef[]`），改为**复用共享 `AssigneeRulesEditor`**（`shared/property-panel.tsx` 导出），传入：
  - `rules`/`onChange`：读写 `config.assigneeRules`。
  - `fields`：BPMN 绑定表单字段（编辑器已有表单字段来源）。
  - `nodeOptions`：本图其它 userTask（从 bpmn-js `elementRegistry` 取 `bpmn:UserTask`，排除自身，`{id,name}`）。
  - `variableOptions`：`flowConfig.variables` 的名字。
- 多人模式/空值策略/抄送/按钮白名单等若已有 UI，保持；确保写入走新 serde。

### 4. 校验（`bpmn/oa/validate.ts`）
- 「审批节点必配处理人」判据：`config.assigneeRules.length === 0` 报错（形状已是新 rule，判空逻辑不变，但类型更新）。可选增强：VOTE 模式缺 voteConfig、FORM_FIELD 缺 field 等，按共享 `validate.ts` 已有校验对齐（不强制本次做）。

## 向后兼容

- 旧 `oa:NodeConfig` 定义：`readNodeConfig` 回退解析 + 迁移 `assigneeRules`，下次保存落成新格式。
- 由于「BPMN 原生定义办理人从未执行」，实际存量里几乎不存在有意义的 BPMN 办理人配置，迁移风险极低；重点是**不崩 + 能打开**。

## 测试

- 单测/构建：`tsc -b` + `pnpm build` 退出 0。
- smoke 新增：用 BPMN 定义（新格式 bpmnXml，或经本改造后 BPMN 设计器保存的等价 XML）发起实例，断言审批节点办理人**真解析到指定人**（非 admin 兜底）—— 证明"BPMN 原生定义现在可执行"。
- 回归：仿钉钉转换来的 `purchase_approval` 在 BPMN 设计器里**校验通过**、办理人正确回显；`leave_approval` 不受影响；后端 smoke 保持全绿。
- 浏览器：BPMN 设计器点审批节点 → 出现二维办理人编辑器（类型宫格+来源+公式弹窗）；`purchase_approval` 校验 0 错误。

## 影响文件

- 前端：`src/pages/workflow/designer/bpmn/oa/moddle.ts`、`bpmn/oa/serde.ts`、`bpmn/editor.tsx`、`bpmn/oa/validate.ts`（+ 复用 `shared/property-panel.tsx` 的 `AssigneeRulesEditor`）。
- 后端：无需改（运行时已读规范格式）；可选加一条 BPMN 办理人 smoke 用例（`server/smoke-test.mjs`）。
- 契约：`docs/flow-designer-v2.md` 补「BPMN 设计器与仿钉钉/转换器同一扩展格式」。

## 非目标（YAGNI）

- 不改后端运行时读取逻辑（已正确）。
- 不为旧 `oa:NodeConfig` 做数据库批量迁移（读时惰性迁移即可）。
- 不在本次扩展 BPMN 设计器的非办理人配置项（除随格式统一必要的读写调整）。
