# 流程设计器整体重设计 · 视觉/交互规范（整页路由 + 无弹窗）

> 作者：丹青（UI 设计师） · 日期：2026-07-10 · 分支：`chore/remediation-batches-3-4`
> 上游规范：`docs/design/flow-designer-ui-spec.md`（节点色板/画布交互，本文不重复，仅引用其结论）
> 定位：**只出规范，代码实现归疾风（oa-frontend-dev）**。所有规格落在现有 shadcn/ui（new-york）+ Tailwind v4 token + CSS 变量（`--primary`/`--card`/`--border`/`--muted`/`--destructive`/`--accent`/`--popover`/`--radius`/`.dark`）之上，不引新字体、不引新图标库（沿用 lucide-react），暗色为一等公民、每条给亮/暗两态。
> 审阅对象：`src/pages/workflow/defs.tsx`（全屏 Modal 打开设计器）、`src/pages/workflow/designer/flow/flow-designer.tsx`（GRAPH 设计器 embedded 拼装）、`src/pages/workflow/designer/shared/property-panel.tsx`（共享属性面板 + 事件区）、`src/pages/workflow/designer/shared/formula-editor.tsx`（`FormulaField` → 嵌套 Modal，**核心痛点**）、`src/components/script-editor.tsx`、`src/App.tsx` / `src/config/menu.ts`（路由/菜单）。

---

## 0. 结论摘要（先看这段）

三个用户诉求 → 三条主线方案：

1. **设计器从"全屏 Modal 弹窗"改为"独立路由页"**：新增路由 `/workflow/defs/:code/design`（新建走 `/workflow/defs/new`），从 defs 列表「编辑/设计」`navigate()` 跳页而非 `setEditorOpen(true)`。页面结构 = **顶部操作条（h-14 sticky）+ 左调色板 + 中画布 + 右属性面板**，`defs.tsx` 的 `<Modal>` 整块删除（§1）。

2. **去掉"设计器里再弹一层 Dialog"的深度配置**。现状 GRAPH 设计器右面板里的**脚本/字段权限/边公式已是内联**（`ScriptEditor`/`FieldPermsEditor`/`FormulaDesigner` 直接渲染），**唯一残留的嵌套弹窗是办理人公式 `FormulaField` 的 `<Modal>`（formula-editor.tsx:198）**。方案：把它改为**属性面板"原地下钻子页 + 面板加宽"**——CodeMirror 公式/脚本编辑器嵌进加宽后的面板，不再 `<Modal>`（§2）。这是本次"无弹窗"的关键落点。

3. **事件/监听器体系化**：把当前 `EventsSection` 的裸列表升级为**卡片式监听器列表**——每条 = `触发点 → 动作（通知/Webhook/脚本/API/自定义监听器）→ 参数`，**新增"自定义监听器"第 5 种动作**与**"阻断办理"开关（仅前置触发点显示，开启后卡片带琥珀警示色）**（§3）。

**需主控/用户拍板的方向分歧 3 条**（§6）：D-1 深度编辑器承载方式（推荐"面板下钻加宽" vs 备选"右侧 Sheet 抽屉"）；D-2 新建入口是否保留轻量 Dialog；D-3 "自定义监听器"动作 + "阻断"开关需要 `types.ts` 加字段 + 后端 `OaEventDelegate` 支持，属前后端联动。

---

## 第一部分 · 整页架构（设计器改独立路由页）

### 1.1 路由与进入方式

| 场景 | 现状 | 新方案 |
|---|---|---|
| 从列表编辑/设计 | `openEdit(row)` → `setEditorOpen(true)` 弹 `<Modal>` | `navigate('/workflow/defs/' + row.defCode + '/design')` **跳页** |
| 新建 | `<Dialog>` 选类型/表单 → `setEditorOpen(true)` | `<Dialog>` 选类型/表单（保留，见 D-2）→ `navigate('/workflow/defs/new?type=GRAPH')` |
| 首次保存后 | Modal 内 `setEditor(id)` | `navigate` `replace:true` 把 `/new` 换成 `/:code/design`，保证刷新/分享 URL 稳定 |
| 退出 | 关 Modal | 顶栏「退出」→ `navigate('/workflow/defs')`（回列表 Tab；有未保存改动时 `AlertDialog` 二次确认，见 §1.5） |

