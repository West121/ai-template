# 开发者工作台(Dev Studio)· 产品/交互设计(丹青)

> 主控立项:面向平台**热资产**(运行期解释、发布即生效、无需 CI/CD 的定义类资产)提供 **IDE 式统一编辑体验 + AI 改写**。
> 首期资产范围:自动化编排(`orch_flow.designer_json`)、流程定义(`wf_process_ext.designer_json` GRAPH)、
> 在线表单(`wf_form_def.schema_json`)、打印模板(`oa_bizdoc_print_tpl.content` = 前端 `BdTemplateV2`)。
> **不做源码热改**(安全红线,§4);远期出口仅一句:AI 可生成「变更包/PR」交人工走 CI/CD,本工作台不落地。
>
> 本文照 `docs/design/` 现有文档体例:**现状查证(读代码,不臆测)→ 设计 → 分批 → 红线**。只写设计,疾风/磐石照做。
> 核心口径:**不造新组件风格**——复用 `CodeEditor`、AI 卡片体系(confirm 卡 + 动作草稿二段式)、版本抽屉、`diff-util`、
> shadcn `ui/*` 与 token 配色;新增只有「三栏工作台壳 + 资产读写门面 + 一张 devDiff 卡 + 一层版本快照(见 §3/§7)」。

---

## 0. 现状查证(逐条读码核过,给出文件/行号/端点)

### 0.1 四类热资产的真实生命周期 —— ⚠️「保存即生效」只对一类成立

磐石侧逐个实体核过。**关键真相:只有「随单打印模板·就地改」是真·保存即生效;其余三类都是 `保存(草稿)→发布(生效)` 两段,且只有编排有快照历史 + 回滚。** 这直接决定工作台的「保存/发布」语义(§1.4)与「版本/回滚」能做到什么程度(§3)。

| 资产 | 实体 / 表 | 可编辑 JSON 列 | 版本列 | 历史表 | 回滚 API | 保存即生效? | 发布动作 |
|---|---|---|---|---|---|---|---|
| 自动化编排 | `OrchFlow` / `orch_flow` | `designer_json`(+ `el_expr` 编译缓存) | `version`(0=未发布) | **`orch_flow_version`(有)** | **有** `/versions/{v}/rollback` | 否——运行走已发布 `el_expr` | `POST /api/orch/flows/{id}/publish`(编译+版本+1+快照) |
| 流程定义 | `WfProcessExt` / `wf_process_ext` | `designer_json`(GRAPH/DINGTALK/BPMN)+ `bpmn_xml` | 无(交 Flowable) | 无(Flowable `ACT_RE_PROCDEF`) | 无(引擎内) | 否——发布=重部署引擎 | `POST /api/wf/models/graph/deploy`(转 BPMN 部署) |
| 在线表单 | `WfFormDef` / `wf_form_def` | `schema_json` | `version`(`code+version` 唯一) | 无(行即版本) | 无 | 否——`DRAFT→PUBLISHED`,已发布行**不可改** | `POST /api/wf/form-defs/{id}/publish` |
| 打印模板 | `BizDocPrintTpl` / `oa_bizdoc_print_tpl` | `content`(= `BdTemplateV2` 元素树) | `version`(发布计数) | 无 | 无 | 随单(就地改)是 / 独立(`/tpls`)否 | 独立:`POST /api/bizdoc/tpls/{id}/publish`(version+1) |

补充(核码结论,写入设计约束):
- `OrchFlowService.update()` **不**重编译、不+版本;`publish()` 才 `compiler.compile→el_expr→version+1→snapshotVersion→cronScheduler.refresh`。`OrchExecService` 运行期硬闸:`version<=0 || 无 el_expr → 400「编排未发布,请先发布」`。
- `wf_process_ext` 每 `def_code` 仅存**最新**一行,发布覆盖 `designer_json/bpmn_xml/latest_deployment_id`;历史/图在 Flowable。GRAPH 一步发布走 `/api/wf/models/graph/deploy`(upsert+转换+部署)。
- `wf_form_def`:同 `code` 新版本=新 `DRAFT` 行(`create()`),`update()` 只允许改 `DRAFT`,改已发布报 `400「已发布的表单不可修改,请创建新版本」`;消费方绑定 `formCode:formVersion` 定版,发布新版不回溯老流程。
- `BizDocPrintTpl`:`BdTemplateV2` 是**前端 TS 模型**(`web/src/components/bizdoc/model-v2.ts:220`,`{schemaVersion:2, page, blocks, calc?}`),存 `content` 列;后端无 `BdTemplateV2` 类。独立模板 `create()` 起 `DRAFT version=0`,`publish()` → `PUBLISHED version+1`;运行渲染只认 `PUBLISHED`。

> **设计含义(§7 分叉点 1、2):**「统一保存即生效」是错觉;工作台必须按资产各自的 `草稿/发布` 生命周期建模,把「立即生效」的警示与确认挂到**发布/部署**动作上。「统一版本 + 回滚」当前只有编排现成,其余三类要么加快照表,要么工作台自建一层非侵入式快照(§3.3 提案)。

### 0.2 设计器入口现状(工作台「用设计器打开」跳这些)

| 资产 | 设计器路由 | 从哪打开 | 形态 | 写权限码 |
|---|---|---|---|---|
| 编排 | `/automation/:code/design`(新建 `/automation/new/design?code=&name=`) | `pages/automation/index.tsx` 行操作/新建 | **整页** | `orch:flow:write` |
| 流程 | `/workflow/defs/:code/design`(新建 `/workflow/defs/new?type=&formCode=…`) | `pages/workflow/defs.tsx` `openDesign` | **整页** | `wf:def:edit` |
| 表单 | **无独立路由**——`FormDesignerCore` 装在 `pages/workflow/form-defs.tsx` 的全屏 `<Modal>`(1180×720) | `/workflow/form-defs` 列表 | **弹窗** | `wf:def:edit` |
| 打印模板 | `/bizdoc/tpl/t/:tplId`(独立)、`/bizdoc/tpl/:defCode/:tplId`(绑定) | `pages/bizdoc/tpls-page.tsx` 卡片/新建 | **整页** | `bizdoc:def:write` |

