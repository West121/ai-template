# 权限中心升级 · 产品/交互设计稿(丹青)

> 立项(2026-07-16,主控拍板方向):在 DP1「多维数据权限」已落地的地基上,升级三层——
> **① 维度自定义(UI)**、**② 功能级数据权限(默认全局 + 按功能覆盖)**、**③ 字段权限(角色×功能)**,
> 并把塞满的角色编辑弹窗**重构为详情大抽屉/整页 + Tab**。
> 本文只出**设计稿**(照 `docs/design/` 体例:现状查证 → 设计 → 分批 → 红线),**不 commit、不改代码**。
> 依据现状:`web/src/pages/system/role.tsx`、`web/src/components/system/data-dimension-authz.tsx` + `dp-authz-api.ts`、
> `web/src/components/field-perms-editor.tsx`、`server/…/system/datadim/*`、`server/…/office/support/DataScopeSupport.java`、
> `server/…/workflow/service/FormManifestService.java`、迁移 `V43__data_permission_dimensions.sql`。

---

## 0. 现状(查证——已有什么、缺什么)

| 能力 | 现状(已落地) | 本次要补 |
|---|---|---|
| **维度元数据** | `sys_data_dimension`(code/label/entity/column_name/enabled),V43 种子 `costCenter`/`project`。**只能改 SQL**,无 UI | **维度管理页**:增删改启停 |
| **维度取值来源** | 只走**代码 provider bean**(`CostCenterDimensionProvider`/`ProjectDimensionProvider` 读 `sys_cost_center`/`biz_project`)。新维度=写 Java bean | **UI 三选**:自定义选项表 / 数据字典 / 组织部门树,**免写 bean** |
| **维度↔实体绑定** | `column_name` 只是「默认/文档」字段;真正过滤列由查询侧 `DataScopeSupport.multiDim(deptField,userField,dimColumns)` **调用方硬传 map**;仅 `oa_approval` 端到端接了 | **绑定 UI**:选功能实体 + 承载列(单实体单列先行;JSON 扩展列二期) |
| **授权粒度** | **全局 per 维度**:`sys_role_data_dimension`/`sys_user_data_dimension`,`(principal,dimension)` 唯一,scope=ALL/CUSTOM + value 集。多角色/用户级**并集**(RBAC 加法),Redis `dp:dims:{userId}` 预计算 | **默认全局 + 按功能覆盖**(角色×功能×维度→ALL/CUSTOM) |
| **字段权限** | **仅流程节点级**:`WfNodeProps.formPerms`(HIDDEN/READ/EDIT 三态),`field-perms-editor.tsx` 拉 `GET /api/wf/forms/{formKey}/fields` 渲染「字段×{可见/可编辑/必填}」矩阵。**与角色无关** | **角色×功能级**字段可见/可编辑(与节点级**并存**,语义不同——见 §5.0) |
| **角色编辑 UI** | 单个 `Dialog`(`sm:max-w-md`):名称/编码/dataScope(5 档)/CUSTOM 自定义部门/备注 + 底部塞 `DataDimensionAuthz`(仅编辑态);功能权限走**另一个** Dialog(权限树)。**已塞满** | 重构为 **Sheet 大抽屉 / 整页 + Tab** |
| **功能目录(「功能」的载体)** | `ai_feature_catalog`(GET `/api/ai/features`):featureCode/routeCode/**related_form_codes**/requiredAuthorities。但在 `oa-boot/ai`,**system 模块不能反向依赖** | 「功能」标识的取舍是**头号拍板点**(§1) |
| **字段清单接口** | `GET /api/wf/forms/{formKey}/fields` → `FormFieldManifest{fields:[{key,label,type,group,required?}]}`;`bizdoc:{code}` 分支已支持单据。**只覆盖「有表单」的功能** | 列表类功能(用户/成本中心台账…)无 wf 表单 → 字段目录来源要拍板(§1) |
| **响应脱敏** | **无**(grep 无 `@Sensitive`/mask/desensitize 基建) | 字段权限的后端脱敏=**从零建**,红线成对(§5/§10) |
| **可复用件** | shadcn `Sheet`✓ `Tabs`✓、`OrgPicker`(部门树多选)✓、`RecordPicker`(泛型多选,DP1 已用)✓、`DataTable`+`indexColumn`+`batchSlot`✓、`ErrorBoundary`✓ | 只新增少量「壳」,不造新风格 |

**一句话**:DP1 把「维度框架 + 全局授权 + 部门维 AND 业务维查询下推」跑通了;本次是在其上加 **配置化 UI**、**功能维度**、**字段维度** 三个正交扩展 + 一次 UI 重构。**向后兼容红线**:不配功能覆盖=沿用全局授权;不配字段权限=全字段放行;现有 `oa_approval` 多维过滤行为不变。