- **路由注册**（`src/App.tsx` workflow 段，仿已有 `instances/:id` 动态路由）：
  ```tsx
  <Route path="defs/new" element={<WorkflowDesignerPage />} />
  <Route path="defs/:code/design" element={<WorkflowDesignerPage />} />
  ```
  新建一个薄壳页 `src/pages/workflow/designer-page.tsx`：读 `useParams().code` / `useSearchParams().get('type')`，负责**拉取定义详情 + 表单字段**（把 `defs.tsx` 里 `openEdit`/`resolveFormFields`/`parseGraphModel`/迁移逻辑搬过来），再渲染顶栏 + 设计器。**不进菜单**（`config/menu.ts` 不加项，同 `instances/:id`）。
- **面包屑/Tab**：路由 path 即 key，跳转后自动出 Tab；标题动态化沿用 `instance-detail` 现有做法（该页未显式写 tabs-store，跟随即可），Tab 文案回落"流程设计"。

### 1.2 页面骨架（GRAPH 设计器；DINGTALK 见 §1.6）

```
┌ TopBar  h-14 sticky top-0 z-20 border-b bg-background/95 backdrop-blur ─────────────────┐
│ ← 退出 │ [流程名 inline input] [Badge 流程图] 🔗 请假表单v3   ● 已保存    校验 整理 保存草稿 [发布] │
├────────────┬──────────────────────────────────────────────┬───────────────────────────┤
│  Palette   │                  Canvas                        │      Property Panel        │
│  w-56      │                  flex-1 min-w-0                │      w-[360px]             │
│  border-r  │   react-flow（Dots 背景 / Controls / MiniMap） │      border-l bg-card      │
│  bg-muted/20│  ┌ 校验结果 inline banner（可折叠，见 §1.4）┐  │   基础/高级 Tab + Section   │
│            │  └───────────────────────────────────────┘    │   （下钻时加宽至 600，§2） │
└────────────┴──────────────────────────────────────────────┴───────────────────────────┘
      整个三栏区：flex-1 min-h-0；页面根 = flex flex-col h-[calc(100dvh-<AppHeader+Tabs>)]
```

- 页面**渲染在标准 App 外壳内**（侧栏 + 顶部 Tab 保留），设计器占据路由 outlet 区，**不再自绘全屏遮罩**。页内**无 `PageHeader`**（顶部操作条取代它），把纵向空间全让给画布。
- 高度：根容器 `flex h-full min-h-0 flex-col`；三栏 `flex min-h-0 flex-1`；画布列 `min-w-0 flex-1`，左右两列 `shrink-0`。所有滚动发生在**列内部**（`overflow-y-auto`），页面本身不出横向滚动条。
- **专注模式（可选，P2）**：顶栏放一个 `PanelLeftClose` 图标按钮，调用 app-store 折叠侧栏，给画布最大宽度；再点还原。复用既有侧栏折叠能力，零新机制。

### 1.3 顶部操作条（TopBar）各区职责

| 区 | 内容 | 组件 / token | 状态 |
|---|---|---|---|
| 左·退出 | `←` `退出` | `Button variant=ghost size=sm`，`ArrowLeft size-4` | hover `bg-accent`；有未保存改动时点击弹 `AlertDialog` |
| 左·流程名 | 行内可编辑输入 | `Input` 无边框态（`border-transparent hover:border-input focus:border-ring`），`text-sm font-semibold` | 空值 `placeholder="未命名流程"`；失焦回写 `base.name` |
| 左·类型标记 | 流程图 / 仿钉钉 | `Badge variant=secondary`，`Workflow`/`GitBranch` `size-3` | 只读 |
| 左·表单绑定 | `🔗 表单名` chip | `Badge variant=outline`，`Link2 size-3`；未绑定 `text-muted-foreground` | 点击可跳表单（P3，可暂不接） |
| 中·保存状态 | `● 已保存` / `保存中…` / `● 未保存` | `text-xs`；已保存 `text-muted-foreground` + `CircleCheck text-emerald-600 dark:text-emerald-400`；未保存 `text-amber-600 dark:text-amber-400` 圆点 | 跟随脏标记 |
| 右·校验 | 「校验」 | `Button variant=outline size=sm` | error>0 时按钮不禁用但结果 banner 展开 |
| 右·整理布局 | `LayoutDashboard` 「整理」 | `Button variant=outline size=sm` | — |
| 右·保存草稿 | 「保存草稿」 | `Button variant=outline size=sm` | `disabled` when saving |
| 右·发布 | 「发布」 | `Button size=sm`（主色实底），`Send size-3.5` | **error>0 时 `disabled` + tooltip「请先修复 N 个错误」**（把 defs.tsx 的发布校验前移到顶栏） |
| 右·更多 | `⋯` 版本历史 / 复制编码 | `DropdownMenu`（`MoreHorizontal`） | 版本历史仍用现有 `Drawer`（右抽屉，非居中弹窗，符合"无弹窗"精神，保留） |