整页设计器统一壳(工作台编辑区、版本抽屉直接照抄这套,§1.2):
```tsx
// automation/designer-page.tsx:386、workflow/designer-page.tsx:600、bizdoc/tpl-designer/index.tsx:360 一致
<div className="-mx-4 -my-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden md:-mx-5 md:-my-5">
  {/* 顶部条 h-14 shrink-0 border-b bg-background/95 px-3 backdrop-blur:退出|名称|徽标|保存态 … ml-auto 校验/整理/版本/保存/发布 */}
```
`-mx/-my` 抵消 `app-layout` 的 `p-4 md:p-5`,`calc(100dvh-6.5rem)` 让位头部+标签栏。**无 chrome-less/沉浸模式**——唯一在 `AppLayout` 之外的路由是 `/login`;「整页工具」= 用负边距铺满 Outlet,侧栏/头部/标签栏保留。

编排设计器已内建**版本历史抽屉**(`VersionsDrawer`,`automation/designer-page.tsx:52`,§9.5):`Drawer` + 版本列表 + 展开看快照 + 回滚(`window.confirm` + toast「回滚到 vN(新版本 vM)」)。工作台版本侧滑(§3)直接复用其信息结构。

### 0.3 `CodeEditor` 能力(编辑区中心组件,零改动可用)

`web/src/components/code-editor.tsx` + `web/src/lib/code-editor-cm.ts`(CodeMirror 6 封装):
- 语言:`json | javascript | typescript | tsx | java | sql | groovy | python | expression | text`;`json` 带 autocomplete + **实时 lint 标红**。
- 行号 / 语法高亮 / 括号匹配·自动闭合 / 撤销重做;`readOnly`(虚线框弱化);`expandable`(右上角放大 → 项目 `Modal`,可拖拽/全屏/伸缩,内嵌同一受控编辑器)。
- 主题跟随 `app-store.themeMode`(`isDarkMode`)自动明暗;`fill` 撑满父容器(弹窗内用)。
- **防白屏内建**:`value` 非字符串一律归一为字符串;扩展工厂无副作用、组件轻量可 lazy。
- `extraExtensions`(需 `useMemo` 稳引用)可挂补全上下文——脚本节点已用它接 ScriptService 上下文补全。

`/demo/code-editor`(`SquareCode` 图标,`menu.ts` 已 import)是现成演示页。**结论:JSON 类资产直接 `<CodeEditor language="json" lint expandable>`,不新造编辑器。**

### 0.4 AI 助手 V2 与「动作草稿二段式」(diff 卡是唯一净新件,其余全可复用)

**面板(前端)**:全局 FAB + 桌面**非模态右侧停靠面板**(`components/ai-chat/assistant.tsx` 全局挂在 `app-layout.tsx:194`,非路由;`window` 事件 `"ai:open"` 可唤起;宽度拖拽持久化 `localStorage:ai-panel-width`,可全屏)。会话体 `chat-view.tsx`:消息流 + composer;助手消息渲染 markdown + `parts`(V2)/`cards`(旧),每卡包 `CardBoundary` 隔离。

**卡片协议**:`protocol.ts` `PART_TYPES` 白名单(`text/navigate/form/confirm/list/chart/approval/status/error/plan/flowDraft/templateDraft/formDraft/knowledgeSave/manage_form`)+ `PART_SCHEMA_SUPPORT` 版本天花板;`resolvePart()` 白名单+版本校验,超纲降级不白屏;`part-router.tsx` 按 `partType` 分发,`navigate/form/confirm/list/chart` 经 `partToCard()` 回落到 `card-router.tsx` 六类卡。**加一类卡 = 白名单加一项 + 路由加一支 + 后端工具 `ToolResult` 吐该 card payload。**

**二段式动作草稿(核心可复用基座)**:
- 前端确认卡状态机 `cards/confirm-machine.ts`(纯 reducer,可测):`ConfirmState = "idle"|"submitting"|"executing"|"done"|"cancelled"|"expired"|"stale"`;终态 `done/cancelled/expired/stale`。
- `cards/confirm-card.tsx`:`ConfirmCard` 驱动 reducer;确认时生成一次 **ULID `Idempotency-Key`**(重试沿用)`POST /api/ai/actions/{id}/confirm`;`danger` 红色左描边 + destructive 键;`aiSummary`/`predictChain` 选渲。
- 「重挂不复活」:`stores/ai-action-outcomes.ts` 模块级 zustand,按 `actionId/draftId/partId` 记终态(`done/cancelled/expired/stale/submitted`),关面板重开不回到可点态。
- 后端 `ai_action_draft`(`AiActionService`):`PENDING_CONFIRM→CONFIRMED→EXECUTING→SUCCEEDED|FAILED`,旁支 `CANCELLED/EXPIRED`;10 分钟 TTL、`payloadHash`(SHA-256)、`targetVersion/expectedStatus`(TOCTOU)、`idempotencyKey`、乐观锁 `version`;`stage()` 落草稿、`confirm()` 九点重校验(归属/未过期/功能权限/数据权限/对象版本/业务状态/payload 未变/幂等键/原子 claim 防双击)后由 `registerExecutor(toolName, fn)` 在**确认者 UserContext** 下执行(过 `@PreAuthorize`/数据权限)。

