# 新 react-flow 流程设计器 · 视觉/交互规范 + 走查（N-U-01）

> 作者：丹青（UI 设计师） · 日期：2026-07-09 · 分支：`chore/remediation-batches-3-4`
> 审阅对象：`src/pages/workflow/designer/flow/`（canvas / flow-palette / node-catalog / nodes ×14 / edges / flow-designer / validate / serialize / summary / model）
> 定位：**只出规范与走查，代码实现归疾风（oa-frontend-dev）**。所有规格落在现有 shadcn + Tailwind v4 token + CSS 变量（`--primary`/`--radius`/`.dark`）之上，不引新字体、不引新图标库（沿用 lucide-react）。
> 已实地核对：`pnpm dev` 起前端，离线登录进 `/demo/flow-designer`，Playwright 截图，亮/暗两态各一张 + 画布局部放大（device 缩放）。观察写入下文各条现状。

---

## 0. 结论摘要（先看这段）

- **14 类节点没有"分类色相"体系**：颜色是逐节点手挑的，跨分类撞色严重（violet 同时是 AI 与包容网关；sky 同时是抄送与并行网关；rose 同时是终止/自动拒绝/边界定时；indigo 同时是子流程调用与定时）。这是本次最大的系统性问题，且**修复会一次性改动多类节点配色，属视觉方向决策，需主控拍板**（见 §5 分歧 A）。
- **节点渲染尺寸与 model.ts 声明的后端默认 `size` 不一致**（圆 48px vs 声明 30、菱形对角 ~68px vs 声明 40、卡片 208/224px vs 声明 100×60），而调色板 `makeData()` 从不写 `size` → 序列化省略 → 后端按错误默认补 DI，导出的 BPMN 图形会错位（见 W-03，高优先级）。
- **校验错误未锚定到画布**：错误只在画布上方列成文字清单，点击不选中、节点本身无错误环（旧 bpmn 设计器有 `.oa-error` 高亮，新设计器丢了，见 W-14，高优先级）。
- **缺节点悬浮操作（删除/复制）**、**连线合法性只在落点判定（无拖拽中实时反馈）**、**无空态引导**、**边选中反馈过弱**（见交互规范 §3 与走查）。
- 术语：`拒绝`/`驳回` 不统一（调色板"自动拒绝" vs summary"自动驳回" vs types `reject:驳回`）；条件/摘要显示原始字段 **key**（`days`）而非表单 **label**（`请假天数`）。

走查共 **22 条**：P0（阻断/数据正确性）**2 条**（W-03 尺寸/DI、W-14 校验错误未锚定画布）、P1（体系性）**4 条**（W-01 色板体系、W-10 边选中、W-11 连线实时反馈、W-12 删除/复制悬浮操作）、其余 P2/P3。需主控拍板的视觉方向分歧 **2 条**（§5：网关是否统一色相、OA 服务是否收敛单色）。

---

## 第一部分 · 视觉规范

### 1.1 节点分类色相色板（目标体系）

原则：**同一"分类"共用一个色相家族，类内差异靠图标 / 形状 / 描边虚实区分，而不是靠再换一个色相**。全部取 Tailwind 内置色板 token（`emerald/orange/amber/sky/violet/...`），审批主色可选接 `--primary`。事件节点是 BPMN 语义信号灯，按"起/正常止/异常止"分三色是 BPMN 常规，允许类内多色。