---

## 1. 需主控拍板的分叉点(阻塞设计落地,单列在前)

> 这几处是「一旦选错要返工」的岔路,请主控先裁。设计正文对每处给**推荐默认**并按其展开。

### 拍板点 A ——「功能」用什么标识?(影响 §4/§5 全部)
功能级数据权限 & 字段权限都要「角色 × **功能**」。候选:
| 方案 | 「功能」= | 优点 | 代价 |
|---|---|---|---|
| **A1(推荐)** 权限码 | 现有菜单/按钮 `perm code`(如 `system:role:edit`、`office:approval:list`) | 零新表,天然全覆盖,角色本就按 perm 授权 | 码偏技术,需给「功能友好名」(可取 `sys_permission.name`) |
| A2 功能目录下沉 | 新建 system 级 `sys_feature`(镜像/下沉 `ai_feature_catalog`:route_code + related_form_codes) | 有 related_form_codes 直连字段清单;跨模块干净 | 引入新表 + 与 ai 目录双维护(除非 ai 反过来复用它) |
| A3 直接复用 ai_feature_catalog | featureCode | 不建表 | system 模块**不能依赖 oa-boot**,要把 catalog 迁到 system 或加 SPI,架构违和 |
> **丹青倾向 A1**:以 `perm code` 为「功能」主键,前端「功能选择器」列表源 = `GET /api/system/permissions/tree`(角色权限树同源),字段清单则按功能**关联的表单码**解析(见拍板点 B)。A2 仅当主控要「功能」是业务视角实体时选。

### 拍板点 B —— 字段清单来源如何统一?(影响 §5)
`GET /api/wf/forms/{formKey}/fields` 只覆盖「有表单」的功能。列表类功能(用户表/成本中心台账)无 wf 表单。
- **推荐**:新增**归一端点** `GET /api/system/features/{featureCode}/fields`,后端内部**两条来源合流**:①功能关联表单码→复用 `FormManifestService`;②列表类功能→读其**列目录**(可先用 `DataTable` 列 `meta.title` 的后端登记版,或功能注册字段目录)。前端只认这一个端点,拿到统一的 `FieldDescriptor[]`。
- 若主控要省事:**P3 先只支持「有表单」的功能**(审批/公文/单据/请假/报销),列表功能的字段权限延后。设计正文按「归一端点」写,降级为「只表单功能」不影响 UI。

### 拍板点 C —— 功能覆盖的合并语义?(影响 §4)
「默认全局授权」与「某功能覆盖」的关系:
- **推荐**:功能覆盖 = **替换**该功能在该维度上的范围(「这个功能就用这个范围」),未覆盖的维度/功能沿用全局默认。多角色下同一(功能,维度)覆盖之间仍取**并集**(维持 RBAC 加法,多角色更宽)。
- 备选:覆盖 = 与全局**取交集**(更严)。语义反直觉,不推荐,但若合规要求「功能只能更窄」则选它。
> 需拍板:**替换 + 多角色并集**(推荐) vs 交集收窄。

### 拍板点 D —— 维度↔实体绑定的深度?(影响 §2.4 / 后端查询侧)
现状过滤列由调用方硬传。维度自定义后,新维度要能被查询侧发现「哪个实体、哪列」。
- **P1 推荐(浅)**:UI 只维护 `sys_data_dimension.entity` + `column_name`(**单实体单列**);查询侧仍由各功能 service 显式接入(像 `oa_approval` 那样),UI 绑定值供后端读取/文档,不自动改查询。
- **深(P4)**:建 `sys_dimension_binding`(dimension × entity × column,多实体)让 `DataScopeSupport` 从表读绑定、自动下推。**JSON 扩展列**(实体无物理列时挂 `ext_json->>'dimX'`)一并 P4。
> 需拍板:P1 是否只做「单实体单列 + 元数据登记」,深度绑定/JSON 扩展列全部推 P4(丹青推荐这样,先把 UI 与配置化跑通)。

### 拍板点 E —— 角色详情:大抽屉 Sheet vs 整页?(影响 §3)
- **Sheet(推荐)**:右侧大抽屉(`sm:max-w-3xl`~`4xl`),留在角色列表页上下文,切换角色快;Tab 内滚动。
- 整页:`/system/role/:id` 独立路由,空间更大适合字段矩阵,但离开列表、要面包屑/标签接线。
> 丹青推荐 **Sheet 大抽屉**;仅当字段矩阵在抽屉里挤(超宽表)才升级整页。设计正文按 Sheet 写,整页为可选增强。

---

## 2. 数据维度管理页(P1)——挂「系统管理」子菜单