**工具注册(后端)**:`@AiToolDefinition(name/description/paramsSchema/required/authorities/risk/timeout/aliases)`;`AiToolRisk = READ_ONLY | EXPLICIT_UI_SUBMIT | CONFIRM_REQUIRED | PROHIBITED`;`ToolRegistry` 扫 `com.xingchen.oa.boot.ai` 包内 Bean;`AiToolGateway` 是执行咽喉(权限重校验/超时虚拟线程/8k 截断/审计 `ai_tool_call`);`ToolResult(llmContent, cards, citations)`——**卡由服务端组装,模型只出解释文本,不能编 actionId/path/权限码**。命名 `{domain}_{verb}_{object}` 蛇形;写类 `{domain}_prepare_{object}`。**已存在** `orchestration_prepare_flow`、`form_prepare_schema`、`bizdoc_prepare_template`(自然语言→草稿→去设计器,`cards/draft-cards.tsx`)——但它们是「去设计器继续编辑」的轻草稿,**不是 diff 改写**。

**diff 卡:净新件。** 全仓 grep `diff/修改前/对比/before/after` 确认:`components/ai-chat/**` **零** diff 渲染;唯一 diff 实现是**与 AI 无关**的知识库版本历史 `pages/knowledge/diff-util.ts`(`buildLineDiff`,LCS 行级,`DiffOp{type:same|add|del,text}`)+ `version-history.tsx`。**结论:工作台要的「改写前后 diff 确认卡」需新建一个 `partType`(建议 `devDiff`)+ 组件,复用 `confirm-machine` + `ai-action-outcomes` + `buildLineDiff`。**

### 0.5 菜单 / 路由 / 权限门控现状

- `MenuItem`(`config/menu.ts:54`)**无 `perm` 字段**——菜单可见性不做权限门控,门控在页内 `useHasPerm(code)`。`hasPerm/useHasPerm`(`auth-store.ts:167`):`permissions===null`(离线)= 全部允许。
- 加 `/dev-studio`:App.tsx 顶 `lazy()` import + `<Route path="dev-studio" element={<DevStudioPage/>}/>`(挂在 `RequireAuth/AppLayout` 的 `path="/"` 块下,与 `contacts` 同级)+ `menuTree` 加一项 `{ title:"开发工作室", path:"/dev-studio", icon: SquareCode }`(`SquareCode` 已 import)。菜单与路由各自登记。
- **无通用「受信」布尔位**;受信落在具体码:`wf:script:write`(脚本/事件监听/受信动作,V18 仅授 ADMIN)、`orch:flow:write`(V25 注释「受信,含脚本/HTTP/LLM 配置,同 `wf:script:write` 级」)。字面「受信码」全仓不存在。诚实措辞在 `components/script-editor.tsx`(「以应用完整权限运行、非沙箱、等同受信代码」)。
- **`dev:studio:view` 不存在,需新增**:Flyway 迁移仿 V18/V25 `insert sys_permission (0,'dev:studio:view','开发工作室查看','BUTTON')` + `sys_role_permission` 授 ADMIN;页内 `useHasPerm("dev:studio:view")` 门控。

### 0.6 防白屏基座(照 CLAUDE.md 反白屏四条)

- 路由级 `ErrorBoundary key={pathname}`(`app-layout.tsx:124`)自动裹每页,含未来 `/dev-studio`。
- 重型岛屿附加自身 `ErrorBoundary`(`components/error-boundary.tsx`,含「重试」重置):编排设计器裹画布 `key={eb-${id}-${version}}`。工作台三栏各自成岛(资产树/编辑区/AI 栏),各包一层。

---

## 1. 整体布局与信息架构

### 1.1 顶级页 `/dev-studio` · 挂载 · 门控

- 路由:`web/src/pages/dev-studio/index.tsx`(默认导出 `DevStudioPage`),`App.tsx` lazy + `<Route path="dev-studio">`。
- 菜单:`menuTree` 顶级一项 `{ title:"开发工作室", path:"/dev-studio", icon: SquareCode }`(放「自动化编排」附近,同属平台工程能力)。**因 `MenuItem` 无 `perm` 字段,菜单默认全员可见;门控在页内**——无 `dev:studio:view` 权限 → 整页渲染「无权访问」空态卡(不进编辑,§4)。是否给 `MenuItem` 补 `perm` 字段做菜单级隐藏,见 §7 分叉点 5。
- 权限:页 = `dev:studio:view`(新增受信码,视图门槛);**具体写操作仍走各资产既有码**(`orch:flow:write` / `wf:def:edit` / `bizdoc:def:write`)——工作台不新授写权,只做统一编辑面。无对应写权的资产在树里**只读**(可看不可存,保存/发布/AI 改写按钮 disabled + tooltip「需 xxx 权限」)。

### 1.2 三栏布局(资产树 | 编辑区 | AI 助手栏)

沿用整页设计器的负边距铺满壳 + `h-14` 顶部条,主体三栏:

```
/dev-studio(负边距铺满 Outlet;侧栏/头部/标签栏保留)
┌ 顶部条 h-14 border-b bg-background/95 px-3 backdrop-blur ─────────────────────────────────┐
│ [退出→/dashboard] │ 开发工作室  ·  <当前资产名 若打开>  <草稿/已发布 vN 徽标>  <未保存●/已保存✓>   │
│                                   ml-auto  [格式化] [校验] [版本] [用设计器打开] [保存草稿] [发布]  [⟨AI⟩折叠]│
└──────────────────────────────────────────────────────────────────────────────────────────┘
┌ 左·资产树 ─────┐┌ 中·编辑区 ────────────────────────────┐┌ 右·AI 助手栏 ──────────┐
│ w 组织宽 260   ││ min-w-0 flex-1                        ││ w 360(可拖 / 可折叠)   │
│ shrink-0       ││ ┌ 内部标签(W3 多开)─────────────┐   ││ 会话式(复用 ChatView)  │
│ rounded-lg     ││ │ leave.v3 ×  sync_users ×  …     │   ││ + devDiff 卡           │
│ border bg-card ││ └────────────────────────────────┘   ││ 上下文:当前资产已注入   │
│ 搜索           ││  CodeEditor(json, lint, fill)         ││ 「把请假天数阈值改成5」  │
│ 分组树+状态徽标 ││  只读预览态 / 编辑态(见 §1.4)         ││  → 读→propose→diff 卡   │
│  ┊可拖分隔     ││  底部状态行:行:列 · JSON 有效性 · 字节  ││                        │
└────────────────┘└──────────────────────────────────────┘└────────────────────────┘
```