| 分类 | 成员（type / palette key） | 目标色相家族 | 亮色 token | 暗色 token（文字/图标） | 形状 |
|---|---|---|---|---|---|
| **事件** | startEvent | emerald（通行/起点，全局唯一绿） | `border-emerald-500 bg-emerald-500/10` | `text-emerald-400` | 细圈圆 |
| | endEvent（正常） | slate（中性终止） | `border-slate-500 bg-slate-500/10` | `text-slate-300` | 粗圈圆 |
| | endEvent（terminate 终止） | `--destructive`/rose（异常终止） | `border-rose-600 bg-rose-500/10` | `text-rose-400` | 粗圈圆 + 方块 |
| **审批任务** | userTask | orange（人工任务签名色，或接 `--primary`） | `bg-orange-500` 头 | 头部白字不变 | 圆角矩形卡 |
| **OA 服务扩展** | cc / ai / webhook | **统一 teal/cyan 家族**（当前 sky/violet/teal 三色，撞网关色，建议收敛） | `bg-teal-500` 头，图标区分 | 头部白字 | 圆角矩形卡 |
| **自动决策** | autoApprove / autoReject | 语义色（通过=emerald / 拒绝=rose，与审批语义呼应） | `bg-emerald-600` / `bg-rose-600` | 白字 | 圆角矩形卡 |
| **触发/委托** | trigger / delegate（serviceTask） | amber(触发) / slate(委托) | `bg-amber-600` / `bg-slate-600` | 白字 | 圆角矩形卡 |
| **网关** | exclusive / parallel / inclusive | **统一 amber 一个家族**（当前 amber/sky/violet 三色，见分歧 A） | `border-amber-500 bg-amber-500/10` | `text-amber-400` | 菱形，图标 X/＋/◯ 区分 |
| **结构/定时** | callActivity / subProcess / timerCatch / timerBoundary | **统一 indigo 家族**（当前 indigo/cyan/indigo/rose 混用） | `border-indigo-500` 系 | `text-indigo-400` | callActivity 粗左右框卡 / subProcess 双框 / timer 双圈圆 |

> 说明：上表是**目标**。当前实现的实际取色见 §1.6 的对照与走查 W-01/W-02。将"结构/定时"里的 timerBoundary 从 rose 挪到 indigo 家族，可把 rose 归还给"异常"语义（terminate / autoReject），消除三处 rose 撞色。

**色弱/灰色模式**：`html.color-weak-mode`（`invert(80%)`）与 `html.grayscale-mode`（`grayscale`）是全局滤镜（`src/index.css:228-236`）。因此节点区分**不得只靠色相**——上表已保证每类节点都有独立**图标 + 形状**，灰度下仍可辨。走查确认：三类网关在灰度下仅靠 X/＋/◯ 图标区分（OK）；但 cc/ai/webhook 若都收敛成 teal，则灰度下三者同形同色，仅图标不同（可接受，图标够分辨）。

### 1.2 节点卡解剖（圆角矩形活动卡，`node-chrome.tsx#ActivityCard`）

```
┌─────────────────────────────┐  ← w-52(208px) rounded-lg border bg-card shadow-sm
│ [icon] 标题…………………………………… │  ← 头部条 h-8，headerClass 实色底 + 白字 text-xs font-medium，标题 truncate
├─────────────────────────────┤
│ 摘要文本（单行 truncate）……… │  ← px-3 py-2 text-xs text-muted-foreground
└─────────────────────────────┘
  ○ 顶部 target 锚点 / ○ 底部 source 锚点（!size-2.5 圆点，!border-2 !border-background，!bg-<家族>-500）
```
- **选中环**：`selectedRing()` = `ring-2 ring-primary ring-offset-2 ring-offset-background`（node-chrome:15-17）。跟随主题主色，亮/暗自适应。
- **图标**：lucide，`size-3.5`，头部白字继承。
- **统一宽度**：活动卡应统一 `w-52`。当前 `SubProcessNode` 用 `w-56`（`sub-process-node.tsx:21`），与其余活动卡不齐（走查 W-05）。

### 1.3 形状统一尺寸规格

| 形状 | 组件 | 当前尺寸 | 规格（建议统一） |
|---|---|---|---|
| 事件圆（起/止） | start/end-event-node | `size-12`(48px) | 事件圆统一 **48px** 外径；terminate/正常止用 `border-[3px]` 粗圈，起点 `border-2` 细圈 |
| 定时双圈圆 | timer-catch(`size-12`) / timer-boundary(`size-11`) | 48 / 44px | 统一 **48px**，内圈 `size-9`；boundary 中断=实线双圈、非中断=虚线双圈（已实现，仅尺寸对齐） |
| 网关菱形 | GatewayShell | `size-12` rotate-45（对角≈68px） | 统一 **48px 方 / 对角 ≈68px**，图标反旋 `-rotate-45` `size-4` |
| 活动卡 | ActivityCard | `w-52`（高度自适应） | 统一 **w-52**（含 subProcess 的头部条宽度基准） |
| 子流程双框 | sub-process-node | `w-56` 外框 + 内嵌 dashed | 改 `w-56`→与体系一致或明确定为"结构类更宽"，二选一（W-05） |