**菜单**:`系统管理 → 数据维度`,`path:/system/data-dimension`,icon `Boxes`/`Layers`。权限码建议 `system:datadim:list` / `system:datadim:edit`(新增,种子进 `V{n}` + 菜单表)。
按 CLAUDE.md「路由=菜单=Tab=面包屑同串」:`App.tsx` lazy 路由 + `config/menu.ts` 一条即可。

### 2.1 布局(单表 + 编辑抽屉,对齐系统管理各页)
```
PageHeader「数据维度」  副标题:配置业务数据维度及其取值来源、实体绑定(内建 部门/本人 维度不在此)
PermissionBanner(system:datadim:edit)
DataTable
 ├ 序号 | 维度名称 | 维度编码(mono) | 取值来源(Badge) | 绑定实体·列(mono) | 选项数 | 状态 | 操作[编辑/停用/删除]
 ├ 工具栏:搜索(名称/编码) + [新增维度]
 └ 多选批量:启用/停用(删除对「已被授权引用」的维度→逐条失败反馈,见 §10)
```
列 `取值来源` Badge 三色:`自定义选项`/`数据字典`/`组织部门`。`选项数` 对字典/部门源显示「—」(动态)。

### 2.2 编辑抽屉(Sheet,右侧,`sm:max-w-xl`)——维度基本信息
```
Sheet 头:新增数据维度 / 编辑「成本中心」
─ 基本信息 ─
  维度名称*      [成本中心]
  维度编码*      [costCenter]  (mono;新增可改,编辑后锁定——授权表按 code 外键)
  启用           [开关]
─ 取值来源*(三选一,单选卡片) ─
  ○ 自定义选项表   本页维护 id/名称/排序/启停(§2.3)
  ○ 数据字典       选字典类型 → 用其字典项作可选值(dictType 下拉,源 /api/infra/dict/types)
  ○ 组织部门       用部门树作可选值(授权时弹 OrgPicker types=[DEPT])
─ 实体绑定(§2.4) ─
  绑定功能实体   [下拉:审批 Approval / …]   承载列 [cost_center_id]
  说明:该维度过滤「哪个功能实体的哪一列」。JSON 扩展列见红线区(P4)。
[取消] [保存]
```
- **取值来源**决定「授权时怎么选值」:自定义选项/字典→`RecordPicker`(列表勾选);部门→`OrgPicker`。三种都归一为 `{id,label}[]`,复用 DP1 的 `GET /api/system/data-dimensions/{code}/options`(后端按来源分派:选项表查自建表 / 字典查 dict / 部门查部门树)。**前端授权 UI 完全不用改**(契约已钉死)。
- 编码锁定:编辑态 `维度编码` 只读——授权/绑定都按 code 关联,改码=断链。

### 2.3 自定义选项维护(来源=自定义选项表 时,抽屉内内联小表)
```
选项(拖拽排序)
 ┌ #  名称        编码(可空)  启用  操作 ┐
 │ ⠿  研发成本中心 CC-RD      ✓    [删] │
 │ ⠿  市场成本中心 CC-MKT     ✓    [删] │
 └ [+ 新增选项] ────────────────────────┘
```
- 存 `sys_dimension_option`(dimension/id/label/code?/sort/enabled)。授权 options 端点对「自定义源」查此表。
- 空态:「暂无选项,点『新增选项』添加该维度的可选值」。

### 2.4 实体绑定(P1 浅版,对齐拍板点 D)
- 下拉「绑定功能实体」源:后端登记的**可接入数据权限的实体清单**(先硬编码 `[Approval, …]`,或从拍板点 A 的功能表推);「承载列」文本/下拉(该实体已有列名)。
- **P1 只登记不自动下推**:保存写 `sys_data_dimension.entity/column_name`;查询侧接入仍由各功能后端按 `DataScopeSupport.multiDim` 显式传(现状),UI 值作为「后端读取的绑定源 + 文档」。深度自动绑定/JSON 扩展列 → P4(红线区写明)。

---

## 3. 角色详情重构:弹窗 → Sheet 大抽屉 + Tab(贯穿 P1→P3 的 UI 骨架)

**动因**:现 `role.tsx` 编辑弹窗已挤(名称/编码/5 档/自定义部门/备注/DP1 维度授权),功能权限还在**另一个**弹窗。三层升级会再加「功能覆盖矩阵 + 字段矩阵」——弹窗必爆。改为**右侧大抽屉 `Sheet`(`sm:max-w-3xl`)+ 顶部 Tab**。