尺寸/交互(全走 token,明暗自适应):
- 外层 `-mx-4 -my-4 md:-mx-5 md:-my-5 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden`。
- 三栏 `flex min-h-0 flex-1`;左树 `w-[260px] shrink-0 rounded-lg border bg-card`、编辑区 `min-w-0 flex-1`、AI 栏 `w-[360px] shrink-0 border-l`(可拖 `[320, 560]`、可折叠;折叠后顶部条 `⟨AI⟩` 复原)。
- **可拖分隔 + 持久化**:左树右缘、AI 栏左缘各一根 `w-1 cursor-ew-resize`(hover `bg-primary/40`),复用 `drawer.tsx` pointer 手感;宽度存 `app-store`(与 AI 面板宽度同一持久化层,别裸 localStorage,呼应系统管理规范裁定)。
- **全屏**:顶部条 `Maximize2` 切「编辑区全屏」(隐左树/AI 栏,画布最大化;`Minimize2` 复原)——照 AI 面板全屏做法。
- **防白屏**:左树 / 编辑区 / AI 栏各包一层 `ErrorBoundary`(key 含资产 id + version),一侧脏数据只塌一侧。

### 1.3 左·资产树(按类型分组 · 搜索 · 状态徽标)

```
┌ 顶部搜索 px-2 py-2 border-b ──────────────┐
│ 🔍 [搜资产名/编码__________]  [⟳刷新]      │  ← 全类型跨组过滤 + Highlight
├ 工具栏 px-2 py-1.5 border-b ──────────────┤
│ [全部][草稿][已发布] 过滤片  ml-auto [+新建▾]│  ← 状态过滤 chips;新建下拉按类型
├ 分组树 overflow-y-auto flex-1 ────────────┤
│ ▾ 自动化编排                     (12)      │  ← 组头:类型名 + 计数;可折叠
│    · sync_users        已发布 v4          │
│    · notify_daily      草稿                │  ← 选中:bg-primary/10 text-primary + 左2px主色条
│ ▾ 流程定义                       (8)       │
│    · leave_approval    已发布 · GRAPH      │  ← 方言徽标(GRAPH 可编 / DINGTALK·BPMN 只跳设计器)
│ ▾ 在线表单                       (15)      │
│    · leave_form        已发布 v3          │
│ ▾ 打印模板                       (6)       │
│    · gw_send_tpl       草稿 v0            │
└───────────────────────────────────────────┘
```
- **分组固定四类**(可扩展):自动化编排 / 流程定义 / 在线表单 / 打印模板。远期 `单据定义(oa_bizdoc_def.form_schema)` 同模式可加(§7)。
- **状态徽标**:`草稿`(amber `bg-amber-500/10 text-amber-600`)/ `已发布`(emerald)+ `vN`(`font-mono text-[11px] tabular-nums`)。流程定义额外标方言(`GRAPH/DINGTALK/BPMN`);**仅 GRAPH 在编辑区可 raw-json 编辑,DINGTALK/BPMN 树里点开=只读预览 + 只给「用设计器打开」**(避免手改钉钉/BPMN 方言 JSON 结构崩坏)。
- 选中即在编辑区打开(默认只读预览态)。列表数据经 `useApiData`/归一化(`{list}`|`[]` 兜底),空/异常 → 空态「暂无资产」不抛。
- 新建下拉按类型跳原新建流(不在工作台内造资产骨架):编排 `/automation/new/design`、流程 `/workflow/defs/new`、表单 `/workflow/form-defs`(开弹窗)、打印模板 `/bizdoc/tpls`。工作台聚焦「改」,「从零建」交原设计器。

### 1.4 中·编辑区(CodeEditor(json) · 只读/编辑态 · 保存/发布语义)

**双态**:
- **只读预览态(默认打开)**:`<CodeEditor language="json" readOnly value={pretty(content)} />` + 顶部「资产元信息条」(类型/编码/版本/发布状态/最近编辑人时间)。DINGTALK/BPMN 流程、无写权资产**只有**此态。
- **编辑态**:点顶部条「编辑」进入 → `readOnly=false`,`lint` 开,`expandable`。改动置 `dirty`(顶部条「未保存●」amber)。

**保存/发布(严格按资产各自生命周期,§0.1)——把「立即生效」挂到发布**:

| 动作 | 语义 | 落到端点 | 生效面 |
|---|---|---|---|
| **格式化** | JSON pretty-print(不改语义) | 纯前端 | — |
| **校验** | `JSON.parse` + 该资产 schema 轻校验(节点/字段结构)+ 引用完整性 | 前端(可选后端 dry-run) | — |
| **保存草稿** | 写 `designer_json/schema_json/content`,不生效 | 编排 `PUT /api/orch/flows/{id}`;流程 `PUT /api/wf/process-defs/{id}`;表单 `POST /api/wf/form-defs`(已发布→新 DRAFT 版);打印模板 `PUT /api/bizdoc/tpls/{id}` | 无 |
| **发布** | 编译/部署/置 PUBLISHED,**立即对新发起生效**(运行中实例不受影响) | 编排 `/publish`(编译 EL);流程 `/api/wf/models/graph/deploy`(转 BPMN 部署);表单 `/form-defs/{id}/publish`;打印模板 `/tpls/{id}/publish` | 立即 |
| **用设计器打开** | 跳原可视化设计器(新标签或同页 navigate) | §0.2 各路由 | — |