> **DI 关键**：以上是**画布视觉尺寸**。model.ts:36-38 注释声明后端在 `size` 省略时按"事件 30×30 / 网关 40×40 / 任务 100×60"补 DI——与实际渲染的 48/68/208 **不符**。规格要求：调色板 `makeData()` 应写入与渲染一致的 `size`，或后端默认改为与前端一致（走查 W-03，需与磐石对齐）。

### 1.4 边（sequenceFlow）规格（`edges/sequence-flow-edge.tsx`）

- **走线**：`getSmoothStepPath`，`borderRadius: 8`（正交折线，BPMN 常规）。✓
- **箭头**：`markerEnd`（react-flow 默认）。✓
- **条件标签**：中点 pill，`bg-background border px-1.5 py-0.5 text-[11px] rounded shadow-sm`，`max-w-40 truncate`；有条件时 `border-amber-500/40 text-amber-600 dark:text-amber-400`。✓ 可读。
- **默认分支标记**：目前仅渲染文字 pill「默认」（`text-muted-foreground border-slate-400/50`）。**代码注释声称"斜杠符号语义"（sequence-flow-edge.tsx:4）但并未在连线近 source 端画 BPMN 默认流的斜杠 tick**（走查 W-09）。规格：默认边应在起点侧加一道 45° 短斜线 marker（BPMN 惯例），文字 pill 可保留为辅助。
- **选中反馈**：仅 `strokeWidth 1.5→2`（sequence-flow-edge.tsx:50），无颜色变化，弱到几乎不可见（走查 W-10）。规格：选中边 `stroke: var(--primary)` + `strokeWidth 2.5`，标签 pill 加 `ring-1 ring-primary`。
- **标签优先级**：`isDefault` 时只显示「默认」，会吞掉同边的 condition 摘要（sequence-flow-edge.tsx:41-42）。规格：默认边不应再带条件（校验器已拦并行，但排它默认边若误配 condition 应在标签上并列提示，或校验 warning）。

### 1.5 调色板布局（`flow-palette.tsx` + `node-catalog.ts`）

- 结构：左栏 `w-40 shrink-0 border-r bg-muted/20`，顶部提示句，5 组（事件 / 任务 / 网关 / 自动决策 · 触发 / 结构 · 定时），组内每项一行按钮：`border bg-card rounded-md px-2 py-1.5`，`hover:border-primary/40 hover:bg-accent`，`cursor-grab / active:cursor-grabbing`，图标 `size-3.5` 着 `colorClass`，标签 `text-xs truncate`。
- **亮/暗**：`bg-card`/`bg-accent`/`border` 全走 token，两态自适应。✓
- **问题**：组标题与提示句 `text-[11px] text-muted-foreground`（flow-palette.tsx:18,21）在暗色下对比偏低（走查 W-06）；调色板图标色 `colorClass` 与画布节点头部色**多处不一致/撞色**（走查 W-01），破坏"调色板↔画布"一致性。

### 1.6 当前实现取色对照（撞色实证，供走查引用）

| 撞色 token | 占用者 A | 占用者 B（跨分类） | 位置 |
|---|---|---|---|
| violet | AI 审批（头 `bg-violet-500`） | 包容网关（菱形 violet） | node-catalog:73 / :82 |
| sky | 抄送（头 `bg-sky-500`） | 并行网关（菱形 sky） | node-catalog:72 / :81 |
| rose | 终止 end / 自动拒绝 / 边界定时 | 三者互撞 | node-catalog:65/:89/:100 |
| indigo | 子流程调用 | 定时 timerCatch | node-catalog:97 / :99 |
| Circle 图标 | 结束事件 | 包容网关 | node-catalog:64 / :82 |

---

## 第二部分 · 交互规范

### 2.1 拖拽落点

- **现状**：调色板 `onDragStart` 写 `PALETTE_DND_MIME=key`（flow-palette:11-14）；画布 `onDragOver` 校验 MIME 并置 `dropEffect="copy"`，`onDrop` 用 `screenToFlowPosition` 换算落点新增（canvas.tsx:55-71）。点击则在 `{480, 40+len*22}` 兜底位置新增（flow-designer:149-152）。✓ 机制完整。
- **规格补强**：
  - 拖拽悬停时画布应给**落区视觉反馈**（当前只改鼠标 cursor，无画布高亮）——建议 `onDragOver` 时给画布容器加 `ring-2 ring-primary/40 ring-inset`（走查 W-16）。
  - 落点应**吸附网格**：ReactFlow 未开 `snapToGrid`（canvas.tsx），而 Background 点阵 `gap=20`；新增/拖动节点位置随意 → DI 杂乱。规格：`snapToGrid + snapGrid={[20,20]}` 对齐点阵（走查 W-17）。
  - 点击新增的兜底位置 `40+len*22` 会随节点数线性下移、越堆越低且可能落在视口外——规格：改为落在当前视口中心（`screenToFlowPosition(视口中心)`）。

