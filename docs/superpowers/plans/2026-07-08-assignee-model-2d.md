# 办理人模型「类型 × 来源」两维正交 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扁平的办理人模型重构成「类型（账户/角色/岗位/部门/发起人主管/发起人本人）× 来源（固定/表单/变量/公式/与申请人相关/上个办理人/指定节点办理人）」两维正交模型，并向后兼容旧定义。

**Architecture:** 前端 `AssigneeRule` 改为 `{kind, source, ...}` 两维结构；`serialize.ts` 反序列化把旧扁平形状映射到新形状（旧定义不重存也能加载）；`property-panel` 编辑器改为「类型宫格 + 上下文来源下拉 + 各来源配置区 + 公式弹窗」；后端 `AssigneeResolver.evalRule` 改为「来源优先」分发，新增 VARIABLE/PREV_HANDLER/NODE_HANDLER 三个来源（注入 `HistoryService`），并保留对旧形状的解析。

**Tech Stack:** React 19 + TS strict + @xyflow/react + shadcn Modal；Spring Boot 4 + Flowable 8 + Jackson 3（tools.jackson）+ Java 21；smoke-test.mjs 端到端校验。

## Global Constraints

- TS strict：`verbatimModuleSyntax`（类型导入用 `import type`）、`noUnusedLocals`、`erasableSyntaxOnly`。
- 不引入 单位 / 群组 / 服务API / 共享任务 / 动态角色岗位（YAGNI）。
- 向后兼容旧扁平 designerJson，**不强制迁移**：后端 `evalRule` 同认新旧形状。
- 后端用 `tools.jackson` 的 `JsonNode`（非 fasterxml）；已注入的 bean 命名遵循现有 `wfAssigneeResolver`。
- git 未初始化（`git: false`）→ 文中"Checkpoint"为逻辑检查点，不执行 `git commit`。
- 跨节点来源"直取办理人本人"，`takeLeader=true` 时取其第 1 级部门主管；离线预测无历史 → 返回空（不是空壳）。

---

### Task 1: 前端两维模型 + 序列化兼容 + 编辑器重写

因 `AssigneeRule` 联合类型变更会同时波及 `types.ts / config.ts / serialize.ts / property-panel.tsx / formula-editor.tsx`，三者必须同批落地才能通过 tsc，故合为一个前端任务，末尾 tsc+build+浏览器一次性转绿。

**Files:**
- Modify: `src/pages/workflow/designer/types.ts`
- Modify: `src/pages/workflow/designer/shared/config.ts`
- Modify: `src/pages/workflow/designer/dingtalk/serialize.ts:271-322`
- Modify: `src/pages/workflow/designer/shared/property-panel.tsx:151-360`（AssigneeRulesEditor）
- Modify: `src/pages/workflow/designer/shared/formula-editor.tsx`（新增 Modal 包装导出）

**Interfaces:**
- Produces（后端契约，Task 2 依赖）：办理人规则 JSON `{ kind: "ACCOUNT"|"ROLE"|"POST"|"DEPT"|"LEADER"|"INITIATOR", source?: "FIXED"|"FORM_FIELD"|"VARIABLE"|"FORMULA"|"APPLICANT"|"PREV_HANDLER"|"NODE_HANDLER", refs?, postName?, field?, varName?, formula?, applicantValue?:"DEPT", fromNodeId?, takeLeader?, level? }`。

- [ ] **Step 1: 改 `types.ts` 的类型/来源联合与 AssigneeRule**

替换 `AssigneeKind` / `AssigneeSource` / `AssigneeSourceValue` / `AssigneeRule`（types.ts:71-109）为：