- **发布前二次确认**(`AlertDialog`,危险语义随资产):编排「将重新编译为 LiteFlow EL 并缓存,**立即对新触发生效**」;流程「将转 BPMN 重部署到引擎,**新发起走新版本**,运行中实例不变」;表单「发布后该版本冻结不可改,消费流程按 `code:version` 定版」;打印模板「发布 vN,渲染即用此版」。发布报错(编译/部署失败)照设计器现状**内嵌红条展开** `whitespace-pre-wrap font-mono` 明细。
- **底部状态行**:`行 L:列 C · JSON ✓有效/✗第 N 行 · <字节数>`;JSON 非法时**禁用保存/发布**并高亮 lint 行。
- **离开拦截**:`dirty` 时切树/退出走 `AlertDialog`(保存并离开 / 不保存 / 取消),照流程设计器 `leaveOpen` 做法。

> **raw-json 编辑的护栏(红线级)**:图/版式类资产(编排、GRAPH 流程、打印模板)天然由设计器管理其 JSON,手改易破坏结构。工作台的 raw-json 编辑面向**受信开发者 + AI 定点改字段**,故:① 保存前**强制 `parse + schema 校验**`,不过不落库;② 明显结构性资产默认引导「用设计器打开」;③ 表单 `schema_json` 是最适合 raw-json 直编的(结构平),作为直编主场景。

### 1.5 右·AI 助手栏(会话式改写 · 上下文绑定当前资产)

**决策:嵌入一个「作用域绑定当前资产」的 ChatView 实例作为第三栏,而非复用全局悬浮面板。** 理由:全局面板是 app 级、无资产上下文;工作台的 AI 必须默认对「当前打开的资产」动刀。做法:
- 复用 `chat-view.tsx` + 卡片体系 + `ai-chat/api.ts` 流式;新建 `pages/dev-studio/assistant-pane.tsx` 薄壳,开一个**独立会话**并注入系统上下文 `{ assetType, assetId, assetCode, currentVersion, contentHash }`,使 `dev_propose_change` 默认指向当前资产。
- 全局悬浮助手仍在(app 级),工作台用自己这一栏;二者会话不混。
- 典型链路:用户「把请假流程的天数阈值改成 5」→ 模型 `dev_read_asset`(读当前资产)→ `dev_propose_change`(产新内容/补丁,后端 `stage` 一条 `ai_action_draft`)→ 吐 **devDiff 卡**(§2)→ 用户确认 → `POST /api/ai/actions/{id}/confirm` → 注册执行器在确认者身份下写新版本(草稿或直接发布,见 §2 危险提示)→ 成功态 +「查看版本」。
- 栏内也放几枚常用**提示 chips**(基于当前资产类型):如流程→「加一级审批」「改分支条件」;表单→「加一个必填字段」;编排→「改 CRON」。点击填入输入框。

---

## 2. diff 确认卡(devDiff · 唯一净新卡)

**新增一类卡,不复用现成六类;但完全复用二段式基座。**

### 2.1 后端:工具 + 草稿 + 执行器

三个新 `@AiToolDefinition`(包 `com.xingchen.oa.boot.ai`,自动被 `ToolRegistry` 扫到):

| 工具 | risk | authorities | 说明 |
|---|---|---|---|
| `dev_list_assets` | `READ_ONLY` | `dev:studio:view` | 列可编辑热资产(名/编码/类型/状态/版本,list 卡);入参 `type?`/`keyword?`,最多 50 行 |
| `dev_read_asset` | `READ_ONLY` | `dev:studio:view` | 读某资产当前内容+快照版本+nativeVersion;入参 `assetType`+`code`;content>6k 截断标 `contentTruncated`(完整基线由 propose 服务端自取,不依赖模型回传) |
| `dev_propose_change` | `CONFIRM_REQUIRED` | `dev:studio:edit`(暴露门;资产写码在 propose 预检 + confirm 复验) | 产「变更提案」:入参 `{assetType, code, newContent(完整内容,非 patch), summary, publish?}`;**服务端**读当前内容作 `oldContent`、当前快照版本作 `baseVersion`(TOCTOU 基线);**propose 先干跑校验 newContent**(PROCESS 转换/各类 JSON parse)+ 资产写码预检,坏内容/无权 → error 卡不产草稿;通过才 `stage()` 一条 `ai_action_draft`(targetType=devAsset, targetVersion=baseVersion),吐 devDiff 卡 |

- **执行器**(`registerExecutor("dev_propose_change", fn)`,批W2 已落地):`confirm()` 通过后,在确认者 `UserContext` 下调**统一门面** `DevStudioService.save(type, code, {content, baseVersion, publish, summary}, actor=AI)`——权限双门(dev 门+资产原生写码)/PROCESS 干跑/乐观锁/快照(actor=AI)全复用,不另辟写路径。`publish=false` 只存草稿、`true` 存并按该资产语义生效。
- **TOCTOU(实现口径)**:staleness 由统一门面的 `baseVersion` 乐观锁承担——确认时资产快照版本已前进 → 执行器转 409「资产已被修改(当前版本比提案基线新),本提案作废;请重新读取资产后再发起改写」(草稿置 FAILED,不静默覆盖)。
- 审计:`dev_propose_change` 落 `ai_tool_call`;确认执行落 `ai_action_draft`;写入落 `dev_asset_version`(actor=AI, summary=提案摘要)——满足 §4 全程审计。

### 2.2 前端:devDiff 卡组件

- 白名单:`protocol.ts` `PART_TYPES` 加 `"devDiff"` + `PART_SCHEMA_SUPPORT.devDiff=1`;`part-router.tsx` 加一支渲染 `DevDiffCard`(不经 `partToCard`,专渲)。
- 组件 `cards/dev-diff-card.tsx`:**复用 `confirm-machine`(idle/submitting/executing/done/cancelled/expired/stale)+ `ai-action-outcomes`(重挂不复活)+ `buildLineDiff`(从 `knowledge/diff-util.ts` 提升为共享 `lib/diff.ts`)。**