### 2.2 连线合法/非法即时反馈（配合 validate.ts）

- **现状**：`onConnect` 落线时调 `validateConnection`（同源同目标/结束出边/开始入边/边界入边/重复边），非法 → `toast.error("无法连接", {description: reason})`，合法 → `addEdge`（flow-designer:118-135）。✓ 有即时拒绝 + 文案。
- **缺口（走查 W-11）**：react-flow 未传 `isValidConnection`，因此**拖拽连线过程中没有实时合法性反馈**（无红/绿高亮、无禁止光标），用户要拖到松手才知道非法。规格：把 `validateConnection` 适配成 `isValidConnection(connection)`，拖拽中非法目标锚点显示禁止态（react-flow 会自动给 `.react-flow__handle-connecting` 上色，配 `--destructive`）。
- 合法连线**无正向确认**（仅静默添加）——可接受，但落线后可短暂高亮新边（`--primary` 0.4s）以确认。

### 2.3 选中态

- **节点**：`selected` → `ring-2 ring-primary ring-offset-2`（所有节点统一，node-chrome）。✓ 一致、跟随主色。
- **边**：仅描边 1.5→2px（W-10，见 §1.4），过弱，需加 `--primary` 描边。
- **单选驱动属性面板**：`selection = {kind, id}` 单选模型（flow-designer:96,108），点节点→属性面板对应分区，点边→条件编辑，点空白→流程属性。✓ 逻辑清晰。

### 2.4 多选

- **现状**：依赖 react-flow 默认（Shift 框选 / Ctrl 点选），删除走默认键（Backspace/Delete）。但 `selection` 是**单对象**模型，多选时属性面板只认最后一个，无批量操作面板。
- **规格**：多选时属性面板显示"已选 N 项"占位 + 批量删除按钮；框选矩形用 `bg-primary/10 border border-primary/40`（react-flow `selectionMode` 默认样式需在暗色下覆盖为 token）。优先级低（P3），先保证单选体验。

### 2.5 节点悬浮操作（删除/复制）—— 当前缺失（走查 W-12）

- **现状**：**无任何节点级悬浮操作**。删除只能靠键盘默认键，无复制/duplicate，无删除二次确认。`flow-designer` 未接 `onNodesDelete`。
- **规格（建议疾风新增）**：用 react-flow `NodeToolbar`（官方组件，零新依赖），节点 hover/selected 时在右上角浮出两个 icon 按钮（lucide `Copy` / `Trash2`，`size-3.5`，`bg-popover border rounded-md shadow-sm`）：
  - 复制：深拷贝 node.data、`genId`、`position` 偏移 `+24,+24`、立即选中新节点。
  - 删除：删节点 + 关联边；起点/终点等关键节点删除给 toast 确认或禁用。
  - 亮/暗：`bg-popover text-popover-foreground border-border`，hover 项 `bg-accent`，删除项 `text-destructive`。

### 2.6 画布缩放/对齐辅助

- **现状**：`<Controls showInteractive={false}>`（缩放+/-、fitView）；`fitView` 初始适配 `padding 0.25 maxZoom 1.2`；`minZoom 0.3 / maxZoom 1.8`；`Background Dots gap=20 size=1.2`（canvas.tsx:88-95）。✓ 基本齐。
- **缺口**：无 `MiniMap`（大流程无鸟瞰）；无 `snapToGrid`（§2.1）；无对齐辅助线（helper lines）。规格：加 `MiniMap`（`bg-card border`，节点色用家族色），暗色下 MiniMap mask 用 `--muted`。优先级低。

---

## 第三部分 · 走查问题清单（交主控转派疾风）

> 格式：`编号 | 文件:行 | 现状 | 期望 | 优先级`。优先级 P0=阻断/错误级视觉、P1=体系性、P2=一般、P3=增强。

### 视觉 / 色板体系