- 亮/暗：TopBar `bg-background/95 backdrop-blur` + `border-b border-border`，两态由 token 自适应；主按钮走 `--primary`，与主题联动。
- **defCode**：不再单独占底栏（Modal footer 那行删除），收进 `⋯` 菜单的「复制编码」+ 流程名下方 `text-[11px] text-muted-foreground font-mono` 副标（可选）。

### 1.4 校验结果呈现（沿用 flow-designer 现有双通道，仅换位置）

- 现状 flow-designer 已实现：清单每条可点击 `focusIssue` 定位 + 画布节点/边错误环（`ring-destructive` / `stroke:var(--destructive)`），色走 token。**保留不动**。
- 位置改造：校验清单从"画布上方独占一条"改为**画布内顶部浮层 banner**（`absolute top-2 inset-x-2 z-10 rounded-lg border bg-card/95 backdrop-blur shadow-sm`），可折叠（默认展开，右上 `X` 收起）。不挤压画布高度。
- 汇总条：`共 N 个错误 · M 个提示`；error 图标 `AlertTriangle text-destructive`，warn `Info text-amber-600 dark:text-amber-400`。

### 1.5 未保存保护 & 空态 / 加载

- **离开确认**：脏标记（nodes/edges/config 变更）为真时，退出 / 浏览器返回 → `AlertDialog`（这是"确认对话框"非"配置弹窗"，允许保留）："有未保存的改动，确定退出？" `取消` / `不保存退出` / `保存并退出`。
- **加载态**：`designer-page` 拉详情时，三栏区显示 skeleton——画布 3–4 个 `w-52 h-16 rounded-lg bg-muted animate-pulse` 占位卡 + 居中 `Loader2 animate-spin text-muted-foreground`；面板 3 行 `h-9 bg-muted rounded animate-pulse`。失败走既有 `NetworkError`/`offline` 降级（顶部 banner + 只读），与全站一致（CLAUDE.md `src/lib/api.ts` 约定）。
- **空画布引导**（沿用 ui-spec §4.1）：`nodes.length===0` 时画布中央 `MousePointerClick size-8 text-muted-foreground/60` + "从左侧拖拽节点开始搭建流程"，有节点即隐藏。

### 1.6 响应式

| 断点 | Palette | Canvas | Property Panel |
|---|---|---|---|
| `≥ xl`（≥1280） | w-56 展开 | flex-1 | w-[360px]（下钻时 600） |
| `lg`（1024–1279） | w-14 图标轨（仅图标 + `Tooltip` 名称） | flex-1 | w-[320px]（下钻时铺满面板列，不再加宽） |
| `< lg` | 收进画布左上「+ 节点」`Popover` 分组列表 | 全宽 | 改为**右侧 `Sheet`（side=right）覆盖式**，选中元素时滑出，关闭回画布 |

- 设计器本质是宽屏工具，`< lg` 为降级可用态（提示"建议在更大屏幕编辑"）。移动端不作为一等目标。

### 1.7 DINGTALK（仿钉钉）设计器的整页化

- 同一路由页承载：`?type=DINGTALK` 或定义 `designerType==='DINGTALK'` 时，中间区渲染 `DingtalkProcessDesigner`（线性画布，无自由调色板），**共用同一个 TopBar + 共享 PropertyPanel + 同一套无弹窗规则**。
- DINGTALK 的办理人公式同样走 `FormulaField`（同一组件），§2 的改造对两个设计器**一次性生效**。

---

## 第二部分 · 无弹窗的深度配置承载

### 2.1 现状盘点（哪些已内联、哪些仍弹窗）