### 3.1 抽屉骨架
```
Sheet(右,sm:max-w-3xl,内部各 Tab 独立滚动)
┌ 头:角色「部门经理」 · MANAGER   [启用/停用]        ┐
├ Tabs: [基本信息] [功能权限] [数据权限] [字段权限]   │
│                                                     │
│  <TabsContent 各含独立 ErrorBoundary>               │
│                                                     │
└ 底部固定:  [取消]  [保存当前 Tab]  (每 Tab 独立保存,见 §3.3) ┘
```
> 「新增角色」仍可用**轻量 Dialog**(只名称/编码/备注/数据范围默认档),创建后再打开抽屉配细项——避免新建即面对四 Tab。或新增也进抽屉但仅「基本信息」Tab 可用,其余 Tab 提示「保存后可配」。**推荐后者**(统一入口)。

### 3.2 四个 Tab 内容
| Tab | 内容 | 来源/复用 |
|---|---|---|
| **基本信息** | 角色名称/编码/备注/启用。**原语义搬入** | 现 `RoleForm` 字段 |
| **功能权限** | 权限树(MENU/BUTTON,父子级联),原「权限配置」弹窗**整体搬入** | 现 `PermTree` + `GET/PUT /roles/{id}/permissions`,零改 |
| **数据权限** | ①**部门数据权限**:5 档 Select(ALL/DEPT_AND_CHILD/DEPT/SELF/CUSTOM)+ CUSTOM 时自定义部门(OrgPicker)——**原语义搬入**;②**业务维度授权(默认全局)**:`DataDimensionAuthz` 组件搬入(每维 全部/指定);③**功能覆盖**列表(P2,§4) | 5 档=现 `form.dataScope`+`customDeptIds`;维度=现 `DataDimensionAuthz`(零改);覆盖=新增 |
| **字段权限** | 功能选择 → 字段矩阵(可见/可编辑)(P3,§5) | 复用 `field-perms-editor` 的矩阵形态 + 新契约 |

- **5 档 + 自定义部门原语义保留**:只是从弹窗顶部搬到「数据权限」Tab 首块,交互/字段/校验(CUSTOM 必选 ≥1 部门)一字不改。
- 现有 `DataDimensionAuthz` 的「保存数据维度授权」独立按钮 → 收进 Tab 的统一底栏保存,或维持其独立保存(它本就独立 PUT)。**推荐**:数据权限 Tab 内「部门 5 档(随角色主体 PUT)」与「维度授权(独立 PUT `/data-dimensions`)」分区,底栏「保存」一次触发两个 PUT(顺序调,任一失败 toast 不静默)。

### 3.3 保存策略(每 Tab 独立,防「切 Tab 丢改」)
- 每 Tab 有各自「保存」;切 Tab 若当前 Tab 有未保存改动 → `AlertDialog` 拦「有未保存修改,离开将丢弃?」。
- 关抽屉同理拦截。功能权限/字段权限/维度授权各是独立 PUT,互不牵连。

---

## 4. 功能级数据权限(P2)——默认全局 + 按功能覆盖

> 交互红线(主控已提醒):**别做吓人的大矩阵**。做成「**默认授权(全局)** + **功能覆盖列表**(按需添加覆盖项)」。

### 4.1 「数据权限」Tab 的三段式
```
数据权限 Tab
─ ① 部门数据权限(5 档) ────────────────  [ALL/本部门及以下/本部门/仅本人/自定义]  (原语义)
─ ② 业务维度 · 默认授权(全局) ─────────  成本中心[全部/指定]  项目[全部/指定]      (DP1 DataDimensionAuthz)
─ ③ 功能覆盖(可选) ────────────────────
    说明:默认所有功能都用上面②的全局授权。只有当某功能要用不同范围时,才在这里加一条覆盖。
    ┌ 已添加的覆盖 ─────────────────────────────────────────────┐
    │ [报销管理]  成本中心=指定(研发/市场)  项目=全局   [编辑][移除] │
    │ [采购管理]  成本中心=全局            项目=指定(A) [编辑][移除] │
    └──────────────────────────────────────────────────────────┘
    [+ 添加功能覆盖]
```
- **默认视图零覆盖**——只有「① + ②」,和现在几乎一样,不吓人。覆盖是 opt-in。

### 4.2 「添加功能覆盖」流(弹层/内联展开)
```
Step1 选功能   [功能选择器:搜索 + 树/列表]  (源见拍板点 A;A1=权限树可选叶子)
Step2 逐维度设范围(只列该角色配了维度的那些 + 该功能实体实际绑定的维度)
        成本中心  ○ 跟随全局(默认)  ● 指定[研发中心 ×][市场部 ×]  ○ 全部
        项目      ● 跟随全局        ○ 指定                      ○ 全部
        (「跟随全局」= 不覆盖该维;整条覆盖里所有维都「跟随全局」→ 视为无覆盖,保存时剔除)
[取消][确定添加]
```
- 「跟随全局 / 全部 / 指定」三态:跟随=用②;全部=该功能该维不限;指定=`RecordPicker` 选值(复用维度 options 端点)。
- 一功能一行覆盖,内含多维;编辑=重开此弹层回填。