payload 形状(服务端组装,**批W2 终稿**——扁平 old/new,diff 由前端 `buildLineDiff` 计算,不再分段 hunks):
```ts
interface AiDevDiffCard {
  type: "devDiff"
  actionId: string                 // ai_action_draft id(二段式,确认走 POST /api/ai/actions/{id}/confirm)
  assetType: "ORCH" | "PROCESS" | "FORM" | "BIZDOC_TPL"   // 与门面 type 枚举一致
  code: string                     // 资产编码
  name: string                     // 资产名(如"请假审批")
  oldContent: string               // 服务端读取的当前完整内容(diff 基线)
  newContent: string               // AI 提案的完整新内容
  summary: string                  // 变更摘要:"审批天数阈值 3 → 5"
  baseVersion: number              // 提案基线快照版本(=TOCTOU 基准;确认时已前进 → 409 stale)
  publish: boolean                 // 确认后是否直接发布
  danger: boolean                  // = publish(将立即生效 → 红语义)
  effectNote: string               // 生效面文案(随资产类型/是否发布)
}
```

卡结构:
```
┌ devDiff 卡 rounded-xl border bg-card p-3.5 shadow-sm (danger→border-l-4 border-l-destructive) ┐
│ [GitCompare] 变更提案 · 请假流程 leave_approval        [需确认] amber chip                     │
│ 摘要:审批天数阈值 3 → 5(1 处改动)                                                            │
│ ┌ diff 主体(默认行内统一视图;可切双栏)──────────────────────────────────────────────┐   │
│ │  … "days"                                                                              │   │
│ │ − "threshold": 3     ← del  bg-rose-500/10 line-through                                 │   │
│ │ + "threshold": 5     ← add  bg-emerald-500/10                                           │   │
│ │  … 未变行 text-muted-foreground(默认折叠上下文 ±3 行,「展开全部」)                     │   │
│ └────────────────────────────────────────────────────────────────────────────────────┘   │
│ ⚠ 确认后将保存为新版本并发布,立即对新触发生效(运行中实例不受影响)  ← danger 时红条         │
│                                          [有效期至 …]  [取消]  [确认改写(danger→destructive)]│
└───────────────────────────────────────────────────────────────────────────────────────┘
应用后:✓ 已改写并发布 v5   [查看版本]（打开 §3 版本侧滑并定位新版）  |  [在编辑区打开]
```
- **双栏/行内切换**:默认行内统一 diff(窄栏友好);宽栏/全屏可切左右双栏(旧|新)。分段 `hunks`(按字段/版式块)带 `path` 面包屑,长内容各段 `overflow-x-auto` 自横滚(min-w-0)。
- **变更摘要**:模型给的人话摘要置顶(如「天数阈值 3→5」「新增审批节点『总监审批』」);摘要仅展示,执行以服务端草稿为准。
- **危险提示**:`publish=true` → `danger` 红语义 + `effectNote` 明说生效面;`publish=false`(仅存草稿)→ 中性,提示「已存为草稿,需你在编辑区/设计器发布后才生效」。
- **确认/取消/终态**:全走 `confirm-machine` + `Idempotency-Key`;`stale`(资产被改)红条「请重新读取」;成功态 `查看版本`(跳 §3 侧滑)/`在编辑区打开`。**AI 只出卡不直写**(红线 §4)。

---

## 3. 版本侧滑(每资产版本列表 · diff 对比 · 一键回滚)

复用知识库 `version-history.tsx` + 编排 `VersionsDrawer` 的信息结构,统一成工作台一个 `Sheet`(右侧,`sm:max-w-3xl`):

```
┌ Sheet 历史版本 · <资产名> ───────────────────────────────────────────────┐
│ ┌ 版本列表 w-56 border-r ─┐ ┌ 详情:查看 / 对比当前 ──────────────────────┐ │
│ │ v5  当前  王经理 07-16   │ │ [👁查看] [⇄对比当前]   ml-auto [↩回滚到此版本]│ │
│ │ v4        AI·丹青 07-15  │ │ ┌ 只读 CodeEditor(json) 或 buildLineDiff ──┐ │ │
│ │ v3        张三   07-12   │ │ │  行级高亮:add 绿 / del 红 / same muted    │ │ │
│ │ …                        │ │ └──────────────────────────────────────────┘ │ │
│ └──────────────────────────┘ └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
回滚确认(AlertDialog):「回滚到 vN?将以该版本内容生成新版本并发布(当前内容仍留在历史,可再回滚)。」
```
- 版本项:`vN` + `当前` 徽标 + 编辑人(**人/AI 区分**:AI 改的标 `AI·丹青` 或 `🤖` 图标,呼应审计)+ 时间 + 备注。
- 详情两态:`查看`(只读 `CodeEditor(json)`)/ `对比当前`(`buildLineDiff` 行级)。
- 回滚 = **以该版本内容另存为新版本并发布**(不销毁历史),`AlertDialog` 二次确认;回滚后编辑区以快照重挂(key 含 version)。

**能力落差(§0.1 真相,写死到设计):**
- **编排**:已有 `orch_flow_version` + `/versions` + `/rollback`,**W1 即可完整版本/回滚**。
- **流程 / 表单 / 打印模板**:后端**无**统一快照历史 + 回滚 API(流程在 Flowable,表单是行版本无回滚,打印模板只有计数)。→ 两条路(§7 分叉点 2):
  - **3.3 提案(推荐)**:工作台自建一层**非侵入式发布快照**表 `dev_asset_version`(`asset_type, asset_id, asset_code, version, content_json, published, author_type[HUMAN|AI], author, reason, created_at`),在**工作台/AI 每次保存或发布时**写一条快照(不动各资产引擎自身的版本机制)。版本侧滑一律读它;回滚 = 取快照 `content_json` 走该资产的 save/publish。**统一、可审计、含人/AI 归属,一张表覆盖四类**。代价:磐石加一表 + 在四个 save/publish 切面挂快照钩子。
  - 保底:W1 版本/回滚仅对编排开;其余三类版本侧滑先只列「表单行版本 / Flowable 部署版本 / 打印模板计数」的**只读列表**,回滚置灰标「暂不支持」,待 3.3 落地再开。

---

## 4. 安全 / 治理红线(与 AI 受控管理、清单≠沙箱一脉相承)