| 深度配置 | 现状承载 | 是否弹窗 | 处置 |
|---|---|---|---|
| 边·结构化条件 | 右面板 `ConditionEditor` 内联 | 否 | 保留 |
| 边·高级公式（expression） | 右面板 `FormulaDesigner` 内联 | 否 | 保留 |
| serviceTask·脚本 | 右面板 `ScriptEditor` 内联 | 否 | 保留 |
| userTask·字段权限 | 右面板 `FieldPermsEditor` 内联 | 否 | 保留 |
| 事件·SCRIPT 动作 | 面板事件卡内 `ScriptEditor` 内联 | 否 | 保留（§3 优化排布） |
| 事件·API 动作 | 面板事件卡内 `Textarea` 内联 | 否 | 保留 |
| **办理人·FORMULA 公式** | **`FormulaField` → `<Modal>` 760×560** | **是（嵌套弹窗）** | **改造，见 §2.2** |
| 选人（OrgPicker） | 弹出选择器 | 是（选择器） | 保留（"资源选择器"非"配置编辑器"，见 §2.4） |

**结论**：真正违背"无弹窗"的只有**办理人公式的 `FormulaField` Modal**。它是"节点属性面板（在设计器内）→ 又弹一个居中 Modal"的三层叠加，正是用户点名的痛点。

### 2.2 推荐方案：属性面板"原地下钻子页 + 面板加宽"（Primary）

把公式/脚本这类需要**更宽画幅（左函数库 + 右代码 + 底部说明）**的编辑器，收进**属性面板自身的一个下钻视图**，而不是新开 Modal：

**交互流程**
1. 面板"审批人规则"里某条规则 `source=FORMULA` → 该规则位置显示**紧凑预览**（现有 `FormulaField` 上半部：`rounded-md border bg-muted/30 font-mono text-xs` 显示公式或"未配置公式"）+ 「编辑公式」按钮。
2. 点「编辑公式」→ **不弹窗**，而是：
   - 属性面板整体从 `w-[360px]` **加宽到 `w-[600px]`**（`transition-[width] duration-200`；画布 `flex-1 min-w-0` 自然让位）。
   - 面板内容**切换为下钻子视图**（同一面板区，非覆盖层）：顶部一条返回栏 `← 编辑办理人公式`（`Button variant=ghost size=sm` + `ArrowLeft`），下方铺满 `AdvancedFormulaEditor`（`FormulaEditor` 组件本体，含函数库/字段/校验）。
   - 面包屑保留上下文：返回栏副标 `text-[11px] text-muted-foreground`：`审批节点 · 规则 2`。
3. 编辑即时写回（`onChange` 直接落 `rule.formula`，无"确定/取消"——与全站内联面板一致，避免草稿态）。点「← 返回」收起子视图、面板缩回 360。

**为什么是它**
- 完全"内联"：不叠遮罩、不夺焦、画布与选中态始终可见（只是变窄），契合用户"CodeMirror 嵌在内联面板里，不再单开 Dialog"的原话。
- 复用：`FormulaEditor` / `ScriptEditor` 组件本体**零改动**，只换外层容器（Modal → 面板下钻视图）。
- 一处机制通吃：脚本编辑器、API body、字段权限矩阵在窄屏（`lg`）下也可用同一"下钻"承载。

**面板宽度状态机**

| 状态 | 宽度 | 触发 |
|---|---|---|
| 常规配置 | `w-[360px]` | 默认 |
| 深度编辑（公式/脚本/API 大编辑器） | `w-[600px]` | 进入下钻子视图 |
| `lg` 断点 | `w-[320px]`（不加宽，子视图铺满面板列） | 视口 <1280 |

### 2.3 备选方案（取舍）