### 4.3 契约(新增,前后端钉死;沿用 DP1 命名习惯)
```
GET  /api/system/roles/{id}/data-dimension-overrides
      → [{ feature: "office:reimburse:list", dims: [{dimension:"costCenter", scope:"ALL"|"CUSTOM", values:number[]}] }]
PUT  /api/system/roles/{id}/data-dimension-overrides   body 同上(全量替换,只下发「非跟随全局」的维)
GET  /api/system/features            → [{code,label,entity?,formCode?}]  可接入数据权限/字段权限的功能清单(拍板点A/B 决定其来源)
```
- 语义:某功能的最终可见范围 = 「有覆盖的维用覆盖范围(替换)」+「无覆盖的维用全局授权」(拍板点 C=替换);多角色并集。
- 后端:`DataScopeSupport.multiDim` 需能按「当前功能」取覆盖优先的 scope(现 `resolveForCurrentUser(codes)` 要扩 `resolveForFeature(featureCode, codes)`)。**这是 P2 后端主戏**,设计只钉 UI 契约。

### 4.4 空态/演示态
- 无维度注册 → ②③ 整块折叠为「暂无已注册业务维度,先去『数据维度』页配置」(带跳转)。
- 后端未接 override 端点 → 沿用 DP1 `withMock` 降级:③显示演示覆盖 + 琥珀 banner「后端未接入,功能覆盖为演示数据」。

---

## 5. 字段权限(P3)——角色 × 功能 → 字段 可见/可编辑

### 5.0 与「流程节点级字段权限」的区别(两套并存,别混)
| | 流程节点级(已有) | 角色×功能级(本次) |
|---|---|---|
| 载体 | `WfNodeProps.formPerms`(某节点办理时) | 角色配置(该角色看这个功能时) |
| 编辑处 | 流程设计器节点面板 `field-perms-editor` | 角色详情「字段权限」Tab |
| 生效 | 运行时按当前节点 | 全局按当前用户角色 |
| 三态 | HIDDEN/READ/EDIT | 可见/可编辑(等价三态,见下) |
> 两者**叠加**:最终可见性 = 节点级 AND 角色级(任一隐藏则隐藏,任一只读则只读——取更严)。设计只定角色级 UI + 契约;叠加规则后端实现时钉死(红线 §10)。

### 5.1 「字段权限」Tab 布局(功能选择 → 字段矩阵,复用 `field-perms-editor` 形态)
```
字段权限 Tab
─ 功能 ─  [下拉/搜索:选一个功能]  (源=有字段清单的功能,拍板点 B)
          未选 → 「选择一个功能以配置其字段权限」空态
─ 选中「报销管理」后 ────────────────────────────────────────
  工具条:  [全部可见] [全部隐藏] | [全部可编辑] [全部只读] | 搜索字段
  ┌ 分组:基础字段 ───────────────────────────┐
  │ 字段            可见   可编辑   (必填·只读展示) │
  │ 报销金额         ☑      ☑         ☐(表单声明)   │
  │ 报销事由         ☑      ☐         ☑             │
  │ 银行卡号         ☐      ☐         ☐   ← 隐藏(脱敏红线)│
  ├ 分组:明细子表单 ──────────────────────────┤
  │ 明细.金额        ☑      ☑         ☐             │
  └──────────────────────────────────────────┘
  [保存字段权限]
```
- **直接复用 `field-perms-editor.tsx` 的矩阵与三态映射**(`permToVisibleEditable`/`visibleEditableToPerm`:可见+可编辑=EDIT、可见+只读=READ、不可见=HIDDEN;可见取消→可编辑自动关且禁用)。差别只在:数据不写 `WfNodeProps` 而写**角色×功能**契约,字段清单来自**归一端点**(拍板点 B)。
- 「必填」列沿用现状**只读展示**(表单自身声明,角色侧不改)。
- **全选/反选**:新增工具条批量(可见/隐藏、可编辑/只读),现 `field-perms-editor` 未含,P3 加。
- 按 `group` 归组(复用 `groupFields`),子表单字段 `子表单.列` 前缀天然归组。

