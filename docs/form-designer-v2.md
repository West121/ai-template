# 表单设计器 v2 增强规格（企业级 OA）

> 目标：把现有 MVP 级表单设计器（12 控件/线性两列/写死校验/静态选项）提升到企业级 OA 水平（对标钉钉宜搭/简道云），自研增强现有 FormWidget 模型，保持"设计器 ↔ 运行渲染器 ↔ 流程字段绑定 ↔ 节点字段权限"一体化。**不引入 form-create/Formily/amis**。
> 涉及文件：src/types/workflow.ts(FormWidget)、src/pages/workflow/designer/form/**(设计器核心)、src/components/form-renderer.tsx(运行渲染器)、src/pages/demo/form-designer/**(demo)。后端表单定义 schemaJson 为 TEXT 原样存取，模型扩展不影响后端。

## 1. 模型扩展（FormWidget + FormSchema）

```ts
interface FormWidget {
  id: string
  type: string                 // 数据控件 | 容器控件（见 §2）
  label: string
  key?: string                 // 稳定字段标识（提交/联动/校验引用；容器可无）
  placeholder?: string
  description?: string          // 字段说明/提示
  // 布局
  width?: "full" | "half" | { span: number }   // span=1..24 栅格；缺省 full
  // 值与状态
  defaultValue?: unknown        // 默认值（静态；表达式默认值走 events）
  readonly?: boolean            // 设计期只读属性（与节点级 perms 叠加，任一只读即只读）
  hidden?: boolean              // 设计期隐藏
  required?: boolean
  // 校验（§4）
  validation?: ValidationRule[]
  // 选项与数据源（§5）
  options?: Array<{ label: string; value: string }>   // 静态选项（归一化，兼容旧 string[]）
  dataSource?: DataSource
  // 联动（§3）
  visibleWhen?: ConditionGroup  // 满足则显示，否则隐藏并跳过校验
  requiredWhen?: ConditionGroup // 满足则必填
  // 容器 / 子表单（§2）
  children?: FormWidget[]       // grid/group/tabs/collapse 的子控件；subform 的列
  props?: Record<string, unknown>  // 控件专属属性（§2 各容器/控件说明）
  // 事件 / 脚本（§6）
  events?: WidgetEvents         // 字段级事件（onChange 等）
}

interface FormSchema {
  title?: string
  widgets: FormWidget[]
  events?: FormEvents           // 表单级事件 onLoad/onChange/onSubmit
  variables?: Record<string, unknown>  // 表单变量（脚本可读写）
}
```
**向后兼容**：旧 schema（无 children/validation/dataSource/events）必须原样正常渲染；options 兼容 `string[]`（渲染前归一化 `{label,value}`）。FormRenderer 现有调用方（发起中心/实例详情/草稿）props 接口保持兼容。

## 2. 控件体系

### 数据控件（第一波保留现有 + 增强 props）
input / textarea / number（props: precision 精度、min/max、prefix/suffix 单位）/ date（props: mode=date|datetime|daterange）/ radio / checkbox / select（props: multiple）/ user（接真实组织，复用 org-picker）/ rating（props: max 可配）/ switch
### 容器控件（第一波新增，核心）
| type | 语义 | props | children 含义 |
|---|---|---|---|
| `grid` | 栅格容器 | `columns:number`(默认2，24 栅格体系) | 子控件按各自 width.span 排布 |
| `group` | 分组卡片 | `title`, `collapsible?` | 卡片内子控件 |
| `tabs` | 标签页 | `tabs:[{key,label}]` | 各子控件 props.tab 归属某页 |
| `collapse` | 折叠面板 | `panels:[{key,title,defaultOpen?}]` | 各子控件 props.panel 归属 |
| `subform` | **子表单/明细表** | `mode:"table"|"card"`, `min?`,`max?` | children=列/字段定义；运行态=可增删行明细，提交为对象数组 |
### 第二波控件（数据源就绪后）
upload(复用 file-uploader) / richtext / address(省市区级联) / amount(金额+大写) / cascade(级联选择) / relation(关联表单，复用 record-picker) / signature / html / image

## 3. 字段联动（ConditionGroup，复用流程条件模型）
```ts
interface ConditionGroup { logic: "AND"|"OR"; conditions: Condition[] }
interface Condition { field: string; operator: string; value: unknown }  // field=其他控件 key
```
- `visibleWhen` 满足→显示，否则隐藏（隐藏字段不参与校验、不提交）。
- `requiredWhen` 满足→必填。
- 运行渲染器建立 key→value 响应式依赖，watch 相关字段变化实时求值。设计器提供条件构建器 UI（可复用 data-table-advanced-filter 思路，独立实现）。

## 4. 可配置校验（ValidationRule[] → zod）
```ts
type ValidationRule =
 | { type:"required"; message? }
 | { type:"regex"; pattern:string; message? }         // 预设：手机/邮箱/身份证/URL 快捷选项
 | { type:"length"; min?:number; max?:number; message? }
 | { type:"range"; min?:number; max?:number; message? }   // 数值/日期范围
 | { type:"unique"; scope?:string; message? }          // 唯一（子表单内/全表；运行态尽力校验，后端最终把关）
 | { type:"custom"; expr:string; message? }            // 自定义：受限表达式返回 bool
```
设计器属性面板"校验"分区可视化增删规则；渲染器 buildSchema 按规则动态生成 zod + superRefine。

## 5. 选项数据源（DataSource）
```ts
type DataSource =
 | { type:"static" }                                   // 用 options
 | { type:"dict"; dictCode:string }                    // 引用字典管理（/api/system/dicts）
 | { type:"form"; defCode:string; labelField; valueField }  // 关联已发布表单记录（record-picker）
 | { type:"api"; url:string; labelField; valueField }  // 远程接口
 | { type:"cascade"; source:... }                      // 级联（省市区/自定义树）
```
第一波实现 static + dict + form（关联表单）；api/cascade 第二波。

## 6. 事件与自定义脚本（呼应"属性配置化"）
```ts
interface FormEvents { onLoad?: Script; onChange?: Script; onSubmit?: Script }
interface WidgetEvents { onChange?: Script; onFocus?: Script; onBlur?: Script }
type Script = string   // 受限 JS 源码
```
**执行模型（运行渲染器）**：脚本用 `new Function` 构造，注入**白名单上下文 API**，try-catch 隔离，绝不 eval 到后端：
```
ctx = {
  data,                        // 只读当前 formData 快照
  get(key), set(key,value),    // 读写字段值
  setVisible(key,bool), setRequired(key,bool), setReadonly(key,bool),
  setOptions(key,options),     // 动态改选项
  field,                       // 字段事件里=当前字段 {key,value}
  utils: { sum, formatDate, ... }  // 受限工具
}
```
- 表单 onLoad：进入时执行（算默认值/初始联动）；onChange：任意字段变化；onSubmit：提交前（可拦截返回 false 阻止）。
- 字段 onChange：该字段变化时（做值联动/计算）。
- 设计器提供脚本编辑器（textarea + 语法提示 + 可用 API 说明 + 示例），字段/表单属性面板各有"事件"分区。
- 安全：脚本只在前端浏览器执行、操作本表单上下文，不接触网络/DOM（上下文不暴露 window/fetch）；后端存储原样，运行时前端执行。

## 7. 设计器 UI 重构
- **三栏保留**：左组件面板（按 基础/选择/高级/容器 分组）、中画布（支持容器嵌套拖拽：拖控件进容器、容器内排序、容器可嵌套 subform 除外限一层）、右属性面板。
- **属性面板分区**（Tab 或折叠）：基础属性 / 校验 / 联动 / 数据源 / 事件脚本 / 控件专属(props)。
- **表单级设置**：顶部入口配置表单事件/变量/标题。
- 保留：拖拽排序、复制、删除；新增：撤销/重做（history 栈）、JSON 导入（粘贴/上传）、预览（真实渲染+联动+校验+事件）。

## 8. 分波实施
- **第一波（地基+核心，先做）**：模型重构 + 设计器/渲染器框架重构（递归容器 + 属性面板分区）+ 容器控件(grid/group/tabs/collapse) + **子表单/明细表** + 字段联动(visibleWhen/requiredWhen) + 可配校验 + 默认值/只读/隐藏 + 表单/字段事件 + 自定义脚本 + 撤销重做/JSON导入/预览。数据源先做 static+dict+form。**必须保持 FormRenderer 对发起/详情/草稿的向后兼容**。
- **第二波（扩充，地基后并行）**：更多控件(upload/richtext/address/amount/cascade/relation/signature) + 数据源 api/cascade + 模板库。
- 每波：tsc+build 通过、demo form-designer 与 workflow form-defs 双入口可用、浏览器截图巡检（子表单/容器/联动/校验/事件配置各截一张）、旧 schema 不回归。

## 9. 实施进度

### 第一波（已完成）
模型 + 渲染器引擎 + 设计器重构全部落地，`tsc --noEmit` 与 `pnpm build` 均通过，浏览器自检六张截图全部验证正常，种子 leave 表单在发起中心无回归、无 console 报错。

**改动文件**
- `src/types/workflow.ts`：FormWidget 扩展（children/props/validation/dataSource/visibleWhen/requiredWhen/defaultValue/readonly/hidden/events）+ FormSchema（events/variables）+ 新增子模型类型（ConditionGroup/FormCondition/ValidationRule/DataSource/WidgetEvents/FormEvents/WidgetOption）+ WidgetType 增容器类型；parseFormSchema 透传 events/variables。**向后兼容**：全部新字段可选。
- `src/lib/form-runtime.ts`（新增）：无 UI 运行时引擎——选项归一化、字段扁平化（容器透明/subform 视为叶子）、条件求值（联动 11 种算子）、校验规则求值（含手机/邮箱/身份证/URL 正则预设 + length/range/custom）、受限脚本执行（new Function + 白名单 ctx，try-catch 隔离，不暴露 window/fetch/DOM）、scriptUtils。
- `src/components/form-renderer.tsx`（重写）：递归容器渲染（grid/group/tabs/collapse）+ 子表单明细（useFieldArray，table/card，提交为对象数组）+ 联动（form.watch 响应式 visibleWhen/requiredWhen）+ 动态 zod（superRefine 读实时值 + overrides ref）+ 事件（onLoad/onChange/onSubmit 可拦截、字段 onChange）+ 数据源（static/dict 远程/form 占位）+ 默认值/只读/隐藏。**props 接口不变**，新增可选 formEvents/variables，发起/详情/草稿调用方零改动。
- `src/pages/workflow/designer/form/model.ts`：容器/subform 类型 + WIDGET_META「容器」分类 + createWidget 容器默认（columns/tabs/panels/subform 列）+ ensureWidgetIdSeq 递归；FormWidget 扩展与运行时结构兼容。
- `src/pages/workflow/designer/form/designer-core.tsx`（重写）：三栏 + 中画布容器嵌套拖拽（树操作 insertBefore/After/appendTo/removeFromTree/防自身后代）+ 右属性面板分区（基础/选项数据源/校验/联动/事件脚本/控件专属）+ 顶部工具条（撤销/重做 history 栈、JSON 导入、表单设置=事件/变量/标题、预览=复用 FormRenderer）。FormPreview 改为委托 FormRenderer。
- `src/pages/workflow/designer/form/fields.ts`：递归收集可绑定字段（容器透明下钻、跳过容器/subform 本体）。
- `src/pages/workflow/form-defs.tsx`：EditorState + schemaJson 持久化 events/variables，并传入 FormDesignerCore（受控）。
- `src/pages/demo/form-designer/model.ts`：initialWidgets 增补联动示例（紧急原因 visibleWhen/requiredWhen）+ 子表单示例（工作交接明细）。

**能力完成度**：容器控件✅ 子表单✅ 联动(显隐/必填)✅ 可配校验(6 类+预设)✅ 默认值/只读/隐藏✅ 表单&字段事件脚本✅ 数据源 static✅ dict✅（接 /api/infra/dict）form🟡（渲染占位，待关联记录端点）撤销重做✅ JSON 导入✅ 预览(真实联动/校验/事件)✅。

**遗留/备注（第一波）**：① 脚本用 new Function 执行设计者编写的受限 JS（§6 明确要求），仅前端、白名单 ctx、无网络/DOM，信任模型=表单设计者（管理员）；② dict 数据源按 dictCode→types 列表→items 两跳解析（无 by-code 端点），后端如提供 by-code 可简化；③ 本地自检：后端 CORS 仅放行 5173，dev 需跑在 5173。

### 第二波（已完成）

控件扩充 + 数据源全部落地，`tsc -b --noEmit` 与 `pnpm build` 均通过，浏览器自检六张截图（新控件画布 / 运行预览 / 模板库 / 关联表单数据源 / 栅格跨列调宽 / 入职模板栅格）全部正常，无 console 报错；第一波与旧 schema 无回归。

**新增控件（9 个）**：`upload`（复用 file-uploader，存 `{id,name}[]`）、`image`（图片上传，缩略图预览，下载失败降级图标）、`richtext`（contentEditable + 加粗/斜体/下划线/列表工具栏，存 HTML）、`amount`（数字 + 千分位 + 人民币大写实时显示，前缀可配）、`address`（内置简化省市区三级级联，存 `{value,label}[]`）、`cascade`（通用级联，数据源驱动：内置省市区 / 自定义树 JSON）、`relation`（复用 record-picker，存唯一值+展示名分离 `{value,label}[]`，远程记录端点失败降级演示数据）、`signature`（canvas 手写 → dataURL）、`html`（静态 HTML 布局，归入布局类）。

**数据源扩充**：`api`（url + labelField/valueField，兼容 `T[]` 或 `{list:T[]}` 返回，无接口降级空选项）落地到 select/radio/checkbox 与子表单列；`cascade`（preset:"region" 内置 / tree 自定义）；`form` 关联记录选择器由第一波占位升级为 record-picker 真正选记录。

**user 接组织**：`user` 控件复用 org-picker，存 `OrgRef[]`（成员/部门/角色），单/多选可配；`isEmpty` 兼容旧字符串（string 视为回显、空数组/空串均判空），旧数据只读回显不丢失。

**模板库**：新增 `templates.ts` — 内置 4 套模板（请假申请/费用报销/采购申请/入职登记，覆盖子表单/金额大写/关联表单/栅格+校验+省市区+签名）+「另存为模板」（localStorage 持久化）+「应用模板」（替换 widgets/标题）+ 删除自定义模板；工具条「模板库」入口。

**栅格可视化调宽**：字段宽度新增「栅格跨列」模式 + 1–24 列下拉，写入 `width:{span}`，渲染器按父 grid columns 折算 gridColumn。

**子表单列完整属性**：列行内保留 标签/类型/必填 快捷编辑，新增齿轮按钮打开 Modal 内嵌完整 PropertyPanel（校验/必填/默认值/数据源/联动/描述/占位/key），列类型扩到 input/textarea/number/amount/date/select/user；SubformCell 改用 useWidgetOptions 支持列级 dict/api 数据源。

**改动文件（第二波）**：`src/types/workflow.ts`（WidgetType 增 9 类 + CascadeNode + DataSource.cascade 细化为 preset/tree）；`src/lib/form-runtime.ts`（KNOWN_LEAF/LAYOUT 扩容、isNumericType、widgetDefault 新类型、isEmpty 兼容 relation 对象、formatThousands/toChineseAmount、CN_REGIONS 简化行政区、dataSourceLabel 已含 api/cascade）；`src/components/form-renderer.tsx`（新增 UserField/UploadField/RichTextField/AmountField/Address&CascadeField/RelationField/SignatureField + html 布局 + useWidgetOptions 接 api + 数值型 amount 承载 + ComplexField 分发）；`src/pages/workflow/designer/form/model.ts`（WIDGET_META/图标/「高级字段」分类/createWidget 默认）；`designer-core.tsx`（新控件设计预览 + 数据源 api / relation / cascade 配置 + 栅格跨列 + 子表单列完整属性 Modal + 模板库 UI）；`designer/form/templates.ts`（新增）；`demo/form-designer/model.ts`（追加第二波控件展示）。

**遗留/备注（第二波）**：① richtext 与 html 用 dangerouslySetInnerHTML 渲染设计者/填写者自撰 HTML，信任模型同脚本（管理员/本表单上下文），生产接入不可信来源时应加 DOMPurify 净化；② 关联记录端点按 `/api/wf/form-defs/{defCode}/records` 约定，后端未提供时降级为内置演示数据集；③ image 预览依赖 `/api/infra/files/{id}/download`，该端点需 Bearer 鉴权，`<img>` 无法带 header 时回退占位图标（不影响存储与提交）；④ 行政区为内置简化三级（主要省市），完整数据可替换 CN_REGIONS 或改用 dataSource.tree/api。