```ts
/** 类型（WHO，组织实体 + 两个快捷类型） */
export type AssigneeKind =
  | "ACCOUNT" // 账户（人员）
  | "ROLE" // 角色
  | "POST" // 岗位
  | "DEPT" // 部门
  | "LEADER" // 发起人主管（快捷：第 N 级）
  | "INITIATOR" // 发起人本人（快捷）

/** 来源（HOW，解析策略） */
export type AssigneeSource =
  | "FIXED" // 固定：picker/文本直接指定
  | "FORM_FIELD" // 来自表单字段
  | "VARIABLE" // 来自流程变量
  | "FORMULA" // 来自公式
  | "APPLICANT" // 与申请人相关（部门：申请人所在部门）
  | "PREV_HANDLER" // 与上个办理人相关
  | "NODE_HANDLER" // 与指定节点办理人相关

export interface AssigneeRule {
  kind: AssigneeKind
  /** 来源；LEADER/INITIATOR 快捷类型可省略（隐含） */
  source?: AssigneeSource
  /** FIXED（账户/角色/部门）：OrgPicker 选择 */
  refs?: OrgRef[]
  /** FIXED（岗位）：岗位名/编码，逗号分隔 */
  postName?: string
  /** FORM_FIELD：选人字段 key */
  field?: string
  /** VARIABLE：流程变量名 */
  varName?: string
  /** FORMULA：公式表达式 */
  formula?: string
  /** APPLICANT：目前仅 "DEPT"（申请人所在部门） */
  applicantValue?: "DEPT"
  /** NODE_HANDLER：目标节点 id */
  fromNodeId?: string
  /** PREV_HANDLER/NODE_HANDLER：取其直属主管 */
  takeLeader?: boolean
  /** LEADER：第 N 级主管 */
  level?: number
}

/** @deprecated 兼容别名 */
export type AssigneeRuleType = AssigneeKind
```

删除 `AssigneeSourceValue`（旧值 APPLICANT/APPLICANT_DEPT_LEADER/APPLICANT_DEPT 仅在 serialize 的 Backend 类型里保留用于反序列化映射，见 Step 3）。

- [ ] **Step 2: 改 `config.ts` 元数据 + 来源矩阵**

替换 `ASSIGNEE_KIND_META`（config.ts:147-156），删除 `ASSIGNEE_SOURCE_META`/`ASSIGNEE_SOURCE_VALUE_META`（158-167），新增来源元数据与矩阵：

```ts
export const ASSIGNEE_KIND_META: Record<AssigneeKind, { label: string }> = {
  ACCOUNT: { label: "账户" },
  ROLE: { label: "角色" },
  POST: { label: "岗位" },
  DEPT: { label: "部门" },
  LEADER: { label: "发起人主管" },
  INITIATOR: { label: "发起人本人" },
}

export const ASSIGNEE_SOURCE_META: Record<AssigneeSource, { label: string; hint?: string }> = {
  FIXED: { label: "固定指定" },
  FORM_FIELD: { label: "来自表单字段" },
  VARIABLE: { label: "来自流程变量" },
  FORMULA: { label: "来自公式" },
  APPLICANT: { label: "与申请人相关", hint: "申请人所在部门" },
  PREV_HANDLER: { label: "与上个办理人相关" },
  NODE_HANDLER: { label: "与指定节点办理人相关" },
}

/** 每种类型允许的来源（上下文下拉）；LEADER/INITIATOR 无来源选择 */
export const ASSIGNEE_SOURCE_MATRIX: Record<AssigneeKind, AssigneeSource[]> = {
  ACCOUNT: ["FIXED", "FORM_FIELD", "VARIABLE", "FORMULA", "PREV_HANDLER", "NODE_HANDLER"],
  ROLE: ["FIXED"],
  POST: ["FIXED"],
  DEPT: ["FIXED", "APPLICANT"],
  LEADER: [],
  INITIATOR: [],
}

/** 类型对应的固定选人范围（复用 OrgPicker types 限制；POST 走文本不在此列） */
export const ASSIGNEE_FIXED_REF_TYPES: Partial<Record<AssigneeKind, OrgRefType[]>> = {
  ACCOUNT: ["USER"],
  ROLE: ["ROLE"],
  DEPT: ["DEPT"],
}
```

在 config.ts 顶部确保 `import type { OrgRef, OrgRefType } from "@/components/org-picker"`（若只导入了 OrgRef 则补 OrgRefType）。

- [ ] **Step 3: 改 `serialize.ts` 的规则映射 + 旧形状兼容**

`ruleToBackend`（serialize.ts:273-283）改为透传新字段：

```ts
function ruleToBackend(rule: AssigneeRule): BackendAssigneeRule {
  const out: BackendAssigneeRule = { kind: rule.kind }
  if (rule.source) out.source = rule.source
  if (rule.refs && rule.refs.length) out.refs = rule.refs.map(orgRefToBackend)
  if (rule.postName) out.postName = rule.postName
  if (rule.field) out.field = rule.field
  if (rule.varName) out.varName = rule.varName
  if (rule.formula) out.formula = rule.formula
  if (rule.applicantValue) out.applicantValue = rule.applicantValue
  if (rule.fromNodeId) out.fromNodeId = rule.fromNodeId
  if (rule.takeLeader) out.takeLeader = rule.takeLeader
  if (typeof rule.level === "number") out.level = rule.level
  return out
}
```