### 5.2 契约(新增,前后端钉死)
```
GET  /api/system/features/{featureCode}/fields
      → { featureCode, fields:[{key,label,type,group?,required?}] }   归一字段清单(表单源+列表源合流)
GET  /api/system/roles/{id}/field-perms?feature={featureCode}
      → [{ key:"amount", perm:"HIDDEN"|"READ"|"EDIT" }]              未列出的字段=默认 EDIT(全放行)
PUT  /api/system/roles/{id}/field-perms?feature={featureCode}
      body 同上(该功能全量替换;只下发非 EDIT 的字段,EDIT=默认=不下发)
```
- 存 `sys_role_field_perm`(role_id / feature / field_key / perm),`(role_id,feature,field_key)` 唯一。
- 复用 `form-manifest.ts` 的 `FieldDescriptor` 类型 + `permToVisibleEditable` 纯函数,**不新建模型**。

### 5.3 后端脱敏(红线,P3 必须与前端**成对**)
- 前端隐藏/只读**只是体验**。后端必须在**响应出口**按「当前用户角色 × 功能 × 字段策略」对 HIDDEN 字段**抹值/剔除**、对 READ 字段拒绝写入。
- 现状**无脱敏基建** → 从零建。推荐:响应 `@ControllerAdvice`/序列化 advice 按功能+字段策略过滤 + 写侧 service 校验 READ 字段不可改。**具体机制需主控在 P3 拍**(横切 vs 各 service),但「不落后端=P3 不算完」是硬红线。

---

## 6. JSON 扩展列(P4)——红线区(本次不做,先写清边界)

- 场景:业务实体**无物理列**承载某自定义维度时,挂 `ext_json`(如 `ext_json->>'region'`)。
- 为何推后:PG `->>` 表达式**默认不走 B-tree 索引**,大表过滤退化(对照 `CriteriaScopes` 已验证的「物理列 IN 走索引 93ms / 数组 @> 慢 40x」),需表达式索引/生成列 + 压测,属性能深水区。
- P4 才做:`sys_dimension_binding`(dimension×entity×column,支持 `json:ext_json.region` 语法)+ `DataScopeSupport` 自动下推 + 表达式索引 + 千万级压测。**P1~P3 一律单实体单物理列**,维度管理页「承载列」对 JSON 源置灰并提示「JSON 扩展列 P4 支持」。

---

## 7. 空态 / 演示态 / 防白屏(贯穿全批,CLAUDE.md 反白屏四层)

| 场景 | 处理 |
|---|---|
| 后端未接新端点 | 沿用 DP1 `dp-authz-api.ts` 的 `withMock`(offline / 404 → 演示数据 + 琥珀 banner;403 等业务错照抛)。新端点(overrides/field-perms/features/fields)全走同一 `withMock` 封装 |
| 无维度/无功能/无字段 | 各块 dashed 空态卡:「暂无已注册业务维度」「选择功能以配置」「该表单暂无可配置字段」(现 `field-perms-editor` 已有末例) |
| 列表响应归一 | 所有 `[]`/`{list:[]}`/垃圾 → 归一为数组再 render(反白屏第 2 条;DP1 `normList` 已是范式,新端点照抄) |
| 岛屿边界 | 抽屉每个 Tab 各包 `ErrorBoundary`(现 role.tsx 已对 DataDimensionAuthz 包了);字段矩阵、覆盖列表各自兜底,坏 payload 局部降级不整屏白 |
| 新页渲染冒烟 | 数据维度页 + 角色抽屉 + 字段矩阵各配 jsdom mount test(`*.render.test.tsx`,照 `data-dimension-authz.render.test.tsx`/`tpls-page.render.test.tsx`) |

---

## 8. 分批建议(每批:向后兼容 + 四门 + smoke KEEP=1)

> 四门 = `pnpm build`(tsc -b)/`pnpm lint`(oxlint)/`vitest` 渲染冒烟/后端 `mvn` 编译 + `node server/smoke-test.mjs`(带 `OA_SMOKE_KEEP=1`,勿清用户在测数据)。每批编译+smoke 全绿再进下一批。