- **W-01 · P1** — `node-catalog.ts:72,73,81,82,89,97,99,100` · 14 类节点无分类色相，跨分类撞色：violet=AI+包容网关、sky=抄送+并行网关、rose=终止+自动拒绝+边界定时、indigo=子流程调用+定时（实证见 §1.6 表）。 · 期望：按 §1.1 目标色板收敛为 5 个色相家族，类内靠图标/形状区分；把 timerBoundary 移出 rose 归入 indigo 家族，rose 专留"异常终止/拒绝"。**属视觉方向决策，见 §5 分歧 A，需主控先拍板再改。**
- **W-02 · P2** — `flow-palette.tsx:37`（`item.colorClass`）vs 各 node 头部 `headerClass` · 调色板图标着色与画布节点头部色分别在 catalog 与 node 组件里各写一份，已出现不一致（如自动通过调色板 `emerald-600` 图标 vs start 的 `emerald-500`，语义都"绿"易混）。 · 期望：调色板 `colorClass` 与节点主色**由单一来源派生**（在 node-catalog 定义 `family` 字段，节点组件读同一 family token），保证"调色板↔画布"同色。
- **W-03 · P0** — `node-catalog.ts:63-100`（`makeData()` 均不含 `size`）+ `model.ts:36-38` · 调色板新增节点从不写 `size`，序列化省略；而 model 注释声明后端默认"事件30/网关40/任务100×60"，与实际渲染 48/68/208 不符 → 导出 BPMN 的 `BPMNShape` 尺寸错、连线锚点错位。 · 期望：`makeData()` 写入与渲染一致的 `size`（事件 48×48 / 网关 48×48 / 活动卡 208×自适应），或与磐石对齐后端默认值到同一组数。**需前后端一致，属数据正确性。**
- **W-04 · P2** — `node-chrome.tsx:20-26`（`NodeLabel`） · 圆/菱形节点下方名称 `whitespace-nowrap` 无 `max-w`/`truncate`，长名横向溢出，实测在紧凑布局下与相邻节点重叠。 · 期望：`max-w-[7rem] truncate`（或两行 `line-clamp-2`），居中。
- **W-05 · P2** — `sub-process-node.tsx:21`（`w-56`）vs `node-chrome.tsx:52`（`w-52`） · 子流程卡宽 224px，其余活动卡 208px，不齐。 · 期望：统一 `w-52`，或在规格里明确"结构类节点更宽"并把 callActivity 也加宽（二选一，别只差一个）。
- **W-06 · P2** — `flow-palette.tsx:18,21` · 调色板组标题/提示句 `text-[11px] text-muted-foreground`，暗色下对比偏低。 · 期望：组标题升为 `text-xs font-medium text-foreground/80`；提示句保持 muted 但升到 `text-xs`。
- **W-07 · P2** — `summary.ts:81`（`it.field`）· 边条件摘要 / 节点摘要显示原始字段 **key**（实测画布显示"days 大于 3"）而非表单 **label**（"请假天数"）。 · 期望：`summarizeCondition` 接收 `formFields` 映射（`key→label`），显示 label；节点组件把 `SAMPLE_FIELDS`/真实 manifest 传入。
- **W-08 · P3** — `end-event-node.tsx:24` + `inclusive-gateway-node.tsx:14` · lucide `Circle` 同时用于"结束事件"与"包容网关"，调色板扁平列表里两者图标近似。 · 期望：包容网关改用更贴合"包容/或"的图标（如 `CircleDot` 或 `GitBranch`），与结束圆区分。

### 边

- **W-09 · P2** — `sequence-flow-edge.tsx:4,41-64` · 注释声称默认分支"斜杠符号语义"，实际只画文字 pill「默认」，无 BPMN 默认流斜杠 tick。 · 期望：默认边 source 端加 45° 短斜线 marker（BPMN 惯例），文字 pill 作辅助。
- **W-10 · P1** — `sequence-flow-edge.tsx:50` · 边选中仅 `strokeWidth 1.5→2`，无颜色变化，实测几乎不可辨。 · 期望：`selected` 时 `stroke: var(--primary)`、`strokeWidth 2.5`，标签 pill 加 `ring-1 ring-primary`。

### 交互