`ruleFromBackend`（310-322）改为「先归一化 kind，再把旧扁平映射成新 {kind,source}」。替换整个函数与 `normalizeKind`：

```ts
/** 旧扁平 → 新 {kind, source, ...}（反序列化兼容；旧 designerJson 不重存也能加载） */
function ruleFromBackend(rule: BackendAssigneeRule): AssigneeRule {
  // 1) 旧 source=RELATED_TO_APPLICANT + sourceValue → 新形状
  if (rule.source === "RELATED_TO_APPLICANT") {
    switch (rule.sourceValue) {
      case "APPLICANT_DEPT":
        return { kind: "DEPT", source: "APPLICANT", applicantValue: "DEPT" }
      case "APPLICANT_DEPT_LEADER":
        return { kind: "LEADER", level: 1 }
      default:
        return { kind: "INITIATOR" }
    }
  }
  // 2) 归一化 kind（含旧 type 判别 + 废弃 kind）
  const kind = normalizeKind(rule)
  // 3) 旧"来源型类型"（FORM_FIELD/FORMULA）折叠到 账户+来源
  if (rule.kind === "FORM_FIELD" || rule.type === "FORM_FIELD") {
    return { kind: "ACCOUNT", source: "FORM_FIELD", field: rule.field }
  }
  if (rule.kind === "FORMULA" || rule.type === "FORMULA") {
    return { kind: "ACCOUNT", source: "FORMULA", formula: rule.formula }
  }
  // 4) 新形状 or 旧组织实体（ORG/ACCOUNT/ROLE/POST/DEPT/LEADER/INITIATOR）
  const out: AssigneeRule = { kind }
  out.source = rule.source ?? defaultSourceForKind(kind)
  if (rule.refs) out.refs = rule.refs.map(backendToOrgRef)
  if (rule.postName) out.postName = rule.postName
  if (rule.field) out.field = rule.field
  if (rule.varName) out.varName = rule.varName
  if (rule.formula) out.formula = rule.formula
  if (rule.applicantValue) out.applicantValue = rule.applicantValue
  if (rule.fromNodeId) out.fromNodeId = rule.fromNodeId
  if (rule.takeLeader) out.takeLeader = rule.takeLeader
  if (typeof rule.level === "number") out.level = rule.level
  else if (kind === "LEADER") out.level = 1
  return out
}

/** 组织实体类型的默认来源：可选人的走 FIXED，快捷类型无来源 */
function defaultSourceForKind(kind: AssigneeKind): AssigneeSource | undefined {
  if (kind === "LEADER" || kind === "INITIATOR") return undefined
  return "FIXED"
}
```

`normalizeKind`（302-308）保持不变（`LEGACY_TYPE_TO_KIND`/`LEGACY_KIND_TO_KIND` 已有）。同时在 `BackendAssigneeRule` 类型（serialize.ts 上方 Backend* 定义处）补上新字段：`source?: string; sourceValue?: string; varName?: string; applicantValue?: string; fromNodeId?: string; takeLeader?: boolean`（保留旧 `type?`/`sourceValue?` 供读取）。

- [ ] **Step 4: 序列化往返自检（纯函数，node 脚本）**

写临时脚本 `scratchpad/rt.mjs` 验证旧形状能映射成新形状（用 tsx 跑或直接内联判断逻辑）。因 serialize.ts 依赖别名 `@/`，改为在浏览器 Task 末尾验证；此步仅做**类型层**自检：

Run: `cd /Users/west/dev/code/claude-code/ai-template && npx tsc -b`
Expected: 因 property-panel 尚未改完可能报错——本步只确认 types.ts/config.ts/serialize.ts 三文件内部无类型错误（错误应仅来自 property-panel.tsx 对旧 API 的引用）。

- [ ] **Step 5: `formula-editor.tsx` 新增 Modal 包装 `FormulaField`**

在 formula-editor.tsx 末尾追加一个字段级包装：面板放紧凑预览 + 按钮，点开弹 Modal 编辑（复用现有 `FormulaEditor`）。

```tsx
import { Modal } from "@/components/ui/modal" // 若项目 Modal 路径不同，按 org-picker.tsx 里的同款导入
import { Button } from "@/components/ui/button"
import { useState } from "react"

/** 面板内公式字段：紧凑预览 + 「编辑公式」按钮 → 弹窗全功能编辑 */
export function FormulaField({
  value,
  onChange,
  fields,
}: {
  value: string
  onChange: (formula: string) => void
  fields: FormFieldOption[]
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  return (
    <div className="space-y-1.5">
      <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs font-mono break-all min-h-8">
        {value || <span className="text-muted-foreground">未配置公式</span>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          setDraft(value)
          setOpen(true)
        }}
      >
        编辑公式
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="编辑办理人公式"
        width={760}
        height={560}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="p-3">
          <FormulaEditor value={draft} onChange={setDraft} fields={fields} />
        </div>
      </Modal>
    </div>
  )
}
```

