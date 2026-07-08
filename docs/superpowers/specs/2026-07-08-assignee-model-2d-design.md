# 办理人模型重构：类型 × 来源 两维正交

日期：2026-07-08
状态：设计已确认，待落实施计划

## 背景与动机

现有"办理人"（审批人）模型是扁平的单维列表，把"实体类型"和"解析策略"混在一起：

- `AssigneeKind`：`ACCOUNT / ROLE / POST / DEPT / LEADER / FORM_FIELD / INITIATOR / FORMULA`
- `AssigneeSource`：`RELATED_TO_APPLICANT / SPECIFIED`（只对组织实体类型生效）

问题：`FORM_FIELD / FORMULA / LEADER / INITIATOR` 本质是"来源/解析策略"，却被当成"类型"，与 `ACCOUNT/ROLE/DEPT` 这些真·实体类型混列，概念不正交。参考炎黄盈动 AWS BPM 的做法（用户提供截图），应拆成两个正交维度：**类型（WHO，是哪一类组织对象）× 来源（HOW，运行时怎么把它解析出来）**。

用户明确约束：

1. 公式/表单/变量/跨节点办理人/与申请人相关 都是"来源"，不是"类型"。
2. 类型只保留我们自己的组织实体（账户/角色/岗位/部门），**不引入**单位/群组/服务API/共享任务/动态角色。
3. 保留"发起人主管"作为快捷类型（正交但常用，避免主管审批要多点两步）。
4. 跨节点来源"直取办理人本人"即可（可选叠加取其主管），不做"同组织位置相关"的复杂语义。
5. 计算公式用弹出 Modal 编辑（面板窄，低代码编辑器施展不开）。
6. 多规则并集保留（后端已对多条规则取并集去重）。
7. 向后兼容旧的扁平 designerJson，不强制迁移。

## 一、数据模型

### 类型（AssigneeKind，6 项）

| 类型 | 语义 | 备注 |
|---|---|---|
| `ACCOUNT` 账户 | 具体人员 | 动态来源都挂在这里 |
| `ROLE` 角色 | 角色 | 只做固定选 |
| `POST` 岗位 | 岗位 | 只做固定选 |
| `DEPT` 部门 | 部门 | 固定选 / 与申请人相关 |
| `LEADER` 发起人主管 | 快捷：申请人第 N 级主管 | 预置来源，无需选来源 |
| `INITIATOR` 发起人本人 | 快捷：申请人本人 | 预置来源，无需选来源 |

### 来源（AssigneeSource，解析策略）

| 来源 | 含义 | 后端实现 |
|---|---|---|
| `FIXED` 固定 | picker 直接选（按类型限定范围） | 现成 `expandOrgRef` |
| `FORM_FIELD` 来自表单 | 表单选人/选组织字段 | 现成 读 execution 变量 |
| `VARIABLE` 来自变量 | 流程变量（前置服务/脚本算出） | 读变量，与表单同路径 |
| `FORMULA` 来自公式 | 低代码公式 | 现成 `FormulaEvaluator` |
| `APPLICANT` 与申请人相关 | 申请人所在部门 | 现成 `resolveApplicantSource` |
| `PREV_HANDLER` 与上个办理人相关 | 上个节点 assignee（可选取其主管） | 新增 `HistoryService` 查询 |
| `NODE_HANDLER` 与指定节点办理人相关 | 选定节点 assignee（可选取其主管） | 新增 `HistoryService` 查询 |

### 来源矩阵（哪个类型挂哪些来源）

| 类型 | 可选来源 |
|---|---|
| 账户 | 固定 · 来自表单 · 来自变量 · 来自公式 · 与上个办理人 · 与指定节点办理人 |
| 角色 | 固定 |
| 岗位 | 固定 |
| 部门 | 固定 · 与申请人相关（申请人所在部门） |
| 发起人主管 | （快捷：第 N 级主管，无来源选择） |
| 发起人本人 | （快捷：无来源选择） |

取舍：账户是"人"，动态来源全挂账户下；角色/岗位只做"固定选"（要动态角色用「账户+公式」的 `ROLE()` 函数，不重复造）；"与申请人相关"只留在部门下（本人/主管已被两个快捷类型覆盖，不重复）。

### AssigneeRule 结构