1. **受信门槛**:页 = `dev:studio:view`(新增,授 ADMIN;仿 V18/V25 迁移);写 = 各资产既有码(工作台不新授写权,无写权只读)。AI 工具 `authorities()` 同码——模型只看到当前用户有权改的资产(`AuthorizedToolResolver` 过滤),没权限的资产在 AI 里也点不动。
2. **AI 只经 diff 确认,绝不直写**:`dev_propose_change` = `CONFIRM_REQUIRED`,一律 `stage` 草稿 → devDiff 卡 → 人确认 → 执行器在**确认者身份**下调资产原生 Service(过 `@PreAuthorize`/数据权限/事务/Bean 校验)。TOCTOU(`targetVersion`+`payloadHash`)防「读旧改旧」;`Idempotency-Key` 防重放;十分钟 TTL。
3. **全程审计(谁/何时/改了什么/人还是 AI)**:`dev_propose_change` 落 `ai_tool_call`;确认执行落 `ai_action_draft`(前后 hash、是否发布);`dev_asset_version`(§3.3)记 `author_type HUMAN|AI` + `reason`。版本侧滑与审计日志可回溯每一次改写的来源与内容。人工在编辑区的保存/发布同样留痕(经 `@OperLog` 或写快照)。
4. **不做源码热改(硬红线)**:工作台只碰**运行期解释、发布即生效的定义类 JSON**(designer_json/schema_json/content);**不触碰** Java/TS 源码、`application.yml`、迁移、Bean 定义、脚本节点代码之外的任何编译产物。脚本节点(受信,`wf:script:write`)是否纳入工作台编辑,§7 分叉点 4——**默认不纳入**(它更接近「源码」,风险级更高)。
5. **清单 ≠ 沙箱口径延续**:AI 能改的资产是**预注册白名单**(四类,`dev_list_assets` 只列注册类型),不是任意表/任意字段/任意 SQL;`newContent` 落库前过该资产 schema 校验,不能注入越界结构。新增资产类型=注册一类适配器,AI 自动纳入(仿 `AiManagedAction` 自发现)。
6. **远期出口(仅备案,不本期做)**:对源码/配置类变更,AI 可生成「变更包 / PR 描述」交人工走 CI/CD——**生成建议,不落地生效**,与本工作台热资产改写严格分离。

---

## 5. 分批(每批四门 + 冒烟)

> 四门 = `pnpm build`(tsc)/ `pnpm lint`(oxlint)/ jsdom 渲染冒烟(「renders without throwing」,仿 `tpls-page.render.test.tsx`)/ 关键纯函数单测(diff、内容 codec、序列化往返)。后端改动跑 `node server/smoke-test.mjs`(**必带 `OA_SMOKE_KEEP=1`**)。

### 批 W1 · 资产底盘 + 树 + JSON 编辑 + 保存/版本/回滚(无 AI)
- **前端**:`/dev-studio` 三栏壳(负边距铺满 + 三 `ErrorBoundary` 岛 + 可拖/可折叠/全屏 + 宽度持久化到 app-store);资产树(四组 + 搜索 + 状态/版本徽标 + 状态过滤 chips + 新建下拉跳原流);编辑区(只读预览态/编辑态、`CodeEditor(json,lint,expandable)`、格式化/校验/保存草稿/发布 + 发布二次确认 + 离开拦截 + 底部状态行);版本侧滑(编排完整;其余按 §3 保底只读);「用设计器打开」跳转。
- **前端数据**:优先**聚合各资产既有端点**(list/read/save/publish/versions),`useApiData`/归一化 + offline/demo mock(后端未连时全链路可演示,仿编排列表 mock)。
- **后端(磐石,可选/建议)**:是否落 `dev:studio:view` 迁移 + 一个薄读写门面 `GET /api/dev/assets`(跨四类聚合列表,省前端四处拼);§3.3 `dev_asset_version` 快照表是否本批起。见 §7。
- 冒烟:三栏渲染不白屏;打开各类资产只读/编辑/保存/发布(mock 或真);编排回滚往返。四门齐。

### 批 W2 · AI 工具 + diff 卡
- **后端**:`dev_list_assets` / `dev_read_asset`(READ_ONLY)+ `dev_propose_change`(CONFIRM_REQUIRED,stage 草稿 + TOCTOU + 执行器调资产 Service);devDiff card payload 服务端组装。
- **前端**:`protocol.ts` 加 `devDiff` 白名单+版本;`DevDiffCard`(复用 confirm-machine + ai-action-outcomes + 提升共享的 `buildLineDiff`;行内/双栏、分段 hunks、变更摘要、危险/生效提示、成功态查看版本);`part-router` 接线;右栏嵌入作用域绑定当前资产的 ChatView(注入 `{assetType,assetId,version,hash}`)+ 资产类型提示 chips。
- 冒烟:devDiff 卡渲染不白屏(含脏 payload 降级);`dev_read→propose→diff→confirm→写新版本` 一条真链;`stale`/过期/幂等终态正确。后端 smoke 覆盖三工具(KEEP=1)。

### 批 W3 · 打磨
- 编辑区**多标签打开**(栏内 tab,复用 tabs 视觉但独立于全局 tabs-store,栈上限 + 脏标记 + 关标签拦截);**快捷键**(`Ctrl/Cmd+S` 保存草稿、`Ctrl/Cmd+Enter` 发布【二次确认仍在】、`Ctrl/Cmd+F` 编辑器内查找、`Esc` 退全屏);**最近编辑**(树顶「最近」分组,存 app-store);**搜索跳转**(树内模糊 + 可选并入全局 ⌘K「跳到资产」);`dev_asset_version` 落地后开满四类版本/回滚。
- 冒烟:多标签开关不白屏、快捷键不误触发、最近编辑持久化。四门齐。

---

## 6. 布局尺寸 / 明暗 / 防白屏要点(照平台惯例收口)