先确认 Modal 的导入路径与 props：`grep -n "import.*Modal" src/components/org-picker.tsx` 取同款签名（org-picker 已用 Modal，含 open/onOpenChange/title/width/height/footer）。

- [ ] **Step 6: 重写 `property-panel.tsx` 的 AssigneeRulesEditor（类型宫格 + 上下文来源 + 配置区）**

替换 property-panel.tsx:151-360 的 `kindHasRefs`/`kindHasSource`/`kindRefTypes`/`AssigneeRulesEditor` 为下面结构。导入更新：从 config 引入 `ASSIGNEE_KIND_META, ASSIGNEE_SOURCE_META, ASSIGNEE_SOURCE_MATRIX, ASSIGNEE_FIXED_REF_TYPES`；从 formula-editor 改引 `FormulaField`（替换 `FormulaEditor`）。

```tsx
const isQuickKind = (k: AssigneeKind) => k === "LEADER" || k === "INITIATOR"

export function AssigneeRulesEditor({
  rules,
  onChange,
  fields,
  nodeOptions,
  variableOptions,
}: {
  rules: AssigneeRule[]
  onChange: (rules: AssigneeRule[]) => void
  fields: FormFieldOption[]
  /** 本流程其它节点（供"指定节点办理人"选择），由 property-panel 上层传入 [{id,name}] */
  nodeOptions: { id: string; name: string }[]
  /** 已声明流程变量名（供"来自变量"选择） */
  variableOptions: string[]
}) {
  const [orgPickerIndex, setOrgPickerIndex] = useState<number | null>(null)
  const userFields = fields.filter((f) => f.isUser)

  const addRule = () => onChange([...rules, { kind: "ACCOUNT", source: "FIXED", refs: [] }])
  const updateRule = (i: number, r: AssigneeRule) => onChange(rules.map((x, k) => (k === i ? r : x)))
  const removeRule = (i: number) => onChange(rules.filter((_, k) => k !== i))

  const changeKind = (i: number, kind: AssigneeKind) => {
    if (kind === "LEADER") return updateRule(i, { kind, level: 1 })
    if (kind === "INITIATOR") return updateRule(i, { kind })
    const source = ASSIGNEE_SOURCE_MATRIX[kind][0] // 默认第一个合法来源
    updateRule(i, { kind, source, ...(source === "FIXED" ? { refs: [] } : {}) })
  }

  const changeSource = (i: number, rule: AssigneeRule, source: AssigneeSource) => {
    const next: AssigneeRule = { kind: rule.kind, source }
    if (source === "FIXED") next.refs = []
    if (source === "FORM_FIELD") next.field = userFields[0]?.key ?? ""
    if (source === "VARIABLE") next.varName = variableOptions[0] ?? ""
    if (source === "FORMULA") next.formula = ""
    if (source === "APPLICANT") next.applicantValue = "DEPT"
    if (source === "NODE_HANDLER") next.fromNodeId = nodeOptions[0]?.id ?? ""
    updateRule(i, next)
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">多条规则取并集去重：最终办理人 = 各规则解析结果之和。</p>
      {rules.length === 0 && (
        <p className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
          尚未配置办理人规则，请从下方添加
        </p>
      )}

      {rules.map((rule, index) => (
        <div key={index} className="space-y-2 rounded-md border p-2.5">
          {/* 删除 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">规则 {index + 1}</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-rose-500"
              onClick={() => removeRule(index)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          {/* 类型宫格（2 列单选） */}
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(ASSIGNEE_KIND_META) as AssigneeKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => changeKind(index, k)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs transition-colors",
                  rule.kind === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted",
                )}
              >
                {ASSIGNEE_KIND_META[k].label}
              </button>
            ))}
          </div>

          {/* 来源下拉（快捷类型不显示） */}
          {!isQuickKind(rule.kind) && ASSIGNEE_SOURCE_MATRIX[rule.kind].length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">来源</span>
              <Select
                value={rule.source ?? ASSIGNEE_SOURCE_MATRIX[rule.kind][0]}
                onValueChange={(v) => changeSource(index, rule, v as AssigneeSource)}
              >
                <SelectTrigger size="sm" className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNEE_SOURCE_MATRIX[rule.kind].map((s) => (
                    <SelectItem key={s} value={s}>
                      {ASSIGNEE_SOURCE_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 来源专属配置区 */}
          {renderSourceConfig(index, rule, {
            userFields,
            nodeOptions,
            variableOptions,
            fields,
            orgPickerIndex,
            setOrgPickerIndex,
            updateRule,
          })}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addRule}>
        <Plus className="size-3" />
        添加办理人规则
      </Button>
    </div>
  )
}
```