- **W-11 · P1** — `canvas.tsx:75-93`（未传 `isValidConnection`）· 连线合法性只在松手落点判定（toast），拖拽过程中无实时红/绿反馈。 · 期望：把 `validateConnection` 适配为 `isValidConnection`，拖拽中非法锚点用 `--destructive` 高亮/禁止光标。
- **W-12 · P1** — `flow-designer.tsx`（无 `onNodesDelete`、无节点工具条）· 无删除/复制的悬浮操作，删除仅靠键盘，无复制、无关键节点删除保护。 · 期望：用 react-flow `NodeToolbar` 加 复制(`Copy`)/删除(`Trash2`) 两按钮（见 §2.5 规格，样式走 popover/accent/destructive token）。
- **W-13 · P2** — `canvas.tsx`（无 `snapToGrid`）· 节点拖动/新增不吸附，Background 点阵 `gap=20` 形同虚设，位置杂乱污染 DI。 · 期望：`snapToGrid snapGrid={[20,20]}`。
- **W-16 · P2** — `canvas.tsx:55-60`（`handleDragOver` 仅置 dropEffect）· 拖拽调色板悬停时画布无落区高亮。 · 期望：拖拽悬停给画布容器 `ring-2 ring-primary/40 ring-inset`。
- **W-17 · P3** — `flow-designer.tsx:150`（`40+nodes.length*22`）· 点击新增位置随节点数线性下移，越堆越低、可能落视口外。 · 期望：落在当前视口中心。

### 校验错误呈现

- **W-14 · P0** — `flow-designer.tsx:256-284` · 校验错误只在画布上方列成文字清单，`issue.nodeId/edgeId` 未用于**在画布上高亮对应节点/边**，点击 issue 不选中不定位；旧 bpmn 设计器的 `.oa-error` 高亮（`index.css:205-213`）在新设计器丢失。 · 期望：① 有 error 的节点/边在画布上加错误环（`ring-2 ring-destructive` / 边 `stroke: var(--destructive)`）；② issue 列表项可点击 → 选中并 `fitView` 居中该元素；③ error 用 `text-destructive` 而非硬编码 `text-rose-600`（当前 flow-designer:242,269,282 用 rose 硬编码，未走 `--destructive` token）。
- **W-15 · P2** — `flow-designer.tsx:242,269-282` · 校验/往返状态色硬编码 `text-rose-600 / text-emerald-600 / text-amber-600`，不走 token（`--destructive` 等），主题换色时不联动。 · 期望：error→`text-destructive`，warning→`text-amber-600 dark:text-amber-400`（Tailwind 无语义 warning token，amber 双态是既有约定，见 `types.ts` WF_STATUS_META），success→沿用 emerald 双态。

### 术语 / 文案（与 types.ts / api-contract 对齐）

- **W-18 · P2** — `node-catalog.ts:89`（"自动拒绝"）vs `summary.ts:43`（返回"自动驳回"）vs `types.ts:129`（`reject: 驳回`）· 拒绝/驳回混用。 · 期望：统一为**驳回**（与 types `reject` 一致）：调色板"自动驳回"、节点/摘要"自动驳回"、defaultName 同步。
- **W-19 · P2** — `flow-designer.tsx:233-235,354-360` · 页面标题"下一代流程设计器（切片 2）"、"序列化 ProcessModel"、"往返一致✓/往返不一致✗"、JSON 详情面板等**开发脚手架文案**暴露在 UI。 · 期望：正式设计器隐藏这些自检 UI（或收进 dev-only 开关）；标题回归"流程设计器"，术语面向业务用户。
- **W-20 · P2** — `flow-designer.tsx:99-103` + `shared/property-panel.tsx` · `panelNodeType` 把 ai/webhook/timer/serviceTask/callActivity 都落到"通用（仅节点名）"，这些节点画布摘要显示"未配置模型/未配置回调地址"，但用户点开属性面板**无对应 config 编辑 UI，成死胡同**（已知延后项，flow-designer:15）。 · 期望：即便深度编辑延后，属性面板也应对这些类型显示"该节点配置将在后续版本开放"占位说明，而非空白，避免用户以为面板坏了。

### 空态 / 加载

- **W-21 · P2** — `canvas.tsx` / `flow-designer.tsx` · `nodes=[]` 时画布只剩点阵，无引导。 · 期望：空画布居中显示引导（lucide `MousePointerClick` 图标 + "从左侧拖拽节点开始搭建流程" `text-muted-foreground`），有节点后消失（见 §4 空态规格）。
- **W-22 · P3** — `flow-designer.tsx`（demo 用 SEED 直载，无加载态）· 未来接真实 `processDef` 拉取时无骨架屏。 · 期望：加载中画布区显示 skeleton（`animate-pulse bg-muted` 占位卡 + 居中 spinner），失败走既有 NetworkError 降级 banner 模式（对齐 CLAUDE.md 的离线降级约定）。