```ts
interface AssigneeRule {
  kind: AssigneeKind          // 类型
  source: AssigneeSource      // 来源（LEADER/INITIATOR 快捷类型隐含，可省略）
  // 来源专属字段：
  refs?: OrgRef[]             // FIXED（账户/角色/部门）：按 kind 限定 picker 范围
  postName?: string          // FIXED（岗位）：岗位名/编码，逗号分隔多个
  field?: string             // FORM_FIELD：选人字段 key
  varName?: string           // VARIABLE：流程变量名（从 flowConfig.variables 选）
  formula?: string           // FORMULA：公式表达式
  applicantValue?: "DEPT"    // APPLICANT：目前仅"申请人所在部门"
  fromNodeId?: string        // NODE_HANDLER：目标节点 id
  takeLeader?: boolean       // PREV_HANDLER/NODE_HANDLER：取其直属主管
  level?: number             // LEADER：第 N 级主管
}
```

## 二、UI / 交互

布局参考炎黄盈动：类型宫格单选 + 上下文来源区。

1. **类型宫格**：6 项 2 列单选宫格，替代现在的下拉。
2. **来源下拉**：按所选类型动态变化，只列该类型合法来源（矩阵）。角色/岗位只有"固定"时，下拉退化/隐藏。
3. **来源专属配置区**（随来源切换）：
   - 固定 → `OrgPickerField`（复用 `types` 范围限制：账户只选成员、角色只选角色…）
   - 来自表单 → 选人字段下拉
   - 来自变量 → 从 `flowConfig.variables` 已声明变量里选（非裸输入）
   - 来自公式 → 紧凑预览 + `编辑公式`按钮 → 弹出 Modal（全功能 `FormulaEditor`）
   - 与申请人相关 → 子值（部门：申请人所在部门）
   - 与上个办理人 / 与指定节点办理人 → `取其直属主管`开关；指定节点再加"选节点"下拉（本流程已有节点）
   - 发起人主管 → 第 N 级输入；发起人本人 → 一句说明
4. **多规则并集**保留，"添加办理人规则"不变；面板顶部提示"多条规则取并集去重"。

## 三、后端解析

`AssigneeResolver.evalRule` 从"类型优先"改为"**来源优先**"分发：

- 先看 `source` 分发；`kind` 在"固定"时决定 `expandOrgRef` 展开方式，在跨节点时决定要不要取主管。
- 新增来源：
  - `VARIABLE` → `execution.getVariable(varName)` → `parseUserRefs`
  - `PREV_HANDLER` → 注入 `HistoryService`，查本实例最近一个已完成 userTask 的 assignee；`takeLeader` 时解析其部门主管
  - `NODE_HANDLER` → 按 `taskDefinitionKey=fromNodeId` + procInstId 查历史任务 assignee；同样支持 `takeLeader`
- `APPLICANT`（部门）→ 复用 `resolveApplicantSource(APPLICANT_DEPT)`
- 离线预测 `resolveOffline`：跨节点来源无历史可查 → 返回空（预测面板标注"运行时确定"），非空壳。

## 四、向后兼容（不强制迁移）

- 后端 `evalRule` 同时认新旧两种形状：新 `source` 优先分发；老 `type=LEADER/INITIATOR/FORM_FIELD/FORMULA/ACCOUNT/ROLE/POST/DEPT` 与老 `source=RELATED_TO_APPLICANT+sourceValue` 继续解析。已发布老定义不重存也能跑。
- 前端 `deserializeDingtalk` 把老扁平映射到新 `{kind, source}`，下次保存落成新形状。映射：

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

## 五、测试

- smoke 加一条定义，逐一验证新来源端到端（变量 / 上个办理人 / 指定节点办理人）解析出的人正确。
- 回归：种子 `leave_approval`（老 `LEADER`/`ORG` 形状）仍正常解析、画布回显正常。
- `tsc -b` 退出 0 + `pnpm build` 通过。

## 影响文件

- 前端：`src/pages/workflow/designer/types.ts`（类型/来源/规则结构）、`shared/config.ts`（元数据 + 来源矩阵）、`shared/property-panel.tsx`（AssigneeRulesEditor 重写 + 公式 Modal）、`dingtalk/serialize.ts`（新形状 + legacy 映射）、`shared/formula-editor.tsx`（套 Modal）
- 后端：`AssigneeResolver.java`（来源优先 evalRule + 三个新来源 + 注入 HistoryService）
- 契约：`docs/flow-designer-v2.md`

## 非目标（YAGNI）

- 不引入 单位 / 群组 / 服务API / 共享任务 / 动态角色岗位。
- 跨节点不做"同组织位置相关"（同角色/同岗位其他人）。
- 不做全 72 格类型×来源矩阵，只做上面精简矩阵。
- 不强制迁移历史 designerJson。