- [ ] **Step 7: 实现 `renderSourceConfig`（各来源的配置控件）**

紧接 AssigneeRulesEditor 之后新增：

```tsx
function renderSourceConfig(
  index: number,
  rule: AssigneeRule,
  ctx: {
    userFields: FormFieldOption[]
    nodeOptions: { id: string; name: string }[]
    variableOptions: string[]
    fields: FormFieldOption[]
    orgPickerIndex: number | null
    setOrgPickerIndex: (i: number | null) => void
    updateRule: (i: number, r: AssigneeRule) => void
  },
) {
  const { userFields, nodeOptions, variableOptions, fields, orgPickerIndex, setOrgPickerIndex, updateRule } = ctx

  // 快捷：发起人主管
  if (rule.kind === "LEADER") {
    return (
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">第</Label>
        <Input
          type="number"
          min={1}
          max={10}
          value={rule.level ?? 1}
          onChange={(e) => updateRule(index, { ...rule, level: Math.max(1, Number(e.target.value) || 1) })}
          className="h-8 w-20 text-sm"
        />
        <Label className="text-xs text-muted-foreground">级主管（逐级向上）</Label>
      </div>
    )
  }
  if (rule.kind === "INITIATOR") {
    return <p className="text-xs text-muted-foreground">办理人为流程发起人本人。</p>
  }

  const source = rule.source ?? "FIXED"

  // 岗位固定 → 文本
  if (source === "FIXED" && rule.kind === "POST") {
    return (
      <Input
        value={rule.postName ?? ""}
        onChange={(e) => updateRule(index, { ...rule, postName: e.target.value })}
        placeholder="岗位名称（逗号分隔多个）"
        className="h-8 text-sm"
      />
    )
  }
  // 账户/角色/部门固定 → OrgPicker（按类型限定范围）
  if (source === "FIXED") {
    const types = ASSIGNEE_FIXED_REF_TYPES[rule.kind]
    return (
      <>
        <OrgPickerField
          value={rule.refs ?? []}
          multiple
          placeholder={`选择${ASSIGNEE_KIND_META[rule.kind].label}`}
          onOpen={() => setOrgPickerIndex(index)}
          onRemove={(ref) =>
            updateRule(index, {
              ...rule,
              refs: (rule.refs ?? []).filter((r) => !(r.type === ref.type && r.id === ref.id)),
            })
          }
        />
        <OrgPicker
          open={orgPickerIndex === index}
          onOpenChange={(open) => !open && setOrgPickerIndex(null)}
          title={`选择${ASSIGNEE_KIND_META[rule.kind].label}`}
          types={types}
          value={rule.refs ?? []}
          onConfirm={(refs) => updateRule(index, { ...rule, refs })}
        />
      </>
    )
  }
  if (source === "FORM_FIELD") {
    return (
      <Select value={rule.field || undefined} onValueChange={(v) => updateRule(index, { ...rule, field: v })}>
        <SelectTrigger size="sm" className="h-8 w-full text-sm">
          <SelectValue placeholder={userFields.length ? "选择选人字段" : "表单无选人字段"} />
        </SelectTrigger>
        <SelectContent>
          {userFields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (source === "VARIABLE") {
    return (
      <Select value={rule.varName || undefined} onValueChange={(v) => updateRule(index, { ...rule, varName: v })}>
        <SelectTrigger size="sm" className="h-8 w-full text-sm">
          <SelectValue placeholder={variableOptions.length ? "选择流程变量" : "未声明流程变量"} />
        </SelectTrigger>
        <SelectContent>
          {variableOptions.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (source === "FORMULA") {
    return (
      <FormulaField
        value={rule.formula ?? ""}
        onChange={(formula) => updateRule(index, { ...rule, formula })}
        fields={fields}
      />
    )
  }
  if (source === "APPLICANT") {
    return <p className="text-xs text-muted-foreground">办理人为申请人所在部门（全体成员）。</p>
  }
  // PREV_HANDLER / NODE_HANDLER
  return (
    <div className="space-y-2">
      {source === "NODE_HANDLER" && (
        <Select value={rule.fromNodeId || undefined} onValueChange={(v) => updateRule(index, { ...rule, fromNodeId: v })}>
          <SelectTrigger size="sm" className="h-8 w-full text-sm">
            <SelectValue placeholder="选择目标节点" />
          </SelectTrigger>
          <SelectContent>
            {nodeOptions.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={rule.takeLeader ?? false}
          onCheckedChange={(v) => updateRule(index, { ...rule, takeLeader: v })}
        />
        取其直属主管
      </label>
    </div>
  )
}
```