- **备选 A · 右侧 Sheet 抽屉**（`src/components/ui/sheet.tsx`，`side="right"`，w≈680，覆盖画布右侧、带轻遮罩）。优点：宽度充裕、实现简单（现成组件）；缺点：**仍是一层浮层/遮罩**，与"无弹窗"字面有张力（虽非居中 Modal）。**若 D-1 主控更看重实现成本，可选此项**——因为设计器已是路由页，Sheet 只是一级抽屉，不构成"弹窗叠弹窗"。
- **备选 B · 属性面板顶部再加一个 Tab**（基础/高级/**公式**）。缺点：公式属于"某条规则"的下级配置，升成节点级 Tab 破坏信息层级，且 360 宽仍不够，pass。
- **不采用**：任何 `Dialog`/`Modal` 居中弹窗承载公式/脚本（现状 `FormulaField` 即此，本次废弃）。

**推荐取 Primary（下钻加宽）**；Sheet 作为实现受阻时的 fallback。二者都满足"非居中弹窗"，差异是"面板内下钻" vs "一级抽屉"，需 D-1 拍板。

### 2.4 选人 OrgPicker 的定位说明

`OrgPicker`（选账户/角色/部门/岗位）在办理人、抄送、通知对象处均以弹出选择器出现。它是**"资源选择器"（picker）而非"配置编辑器"**——像文件选择、日期选择，是一次性拾取动作，业界普遍用弹层承载，不在本次"去配置弹窗"范围内。**保留**，但两处打磨（P2）：暗色下选择器 `bg-popover`、选中项 `bg-accent`；触发字段 `OrgPickerField` 空态文案统一。

---

## 第三部分 · 事件 / 监听器选择与配置 UX

### 3.1 现状问题

- `property-panel.tsx` 的 `EventsSection`：每条事件 = 一个 `rounded-md border` 块，内含 `触发点 Select` + 删除 icon + `EventActionEditor`（动作 Select + 载荷）。**功能齐但视觉扁平**：多条并列时缺层级、无"这条会打断办理"的警示、无折叠摘要，条数一多就糊。
- 动作只有 4 种（`NOTIFY/WEBHOOK/SCRIPT/API`），**缺"自定义监听器"**。
- **无"阻断/不阻断"概念**（`EventActionConfig` 无 `blocking` 字段；后端 `OaEventDelegate` 目前把 `complete` 映射到 `TASK_BEFORE_COMPLETE`+`TASK_AFTER_COMPLETE`，前置点存在但未暴露"失败即中止办理"的开关）。

### 3.2 术语统一（本节先定义，全设计器一致）

| 术语 | 含义 | 旧文案 → 新文案 |
|---|---|---|
| **事件监听器** | 挂在节点/流程上、在某触发点执行一个动作的一条配置 | "节点事件"/"流程事件" → 统一区块名「事件监听器」 |
| **触发点** | 生命周期时机（6 节点点 / 3 流程点） | 保留 `EVENT_TRIGGER_META` 文案 |
| **动作** | 触发时执行什么 | 通知 / Webhook / 脚本 / API / **自定义监听器**（新增） |
| **前置触发点** | 名称含"前/确认"的时机：`ACTIVITY_CONFIRM_PARTICIPANTS`、`TASK_BEFORE_COMPLETE`、`TASK_BEFORE_UNDO` | 仅此三点显示「阻断办理」开关 |
| **阻断办理** | 前置动作失败则中止本次办理（抛异常回滚） | 新增开关 |

### 3.3 卡片式监听器列表（推荐布局）

区块位置：审批节点「高级属性」Tab、流程「高级属性」Tab 内的 `Section title="事件监听器" icon={Zap}`。

**区块头**
```
⚡ 事件监听器                                  [+ 添加监听器]
在节点/流程生命周期触发点执行 通知/Webhook/脚本/API/自定义监听器。
```
- 标题 `text-xs font-medium`；提示 `text-xs text-muted-foreground`；「+ 添加监听器」`Button variant=outline size=sm h-7`（`Plus size-3`）。

**每条监听器 = 一张卡（`Collapsible`，默认折叠为摘要）**

折叠态（摘要行，一眼扫多条）：
```
┌───────────────────────────────────────────────────────────┐
│ ①  [办理完成后]  → 发送通知           ⚠阻断   ⌄   🗑        │
└───────────────────────────────────────────────────────────┘
```
- 卡容器：`rounded-md border bg-card`；序号徽标 `size-5 rounded-full bg-muted text-[11px]`。
- 触发点 chip：`Badge variant=secondary text-[11px]`（读 `EVENT_TRIGGER_META`）。
- 动作摘要：`→ 发送通知` `text-xs text-muted-foreground`（读 `EVENT_ACTION_META`）。
- **阻断标记（关键）**：该条为前置点且 `blocking=true` 时，右侧显示 `⚠ 阻断` 徽标 `bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/40`，**整卡加左边框** `border-l-2 border-l-amber-500`，使"会打断办理"的监听器在列表里一眼跳出。
- 展开箭头 `ChevronDown`（`Collapsible`）；删除 `Trash2 size-3.5 text-muted-foreground hover:text-destructive`。

展开态（编辑）：
```
┌───────────────────────────────────────────────────────────┐
│ ① 触发点  [ 办理完成前            ▾ ]                        │  ← Select，全宽
│   动作    [ 执行脚本              ▾ ]                        │  ← Select，全宽
│   ┌ 阻断办理（前置点才出现）───────────────────────────┐   │
│   │ ⚠ 失败则中止本次办理           [ Switch ]           │   │  ← amber 警示条
│   └───────────────────────────────────────────────────┘   │
│   ── 动作参数（随动作切换）──────────────────────────────  │
│   [ 脚本编辑器 / 通知对象+模板 / Webhook URL / API 表单 ]   │
│                                                    [🗑 删除] │
└───────────────────────────────────────────────────────────┘
```
- **触发点、动作各占一行 `Select`**（现状挤在一行，改为上下两行，配 `FieldLabel`「触发点」「动作」，层级更清晰）。
- **阻断办理开关**：`SwitchRow` 变体，**仅当 `trigger ∈ 前置点` 时渲染**。容器 `rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2`；标签 `⚠ 阻断办理` `text-amber-700 dark:text-amber-400`，副文"失败则中止本次办理并回滚" `text-xs text-muted-foreground`；`Switch`（开启时 `data-[state=checked]` 走主色即可，卡片左边框由 §3.3 折叠态呈现）。切到非前置点时开关消失且 `blocking` 清为 `undefined`（避免残留）。
- **动作参数区**：`── 动作参数 ──` 细分隔（`border-t` + `text-[11px] text-muted-foreground`），下接现有各动作载荷：
  - 通知：`OrgPickerField`（通知对象）+ 模板 `Input`。
  - Webhook：URL `Input`。
  - 脚本：`ScriptEditor`（内联；若嫌窄可复用 §2.2 下钻加宽）。
  - API：method `Select` + url + headers/body `Textarea`（现状保留）。
  - **自定义监听器（新增）**：`Input` 填 `delegateExpression`/类全限定名（`placeholder="如 beanName 或 com.xxx.MyListener"`）+ 一行说明"由后端按名解析执行（治理同 wf:script:write）"。

### 3.4 为什么卡片而非表格

- 每条监听器的**参数形态差异极大**（通知要选人+模板，脚本要 CodeMirror，API 要多字段），表格行放不下这种异构深度配置；卡片可展开承载任意高度，折叠态又保持"多条一览"的紧凑。**采用卡片式**。
- 多条清晰不乱的三支柱：①折叠摘要（序号+触发点 chip+动作+阻断标记）；②阻断卡左边框警示色让危险项凸显；③参数区带 `── 动作参数 ──` 分隔，视觉上把"何时/做什么/怎么做"分层。

### 3.5 数据模型改动（交磐石/疾风联动，属 D-3）

- `types.ts`：`EventAction` 增 `"LISTENER"`；`EventActionConfig` 增 `listener?: { expression: string }` 与 `blocking?: boolean`。
- `config.ts`：`EVENT_ACTION_META` 增 `LISTENER: "自定义监听器"`；新增 `BLOCKING_TRIGGERS: Set<EventTrigger>` = `{ACTIVITY_CONFIRM_PARTICIPANTS, TASK_BEFORE_COMPLETE, TASK_BEFORE_UNDO}` 供面板判定是否显示阻断开关。
- `withEventAction`（property-panel.tsx:1155）切动作时初始化/清理 `listener` 字段，并在切到非前置触发点时清 `blocking`。
- 序列化（`flow/serialize.ts` / `dingtalk/serialize.ts`）带上 `listener`/`blocking`；后端 `OaEventDelegate` 对 `blocking && 前置点` 的动作失败**抛异常中止办理**（非阻断则吞异常记日志）。**前端只出规格，后端行为由主控转磐石确认。**

---

## 第四部分 · 清晰易用（信息层次 / 空态 / 术语 / 暗色）

### 4.1 属性面板信息层次（选中即所得）

- **面板头固定**：`节点类型标题`（`nodeTitle()`）+ `基础/高级` Tab（`shrink-0 border-b`，现状保留）。加一行**当前选中标识**：`text-[11px] text-muted-foreground`——`审批节点 · apply`（type 中文名 + 节点名），让用户确认"我在配哪个"。
- **常用操作触手可及**：审批节点最高频 = 办理人规则 + 多人模式，二者置于「基础属性」顶部两个 `Section`（现状已如此，保留 `defaultOpen`）；低频（审批意见、字段权限）`defaultOpen={false}` 折叠。
- **深度配置节点占位**（W-20 现有）：`ai/webhook/timer/callActivity/subProcess` 点开面板给"该节点配置将在后续版本开放"占位，避免空白像坏了。**保留**。

### 4.2 走查式「从旧到新」对照

| # | 现状问题 | 新方案 | 涉及文件 | 优先级 |
|---|---|---|---|---|
| R-01 | 设计器 = 全屏 `<Modal>`（`width=1200 height=740`），受限于弹窗尺寸、URL 不可分享、`Esc` 易误关丢草稿 | 独立路由页 `/workflow/defs/:code/design`，标准外壳内铺满，URL 可分享/刷新，离开有 `AlertDialog` 保护 | `defs.tsx` 删 Modal；新增 `designer-page.tsx`；`App.tsx` 加路由 | P0 |
| R-02 | 办理人公式「编辑公式」再弹 `<Modal>` 760×560（弹窗套弹窗套面板三层） | 属性面板**原地下钻子页 + 加宽至 600**，CodeMirror 内联；`← 返回`收起 | `formula-editor.tsx` `FormulaField`（去 Modal） | P0 |
| R-03 | 顶部保存/发布藏在 Modal footer；defCode 占一行；发布校验另弹 Dialog | 顶栏统一操作条：退出/名称/保存/发布/校验/整理；发布 error>0 时 `disabled`+tooltip | `designer-page.tsx` 顶栏；`defs.tsx` 发布 Dialog 可保留为纯确认 | P1 |
| R-04 | 事件列表扁平、触发点+删除挤一行、无阻断概念、无警示 | 卡片式监听器：折叠摘要 + 触发点/动作分行 + 阻断开关（前置点）+ 琥珀警示卡 | `property-panel.tsx` `EventsSection`/`EventActionEditor` | P1 |
| R-05 | 动作仅 4 种，"自定义监听器"无入口 | `EventAction` 增 `LISTENER`，参数 = 表达式/类名 `Input` | `types.ts`/`config.ts`/`property-panel.tsx` + 后端 | P2（D-3） |
| R-06 | 开发脚手架文案（"序列化 ProcessModel""往返一致 ✓"）曾暴露 | 已由 `DEV_SCAFFOLD && !embedded` 收起；整页化后 `embedded` 语义改为"路由页"，确认脚手架不外露 | `flow-designer.tsx` | P2 |
| R-07 | 面板不显示"当前选中的是哪个节点" | 面板头加 `类型 · 节点名` 副标 | `property-panel.tsx` `PropertyPanel` 头 | P2 |
| R-08 | 窄屏面板无处安放深度编辑器 | `lg` 断点下钻子视图铺满面板列；`<lg` 面板改 `Sheet` | `designer-page.tsx` | P2 |

### 4.3 暗色两态验收要点

- TopBar：`bg-background/95` + `border-b`；`backdrop-blur` 在暗色不发灰（token 自适应）。
- 面板/卡片：`bg-card` / `border-border`；折叠 hover `bg-accent`。
- 阻断警示：`bg-amber-500/5`（暗色不刺眼）+ `text-amber-700 dark:text-amber-400` + `border-amber-500/40`（沿用 `WF_STATUS_META` 的 amber 双态约定，Tailwind 无语义 warning token）。
- 保存状态/校验：success `text-emerald-600 dark:text-emerald-400`；error `text-destructive`（token 双态自带）。
- 公式预览框：`bg-muted/30`（暗色下与 card 有别，可读）。
- **色弱/灰度模式**：阻断项不能只靠琥珀色区分——已用 `⚠` 图标 + `阻断` 文字 + 左边框三重冗余，灰度下仍可辨。

---

## 第五部分 · 给疾风的落地要点清单（按优先级）

**P0（先做，解决用户三诉求的骨架）**
1. `App.tsx` 加两条路由 `defs/new`、`defs/:code/design`；新建 `src/pages/workflow/designer-page.tsx` 薄壳：`useParams`/`useSearchParams` → 拉定义详情+表单字段（迁移 `defs.tsx` 的 `openEdit`/`resolveFormFields`/`parseGraphModel`/BPMN 迁移逻辑）→ 渲染 §1.2 骨架。
2. `defs.tsx`：列表「编辑」`onClick` 改 `navigate('/workflow/defs/'+defCode+'/design')`；删除全屏 `<Modal>` 及其内联设计器拼装（迁到 designer-page）。
3. `formula-editor.tsx` `FormulaField`：去掉 `<Modal>`，改为向上抛"进入公式编辑"信号，由属性面板做 §2.2 下钻加宽 + `AdvancedFormulaEditor` 内联（`FormulaEditor` 组件本体不改）。
4. 顶部操作条（§1.3）：退出/名称/保存草稿/发布/校验/整理 + 保存状态 + 离开 `AlertDialog`；发布按钮 error>0 `disabled`+tooltip。

**P1（体系性）**
5. 事件区改卡片式监听器（§3.3）：折叠摘要 + 触发点/动作分行 + `── 动作参数 ──` 分隔。
6. 阻断办理开关（§3.3）：`BLOCKING_TRIGGERS` 判定显隐 + 琥珀警示卡（左边框 + `⚠阻断` 徽标）；切非前置点清 `blocking`。
7. 面板宽度状态机（§2.2）：`w-[360px] ↔ w-[600px]` `transition-[width]`；下钻返回栏 `← 编辑办理人公式`。
8. 校验 banner 移到画布内浮层可折叠（§1.4）。

**P2（增强）**
9. `EventAction` 增 `LISTENER` + 参数 `Input`（§3.5，需与后端对齐，属 D-3）。
10. 面板头选中标识副标（R-07）；`ai/webhook/timer/...` 占位说明保留。
11. 响应式三档（§1.6）：`lg` 图标轨调色板 + 面板不加宽；`<lg` 面板改 `Sheet`。
12. 专注模式（折叠侧栏）按钮；表单绑定 chip 可点跳转。

**P3**
13. Tab/面包屑动态标题接入（跟随 `instance-detail` 现有做法）。
14. 版本历史入口收进顶栏 `⋯` 菜单（现有 `Drawer` 复用）。

---

## 第六部分 · 需主控/用户拍板的方向分歧

- **D-1（必须先定，阻塞 R-02/P1-7）· 深度编辑器承载：面板下钻加宽 vs 右侧 Sheet 抽屉**
  - 推荐（本文 Primary）：**属性面板原地下钻 + 加宽至 600**，最贴合用户"内联、不弹窗"原话，零遮罩、保留画布上下文；代价是要写面板宽度状态机 + 下钻视图路由态。
  - 备选：**右侧 `Sheet`（side=right，w≈680，轻遮罩）**，用现成组件、实现快；但仍是一级抽屉（非居中 Modal，但有遮罩），与"无弹窗"字面略有张力。
  - 请主控在"体验纯度（下钻）vs 实现成本（Sheet）"间选定，疾风据此一次落地。

- **D-2（次要）· 新建入口是否保留轻量 Dialog**
  - 现状新建先弹 `<Dialog>` 选"设计器类型 + 表单绑定"（2 字段 + 2 选择），再进设计器。
  - 建议：**保留此 Dialog**（它是"新建向导/菜单"而非"工作区配置弹窗"，是一次性选择，做成整页反而繁琐），确认后 `navigate` 跳设计器路由页。若用户坚持"任何弹窗都不要"，则改 `/workflow/defs/new` 首屏内嵌该选择表单。倾向保留，请用户确认可接受。

- **D-3（前后端联动）· "自定义监听器"动作 + "阻断办理"开关**
  - 需 `types.ts`/`config.ts`/`serde` 加 `LISTENER` 动作、`listener`/`blocking` 字段；后端 `OaEventDelegate` 对"前置点 + blocking"的动作失败抛异常中止办理。
  - 属数据契约 + 引擎行为变更，需主控转磐石确认后端可支持，再由疾风接前端 UI。UI 规格（§3.3）可先行落地为"字段就绪即生效"。