| 批 | 范围 | 前端(疾风) | 后端(磐石) | 出口验收 |
|---|---|---|---|---|
| **P1 维度自定义 + 选项表源** | §2 维度管理页 + §3 角色抽屉骨架 | 数据维度页(列表+编辑抽屉+选项维护+绑定浅版);role.tsx 弹窗→Sheet+Tab(基本/功能/数据三 Tab,原语义搬入,**零功能回归**) | `sys_data_dimension` CRUD API + `sys_dimension_option` + options 端点按来源分派(自定义/字典/部门);维度删除对被引用者拦截 | 维度增删改启停可用;options 三源可选;角色抽屉四门原有功能不回归;smoke 维度过滤(oa_approval)不回归 |
| **P2 功能级覆盖** | §4 数据权限 Tab ③ | 「功能覆盖」列表 + 添加流 + 三态(跟随/全部/指定) | overrides 读写 API + `/features` 清单 + `DataScopeSupport` 按功能取覆盖优先 scope + Redis 缓存键含 feature + 失效钩子 | 加/删覆盖后对应功能查询范围随之变;无覆盖=沿用全局(兼容);smoke 加覆盖窄/删覆盖复原断言 |
| **P3 字段权限(前端+后端脱敏成对)** | §5 字段权限 Tab | 功能选择→字段矩阵(复用 field-perms-editor 形态)+ 全选/反选 + 归一字段清单接入 | `/features/{code}/fields` 归一 + `sys_role_field_perm` 读写 + **响应脱敏(HIDDEN 抹值/READ 拒写)+ 节点级 AND 角色级叠加** | 配 HIDDEN 字段→接口响应确无该字段值(**后端断言**,非仅前端隐藏);配 READ→改该字段被拒;smoke 覆盖脱敏 |
| **P4 JSON 扩展列 + 深度绑定** | §6 红线区兑现 | 维度页「承载列」支持 JSON 源;实体绑定升级 | `sys_dimension_binding`(多实体/JSON)+ `DataScopeSupport` 自动下推 + 表达式索引 + 千万级压测(P95<200ms) | 无物理列维度可过滤且走索引;压测达标 |

- **P1 优先级最高且独立**:纯配置化 UI + 抽屉重构,不碰查询语义,风险最低,先落地建立信心。
- P2 依赖 P1 的维度 + 拍板点 A/C;P3 依赖拍板点 A/B;P4 依赖 P1 绑定 + 拍板点 D。
- 每批 `docs/api-contract.md` 同步新端点(CLAUDE.md 契约同步要求)。

---

## 9. 红线(结构性,与反白屏同级)

1. **脱敏成对(P3 最硬)**:字段权限前端隐藏=体验;**后端响应脱敏(HIDDEN 抹值/剔除、READ 拒写)是权威**,P3 不含后端脱敏=P3 不算完。节点级 × 角色级字段权限**叠加取更严**,规则后端钉死。
2. **维度白名单不破**:授权/覆盖/绑定的维度、取值必须在**已注册启用**的维度 + 其 options 内校验(现 `DataDimensionService.validateItems` 范式),前端传什么后端都要再校,不信前端。
3. **编码即外键,锁定不可改**:`sys_data_dimension.code`、功能标识、字段 key 一旦被授权引用即锁;改码=断链,编辑态置只读。
4. **向后兼容**:不配功能覆盖=全局授权;不配字段权限=全放行;现有 `oa_approval` 多维过滤/部门 5 档行为**逐字不变**。新增只加表/列/端点,不改旧语义(照 V43「仅新增」范式)。
5. **查询侧不 join 授权表、不递归**:功能覆盖解析仍走 Redis 预计算(`dp:dims:{userId}` 扩为含 feature 维),失效钩子覆盖「覆盖变更/字段策略变更」;`col IN (可见集)` 走索引(现 `CriteriaScopes`),超大集切 `= ANY(array)`。
6. **JSON 扩展列不进 P1~P3**:无表达式索引 + 压测前,禁用 JSON 源过滤(维度页对 JSON 承载列置灰),避免大表退化。
7. **防白屏四层照旧**:路由 ErrorBoundary + 每 Tab/岛屿边界 + 列表响应归一 + 新页 jsdom 冒烟,一个不少。

---

## 10. 交付给实施的复用清单(不造新风格)

| 要素 | 复用现成 | 新增(少量) |
|---|---|---|
| 维度授权 UI | `DataDimensionAuthz` + `dp-authz-api.ts`(契约已钉死,零改搬入 Tab) | 维度管理页壳、选项维护小表 |
| 字段矩阵 | `field-perms-editor.tsx` 矩阵 + `permToVisibleEditable`/`groupFields` 纯函数 | 全选/反选工具条、写角色×功能契约的数据层 |
| 字段清单 | `form-manifest.ts`/`form-registry.ts` + `GET /api/wf/forms/{formKey}/fields` | 归一端点 `/api/system/features/{code}/fields`(拍板点 B) |
| 选值弹窗 | `RecordPicker`(自定义/字典源)、`OrgPicker`(部门源) | — |
| 抽屉/Tab | shadcn `Sheet`/`Tabs`/`AlertDialog`(切 Tab 拦截) | 角色详情抽屉壳 |
| 列表/批量 | `DataTable`+`indexColumn`+`batchSlot`+`ErrorBoundary` | — |
| 降级范式 | `withMock`/`normList`(offline/404→演示+banner) | 新端点各套一层 |

**分工**:丹青(本设计稿) → 疾风(维度页 + 角色抽屉 + 字段矩阵前端,照 §2/§3/§5 UI) → 磐石(维度 CRUD/options 分派、overrides、features/fields 归一、`sys_role_field_perm` + **脱敏**、`DataScopeSupport` 按功能解析)。每批四门 + smoke(KEEP=1)。