确保 property-panel.tsx 顶部已导入 `cn`（`@/lib/utils`）、`Switch`（`@/components/ui/switch`）——若缺则补 `import`。

- [ ] **Step 8: 给 AssigneeRulesEditor 传 nodeOptions / variableOptions**

在 property-panel.tsx 调用 `<AssigneeRulesEditor .../>` 处（约 766 行），补两个 prop。节点列表与变量来自面板已有的 config/上下文：

```tsx
<AssigneeRulesEditor
  rules={config.assigneeRules ?? []}
  onChange={(assigneeRules) => set({ assigneeRules })}
  fields={fields}
  nodeOptions={nodeOptions}       // 见下：从 designer steps 派生，透传进 property-panel
  variableOptions={(flowConfig?.variables ?? []).map((v) => v.name)}
/>
```

若 `nodeOptions`/`flowConfig` 尚未透传到该组件，则在 property-panel 的 props 上新增 `nodeOptions: {id;name}[]` 与 `flowConfig?: FlowConfig`，由外层 `process-designer.tsx` 传入（steps.map 成 `{id: step.id, name: step.name}`，排除当前节点自身）。grep 定位调用点：`grep -n "PropertyPanel\|property-panel" src/pages/workflow/designer/dingtalk/process-designer.tsx`。

- [ ] **Step 9: tsc + build**

Run: `cd /Users/west/dev/code/claude-code/ai-template && npx tsc -b && pnpm build`
Expected: 均退出 0。若报未用导入（FormulaEditor 被 FormulaField 取代后若仍导入旧 FormulaEditor），删除多余 import。

- [ ] **Step 10: 浏览器验证编辑器 + 旧定义回显**

启动前端（若未起 `pnpm dev`），登录 admin/admin123 → /workflow/defs → 编辑「请假审批」。逐项确认：
1. 点「总经理审批」节点 → 审批人规则出现**类型宫格 6 项**，当前高亮"账户"，来源默认"固定指定"，下方选人框只显示成员（复用 types 限制）。
2. 切类型到"角色"→ 来源退化只剩"固定"，选人框只显示角色。
3. 切"账户"→来源"来自公式"→ 面板显示紧凑预览 + `编辑公式`，点开是全屏 Modal 含函数库/字段引用/校验，确定后预览回填。
4. 切"账户"→来源"与指定节点办理人相关"→ 出现节点下拉（列出"部门经理审批"等）+ `取其直属主管`开关。
5. 「部门经理审批」节点回显为"发起人主管 · 第 1 级"（旧 `type:LEADER` 兼容映射成快捷类型），无报错。
6. 控制台无 error。

- [ ] **Step 11: Checkpoint（git 未初始化，逻辑检查点）**

前端两维模型完成：tsc+build 绿、编辑器交互正确、旧定义回显正常。记录改动文件。

---

### Task 2: 后端「来源优先」解析 + 三个新来源

**Files:**
- Modify: `server/oa-module-workflow/src/main/java/com/xingchen/oa/workflow/engine/AssigneeResolver.java`

**Interfaces:**
- Consumes（Task 1 产出的规则 JSON）：`{kind, source, refs, postName, field, varName, formula, applicantValue, fromNodeId, takeLeader, level}`。
- Produces：`evalRule` 对新来源 VARIABLE/PREV_HANDLER/NODE_HANDLER 解析出 userId 集合；保留对旧形状（type/source=RELATED_TO_APPLICANT）的解析。

- [ ] **Step 1: 注入 HistoryService**

在 AssigneeResolver 的构造/字段注入处加入 Flowable `HistoryService`（与已有的 mapper/服务同款注入方式）：

```java
import org.flowable.engine.HistoryService;
import org.flowable.task.api.history.HistoricTaskInstance;
// 字段：
private final HistoryService historyService;
// 构造函数参数追加 HistoryService historyService 并赋值（跟随现有构造器风格）
```

先看现有注入风格：`grep -n "private final\|public AssigneeResolver\|@Component\|@Service" AssigneeResolver.java`，按同款补参数。