---

## 第四部分 · 空态 / 加载 / 校验错误提示 视觉

### 4.1 空态（空画布）

```
             ┌─ 居中，绝对定位于画布中央，pointer-events-none ─┐
             │   [MousePointerClick size-8 text-muted-foreground/60]   │
             │   从左侧拖拽节点开始搭建流程                              │  text-sm text-muted-foreground
             │   或点击调色板条目在画布中央新增                          │  text-xs text-muted-foreground/70
             └───────────────────────────────────────────┘
```
- 触发：`nodes.length === 0`。有节点即隐藏。
- 亮/暗：全 `text-muted-foreground` 系，两态自适应；不加实底，浮在点阵上。

### 4.2 加载态

- 画布区：3-4 个 `w-52 h-16 rounded-lg bg-muted animate-pulse` 占位卡，错落摆放 + 居中 `Loader2 animate-spin text-muted-foreground`。
- 属性面板：`shared/` 已有面板骨架则复用；否则 3 行 `h-9 bg-muted rounded animate-pulse`。
- 失败：不自绘错误页，走项目既有 `NetworkError`/`offline` 降级（顶部 banner + 只读种子），与其它页面一致（CLAUDE.md `src/lib/api.ts` 约定）。

### 4.3 校验错误呈现（双通道：清单 + 画布锚定）

- **清单（现有，需改造）**：`flow-designer.tsx:256-284` 的列表保留，但：
  - error 图标 `AlertTriangle text-destructive`、warning `Info text-amber-600 dark:text-amber-400`（走 token，改 W-15）。
  - 每条**可点击** → 选中 `issue.nodeId||edgeId` 对应元素并 `fitView` 居中（补 W-14②）。
  - 顶部汇总：`共 N 个错误 · M 个提示`，error>0 时"序列化/保存"按钮 `disabled` 并 tooltip"请先修复 N 个错误"。
- **画布锚定（缺失，需新增）**：
  - 错误节点：`ring-2 ring-destructive ring-offset-2`（复用 selectedRing 结构，色换 destructive）。
  - 错误边：`stroke: var(--destructive)`、`strokeWidth 2`，标签 pill `border-destructive text-destructive`。
  - warning 级：节点右上角小圆点 `bg-amber-500`（`size-2`），不占满环，与 error 区分。
  - 亮/暗：`--destructive` 双态自带（`index.css:22,57`）。
- **即时连线错误（已有）**：`toast.error` 保留（flow-designer:129），另加拖拽中 `isValidConnection` 红态（W-11）。

---

## 第五部分 · 需主控拍板的视觉方向分歧

- **分歧 A（必须先定，阻塞 W-01）· 网关是否统一色相**
  - 方案 A1（推荐）：三类网关统一 **amber 家族**，靠图标 X/＋/◯ 区分。理由：BPMN 里网关是同一大类，统一色 + 图标符合规范直觉，且腾出 sky/violet 给别处消撞色。
  - 方案 A2：保留每类网关独立色（exclusive=amber / parallel=sky / inclusive=violet），靠颜色强化"这是三种不同网关"，但需把 AI 从 violet、抄送从 sky 挪走以消跨类撞色。
  - 影响面：A1 改 2 个网关节点配色；A2 改 AI + 抄送 + OA 服务家族配色。二者都不新增设计语言，**但改动范围不同，需主控选定后疾风一次性落地**。

- **分歧 B（次要）· OA 服务扩展（cc/ai/webhook）是否收敛为单一 teal 家族**
  - 收敛：三者同 teal，靠 `Send/Sparkles/Webhook` 图标区分（灰度友好、体系干净），但弱化"AI 很特别"的视觉存在感。
  - 不收敛：AI 单独给一个显眼色（如 violet，前提是网关走 A1 让出 violet）以突出 AI 能力。
  - 建议：若分歧 A 选 A1（网关统一 amber），则 violet 空出，B 可选"AI=violet 单列、cc/webhook=teal"，兼顾体系与 AI 辨识度。请主控在 A 定后一并定 B。

术语类（W-18 拒绝/驳回、W-19 脚手架文案）不涉方向分歧，按上述期望直接改即可，无需拍板。