- **尺寸**:外层 `-mx-4 -my-4 md:-mx-5 md:-my-5 h-[calc(100dvh-6.5rem)] min-h-[34rem]`;顶部条 `h-14 border-b bg-background/95 px-3 backdrop-blur`;左树 `w-[260px]`(拖 `[200,420]`)、AI 栏 `w-[360px]`(拖 `[320,560]`);全链路 `min-w-0`(CodeEditor/diff/JSON 宽内容各自容器内横滚,页面本身不出横滚)。
- **响应式**:`< md` 左树收进 `Sheet`(顶部条「资产 ▾」唤起,仿系统管理左树降级),AI 栏收进抽屉或折叠;编辑区始终占主。
- **明暗**:全走 token(`bg-card/border/ring-ring/text-muted-foreground/bg-primary`),`.dark` 自动;diff 高亮 add `emerald-500/10`、del `rose-500/10`、状态 amber/emerald 两态可辨;`CodeEditor` 主题跟 `themeMode` 自动。`motion-reduce` 降级 spin/pulse/transition。
- **防白屏(反白屏四条落到本页)**:① 路由级 boundary 自动 + 三栏各附自身 `ErrorBoundary`(key 含资产 id+version);② 树/版本列表响应归一化(`{list}`|`[]`);③ 资产 `content` 渲染前容错(非字符串→`String()`,非法 JSON→只读原文 + 顶栏红标「JSON 无法解析,只读」,不进编辑不崩);④ 新页 + devDiff 卡各配 jsdom 渲染冒烟。**坏 `designerJson` 曾阻塞后端启动(记忆:diag_* 流程定义)**——工作台读到解析失败的资产只在编辑区降级,绝不抛到整页。

---

## 7. 开放项 · 需主控拍板的分叉点

1. **「保存即生效」口径(§0.1)**:确认工作台按各资产 `草稿/发布` 建模、把「立即生效」挂到发布/部署动作(而非 raw save)。是否要求四类**发布语义对齐**成一个「发布」按钮(内部分派各端点)?建议:是——统一「保存草稿 / 发布」两键,文案随资产。
2. **统一版本 + 回滚(§3.3,最大分叉)**:是否本期落 `dev_asset_version` 非侵入式快照表(一表覆盖四类版本/回滚 + 人/AI 归属),还是 W1 只给编排、其余待后续?**强烈建议落 `dev_asset_version`**——否则「统一版本侧滑 + 回滚」名不副实,且它同时满足 §4 审计。需磐石在四处 save/publish 挂快照钩子。
3. **AI 栏形态(§1.5)**:确认「嵌入作用域绑定当前资产的 ChatView 独立会话」(而非复用全局悬浮面板)。涉及会话隔离与上下文注入的后端支持(system 上下文带 assetType/id/version/hash)。
4. **脚本节点是否纳入(§4.4)**:编排/流程内脚本节点代码(受信 `wf:script:write`,非沙箱、等同源码)默认**不**纳入工作台 raw 编辑/AI 改写。若要纳入需单独更高门槛 + 更强确认。请拍板:默认排除(建议)/ 有限纳入。
5. **菜单级门控**:是否给 `MenuItem` 补 `perm?` 字段做菜单隐藏(无 `dev:studio:view` 不显菜单),还是沿用「菜单可见、页内空态」现状?建议补 `perm` 字段(开发工作室对普通用户直接隐藏更干净),但这是全局 `menu.ts` 改动,牵一发。
6. **资产范围是否含「单据定义 `oa_bizdoc_def.form_schema`」**:用户首期点名 `BdTemplateV2`(=打印模板 content)。单据定义 `form_schema`(INLINE 表单)同模式可纳入为第 5 组。建议:W1 先四类,单据定义列 P1。
7. **读写门面**:是否要磐石提供 `GET /api/dev/assets`(+ 统一 read/save/publish 分派)聚合端点,让前端不用四处拼接不同资产 API?建议:提供薄门面(前端一套调用、少四套适配),但底层仍调各资产既有 Service。

## 附:主控拍板(2026-07-16,合并磐石底盘查证)

1. **发布语义**:四类统一「保存草稿 / 发布」两键(PUT body `{content, baseVersion?, publish?}`);「立即生效」确认挂发布动作。
2. **统一快照表 `dev_asset_version`(批W1 落,采丹青案)**:一张非侵入表覆盖四类(type/code/version_no/content/actor(人|AI)/summary/created),每次经工作台 保存/发布/AI 应用 落一行;ORCH 原生版本表照旧并存。回滚:ORCH 走原生 rollback、FORM 以旧 schema 建新版本、PROCESS/BIZDOC_TPL 经快照覆盖+重走发布链。审计红线由此表满足。
3. **AI 栏**:嵌入绑定当前资产的独立会话(注入 assetType/code/version/hash 上下文),批W2。
4. **脚本节点**:不单列(随所在 designerJson 整体编辑;单节点脚本仍走设计器的高级编辑器)。
5. **MenuItem 补 `perm?` 字段**:批W1 顺带(菜单级门控,照 hidden? 同型改法)。
6. **资产范围**:首期四类(ORCH/PROCESS/FORM/BIZDOC_TPL);单据定义 form_schema 列 P1 后续。
7. **统一门面**:采磐石契约 `/api/dev-studio/assets*`(type 大写枚举;字段名以磐石提案为准)。
8. **安全硬线(磐石风险采纳)**:①PROCESS 发布前**干跑转换校验**(防写坏 designerJson 阻塞应用启动——历史教训)**批W1 必做**;②`baseVersion` 乐观锁批W1(经 dev_asset_version 或 service CAS,409 冲突);③权限**双门**:V49 新增 `dev:studio:view/edit` 管入口与 AI 工具暴露,落写仍验各资产原受信码;④AI 只 propose 产 diff 卡、confirm 走统一 PUT 二验,永不直写直发。
9. **FORM latest 陷阱**:工作台保存表单草稿时 UI 明示「新草稿版本将立即成为 latest(影响发起取数)」。