- [ ] **Step 2: evalRule 顶部加"来源优先"分发**

在 `evalRule`（AssigneeResolver.java:211）内，**保留**现有 `RELATED_TO_APPLICANT` 分支（旧兼容，214-218）之后、`String type = ...` 之前，插入新来源分发：

```java
String source = rule.path("source").asString("");
switch (source.toUpperCase()) {
    case "VARIABLE" -> {
        String var = rule.path("varName").asString(null);
        if (var != null) out.addAll(parseUserRefs(execution.getVariable(var)));
        return out;
    }
    case "FORM_FIELD" -> {
        String field = rule.path("field").asString(null);
        if (field != null) out.addAll(parseUserRefs(execution.getVariable(field)));
        return out;
    }
    case "FORMULA" -> {
        out.addAll(evalFormula(rule.path("formula").asString(null),
                execution::getVariable, initiatorId, initiatorDeptId));
        return out;
    }
    case "APPLICANT" -> {
        // 目前仅 "DEPT"：申请人所在部门全体
        out.addAll(resolveApplicantSource("APPLICANT_DEPT", initiatorId, initiatorDeptId));
        return out;
    }
    case "PREV_HANDLER" -> {
        out.addAll(resolvePrevHandler(execution, rule.path("takeLeader").asBoolean(false)));
        return out;
    }
    case "NODE_HANDLER" -> {
        out.addAll(resolveNodeHandler(execution, rule.path("fromNodeId").asString(null),
                rule.path("takeLeader").asBoolean(false)));
        return out;
    }
    default -> { /* FIXED 或空：落到下方 kind 分支（含旧形状） */ }
}
```

现有 `type`/`kind` 分支（219-260）**原样保留**——负责 FIXED（ACCOUNT/ROLE/POST/DEPT via refs/postName）、快捷类型（LEADER/INITIATOR），以及旧形状（ORG/FORM_FIELD/FORMULA type）。

- [ ] **Step 3: 实现 resolvePrevHandler / resolveNodeHandler / collectAssignee**

在 AssigneeResolver 内新增（放在 resolvePost 附近）：

```java
/** 与上个办理人相关：本实例最近一个已完成 userTask 的 assignee（takeLeader 时取其 1 级主管）。 */
private Set<Long> resolvePrevHandler(DelegateExecution execution, boolean takeLeader) {
    Set<Long> out = new LinkedHashSet<>();
    List<HistoricTaskInstance> done = historyService.createHistoricTaskInstanceQuery()
            .processInstanceId(execution.getProcessInstanceId())
            .finished()
            .orderByHistoricTaskInstanceEndTime().desc()
            .listPage(0, 1);
    for (HistoricTaskInstance t : done) collectAssignee(t, out, takeLeader);
    return out;
}

/** 与指定节点办理人相关：指定 taskDefinitionKey 的历史 assignee（takeLeader 时取其 1 级主管）。 */
private Set<Long> resolveNodeHandler(DelegateExecution execution, String nodeId, boolean takeLeader) {
    Set<Long> out = new LinkedHashSet<>();
    if (nodeId == null || nodeId.isBlank()) return out;
    List<HistoricTaskInstance> tasks = historyService.createHistoricTaskInstanceQuery()
            .processInstanceId(execution.getProcessInstanceId())
            .taskDefinitionKey(nodeId)
            .list();
    for (HistoricTaskInstance t : tasks) collectAssignee(t, out, takeLeader);
    return out;
}

private void collectAssignee(HistoricTaskInstance t, Set<Long> out, boolean takeLeader) {
    if (t.getAssignee() == null || t.getAssignee().isBlank()) return;
    Long uid;
    try {
        uid = Long.valueOf(t.getAssignee().trim());
    } catch (NumberFormatException e) {
        return;
    }
    if (!takeLeader) {
        out.add(uid);
        return;
    }
    Long deptId = deptIdOfUser(uid);
    Long leader = leaderOf(deptId, 1);
    if (leader != null) out.add(leader);
}
```

`deptIdOfUser(Long)`：若 AssigneeResolver 无此方法，新增——查用户所属部门（沿用 leaderOf 用到的同一数据源，如 sys_user_assignment / sys_user.dept_id）。grep `grep -n "leaderOf\|deptId\|sys_user" AssigneeResolver.java` 确认既有取部门方式后照抄一个 `deptIdOfUser`。

- [ ] **Step 4: 编译**

Run: `cd /Users/west/dev/code/claude-code/ai-template/server && mvn -q -pl oa-module-workflow -am compile`
Expected: BUILD SUCCESS。