## 附:主控拍板(2026-07-16,合并磐石底盘查证)

- **A 功能标识**:feature 键=`ai_feature_catalog.feature_code` 的**字符串本身**(如 OFFICE_APPROVALS),但 system 模块只把它当 **opaque string 存储/查询,不依赖目录**(不 join、不 import)——目录消费在前端(/api/ai/features)与 boot 层,依赖方向无损。兼得"零新表+功能粒度+related_form_codes 字段清单"。
- **B 字段清单来源**:P3 先**前端合流**(feature→related_form_codes→逐个 GET /api/wf/forms/{formKey}/fields 合并去重);多表单合流繁琐再补归一端点(放 boot 层,不放 system)。
- **C 功能覆盖语义**:**覆盖=替换**(只看覆盖层,不与全局并集,否则无法收紧)+ **多角色并集放宽** + UI 强提示「该功能已脱离全局配置」。
- **D 绑定深度**:P1 单实体单列;**绑定升格为真元数据消费**(multiDim 的 dimColumns 改读 sys_dimension_binding,废除 ApprovalService 代码常量——磐石缺口①);JSON 扩展列/自动下推=P4。
- **E 角色详情载体**:**Sheet 大抽屉 + 四 Tab**(基本/功能权限/数据权限/字段权限),每 Tab 独立保存+未保存拦截;P1 先落抽屉壳(现有三块原语义搬入),P2/P3 往里加。
- **磐石风险预拍**:①维度值类型 **P1 保持 Long**(DICT 源用字典项 id);②脱敏**不做全局 Jackson**,走「登记出口逐个接入」+P3 先出**出口盘点清单**(wf 详情/BizDoc/打印 render-data/AI 数据帧/导出,漏接=泄露要如实标注);③V52 上线清 `dp:dims:*`(或结构带版本);④editable **后端强制**丢弃非法回传(smoke 覆盖);⑤原串透传的 formDataJson 出口 P3 改「解析-过滤-重序列化」或点名豁免。
- **权限码**:`system:dim:manage`(V51 授 ADMIN);角色/用户配置沿用 system:role:edit / system:user:edit。
- **分批**:P1(V51)维度自定义+选项表+绑定真消费+角色 Sheet 抽屉壳 → P2(V52)功能级覆盖+多实体接入 multiDim → P3(V53)字段权限+脱敏成对+出口盘点 → P4 JSON 扩展列(深水区)。向后兼容红线:未配=现行为完全不变。

## 附2:P3 字段清单真源拍板(2026-07-16,用户讨论后)

- **表单字段(动态 Map 数据):读登记,不造 DTO**——CODE 表单数据在后端是 formDataJson(Map),无强类型 DTO 对应物;真源=登记 manifest/ONLINE schema 派生(FormManifestService 现状),脱敏在 Map 出口按登记 key 删,前端(useForm 字段名)后端(Map key)同键零转换。
- **实体固定列(DTO record 字段):`@FieldPerm(label)` 注解标在 DTO 字段上 + 启动反射生成"可控列目录"**(替换原"手工常量目录"提案)——清单与 DTO 同文件防漂移(与前端 manifest 同文件同哲学);只有标注解的列才进配置矩阵(天然白名单,不假装能控);模式与 @ScriptApi/@AiManaged 一致(启动扫描+缓存,运行期零反射)。
- 红线:清单与脱敏同源同键;前端可选加固——manifest key ⊆ useForm defaultValues key 的守护测试。

## 附3:P2 UI 形态拍板(2026-07-16,用户参考图定稿)

- **「数据权限」Tab 两段式**:①默认权限(全局)=现有部门 5 档+维度授权原样;②**按功能覆盖列表**(用户参考形态):[+添加资源]→每行 功能(资源)下拉 × 维度下拉 × 范围(全部/指定+对应选择器) × 删除;同功能可多行(维度间 AND);覆盖行提示「该功能已脱离全局」。
- **维度下拉动态来自维度目录**:内建「组织(部门)」+ 全部启用的业务维度(含 P1 UI 自建维度,PROVIDER/OPTION/DICT/DEPT 四源);范围选择器按维度 valueSource 出(部门树/选项多选/字典多选)。
- **部门维纳入覆盖层**(比原提案多一条):sys_role_data_dimension 覆盖层允许 dimension='dept'(内建键),scope ALL|CUSTOM values=deptIds——某功能可单独收窄部门范围;无覆盖走全局 5 档;解析顺序不变(功能覆盖>全局>不限,覆盖=替换)。用户级同构。