- [ ] **Step 5: 重启后端并跑一次现有 smoke（回归）**

按项目现有方式重启后端（用户约定：改后端才重启）。
Run: `cd /Users/west/dev/code/claude-code/ai-template/server && node smoke-test.mjs 2>&1 | tail -5`
Expected: `通过 346 项，失败 0 项`（旧路径无回归）。

- [ ] **Step 6: Checkpoint**

后端来源优先解析 + 三新来源就位，现有 smoke 无回归。

---

### Task 3: 契约文档 + 新来源 smoke 用例 + 全量回归

**Files:**
- Modify: `docs/flow-designer-v2.md`（办理人契约段）
- Modify: `server/smoke-test.mjs`（新增一条覆盖新来源的定义与断言）

**Interfaces:**
- Consumes：Task 1 的规则 JSON 形状 + Task 2 的后端解析。

- [ ] **Step 1: 更新契约文档**

在 `docs/flow-designer-v2.md` 办理人段落，替换旧的扁平类型说明为两维模型：类型（ACCOUNT/ROLE/POST/DEPT/LEADER/INITIATOR）× 来源（FIXED/FORM_FIELD/VARIABLE/FORMULA/APPLICANT/PREV_HANDLER/NODE_HANDLER）+ 来源矩阵 + 各来源字段（refs/postName/field/varName/formula/applicantValue/fromNodeId/takeLeader/level）+ 向后兼容映射表（照抄 spec 第四节）。

- [ ] **Step 2: smoke 新增新来源端到端用例**

在 smoke-test.mjs 里新增一条流程定义 `assignee_src_test`（两节点：节点 A 固定指定 admin；节点 B 用 `{kind:"ACCOUNT", source:"NODE_HANDLER", fromNodeId:"A", takeLeader:false}`），发起→在 A 审批（admin 办理）→断言 B 的办理人集合含 A 的办理人（admin）。再加一条 `{source:"VARIABLE", varName:"...”}`：发起时带一个用户 id 变量，断言解析出该用户。断言风格沿用文件内既有 `assert(...)` / 计数器。

关键断言（示意，套用文件内现有 helper）：

```js
// B 节点当前办理人应为 A 的办理人 admin(1)
const detailB = await getDetail(instId, tokenAfterA)
assert(
  detailB.currentNodes.some((n) => n.nodeId === "B" && n.assignees.some((a) => String(a.userId) === "1")),
  "NODE_HANDLER 应解析出 A 节点办理人",
)
```

用例结束后确保命中 smoke 既有的自动清理（`cleanupTestData` 会清 def_code != 'leave_approval' 的测试数据）。

- [ ] **Step 3: 跑 smoke 全量**

Run: `cd /Users/west/dev/code/claude-code/ai-template/server && node smoke-test.mjs 2>&1 | tail -6`
Expected: 全部通过（346 + 新增断言数），失败 0；末尾打印"测试数据已清理"。

- [ ] **Step 4: 前端终验 tsc + build**

Run: `cd /Users/west/dev/code/claude-code/ai-template && npx tsc -b && pnpm build`
Expected: 均退出 0。

- [ ] **Step 5: 浏览器全量回归**

登录 → /workflow/defs 编辑「请假审批」：确认设计器打开无报错、节点回显正确（Task1 Step10 项）；再发起一单请假、走一遍详情页（同意/驳回按钮、流程跟踪图）确认审批流运行时办理人解析正常。控制台无 error。清理测试实例（docker exec oa-postgres … TRUNCATE，沿用既有清理 SQL）。

- [ ] **Step 6: Checkpoint（收尾）**

契约同步、新来源 smoke 端到端通过、全量回归绿。功能交付。

---

## Self-Review

**Spec 覆盖**：类型列表(Task1 S1/S2)、来源矩阵(S2)、AssigneeRule 结构(S1)、UI 宫格+上下文来源+公式弹窗(S5-S8)、后端来源优先+三新来源(Task2)、向后兼容映射(Task1 S3 + Task2 S2 保留旧分支)、测试(Task3)、契约(Task3 S1) —— 均有对应任务。

**Placeholder 扫描**：各代码步给出完整代码；`deptIdOfUser`/`nodeOptions` 透传给了 grep 定位指引而非留空。无 TBD/TODO。

**类型一致**：前端 `AssigneeSource` 七值与后端 `evalRule` switch 分支一一对应；`fromNodeId/varName/takeLeader/applicantValue` 在 types.ts、serialize.ts、property-panel、后端四处命名一致。
