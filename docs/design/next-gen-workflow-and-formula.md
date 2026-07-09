# 下一代流程设计器 · 表单字段联动 · 公式与脚本引擎 —— 架构设计

> 创建：2026-07-09 · 作者：主控 · 状态：**决策已锁定（2026-07-09）**，待用户确认脚本治理模型后进入实现
>
> **锁定决策**：① 真相源 = Option B（前端归一化 JSON + 后端转 BPMN）。② 公式 = 安全表达式引擎 Aviator（Tier 1）；脚本 = **LiteFlow** 多语言（Tier 2，Groovy 作 Java 脚本 + Jython/Py2 作 Python + 前端 JS），治理五条落实。③ 非在线表单 = 仅本仓库手写 react-hook-form 表单（registry 方案）。唯一 gating：N-B-00 spike 验证 LiteFlow × Spring Boot 4。
> 背景：后端为 Flowable 8（BPMN 2.0 引擎）。用户决定：流程以 BPMN 为主；用 react-flow(@xyflow/react) 自研符合 BPMN 规范的设计器替换 bpmn-js；解决"非在线设计的自定义表单"如何向流程暴露字段以配置显隐/必填；重构计算公式，达到市面高级公式设计水准，后端可自定义公式代码，并纳入脚本能力。
>
> 本设计会取代 remediation-plan 中若干前端条目：**F-05/F-10/U-02/U-03（bpmn-js 相关）作废或重定义；F-01（form-runtime 假沙箱）并入本文第三部分；Q-02 中 serde/formula 单测随新实现重写。**

---

## 第一部分 · react-flow 自研 BPMN 设计器（替换 bpmn-js）

### 1.1 核心决策：谁是"真相源"（Source of Truth）

**决策点 ①**——两种模型：

| | Option A：客户端产出 BPMN XML | **Option B：客户端产出归一化 JSON，服务端转 BPMN（推荐）** |
|---|---|---|
| 客户端 | react-flow 图 ⇄ BPMN 2.0 XML（含 DI 布局、waypoint 路由）全在前端手写 | react-flow 图 ⇄ 归一化 `ProcessModel` JSON（含坐标）|
| 服务端 | 直接部署 XML | 复用/扩展现有 `JsonToBpmnConverter`：JSON → `BpmnModel` → 部署；用坐标生成 BPMN DI |
| BPMN 互操作 | 天然 | 用 Flowable 自带的 `BpmnXMLConverter`（classpath 已有）做 **XML ⇄ BpmnModel ⇄ 我方 JSON** 的导入导出端点 |
| 成本 | 高：DI/waypoint 序列化正是 bpmn-js 帮我们做的活,重写风险大 | 低：后端转换器已存在且被 smoke test 覆盖；前端只写画布层 |
| BPMN 纯度 | 前端即纯 BPMN | BPMN 纯度在服务端,客户端是纯 JSON |

**推荐 Option B**。理由:Flowable 消费的是 `BpmnModel`,现有 `JsonToBpmnConverter` 已把钉钉式 JSON 稳健转成 `BpmnModel` 并有冒烟覆盖。在前端重写完整 BPMN XML 序列化(尤其 DI 布局与连线路由)等于把 bpmn-js 的核心价值重造一遍,工作量与缺陷面都大。改为:前端只产出结构上 1:1 映射 BPMN 元素的归一化 JSON(含 x/y/waypoints),服务端转 `BpmnModel` 并据坐标补 BPMN DI;需要导入/导出标准 `.bpmn` 时,走服务端 Flowable `BpmnXMLConverter`——**客户端永远不手写 XML**。

### 1.2 归一化模型 `ProcessModel`

统一取代现有 dingtalk `model.ts` + `designerJson` 与 bpmn `serde` 两套。结构(TS 草图):

```ts
interface ProcessModel {
  key: string; name: string; version: number;
  nodes: FlowNode[];      // 映射 BPMN FlowNode
  edges: SequenceFlow[];  // 映射 BPMN sequenceFlow
  // 布局与 nodeProps 内联,便于服务端补 DI
}
interface FlowNode {
  id: string;
  type: BpmnType;         // startEvent|userTask|serviceTask|exclusiveGateway|parallelGateway|inclusiveGateway|callActivity|subProcess|timerBoundary|endEvent
  name: string;
  position: { x: number; y: number };
  size?: { w: number; h: number };
  props: WfNodeProps;     // 复用现有 designer/types.ts —— 不动
}
interface SequenceFlow {
  id: string; source: string; target: string;
  waypoints?: {x:number;y:number}[];
  isDefault?: boolean;
  condition?: BranchCondition;  // 结构化,复用现有类型
}
```

关键:`WfNodeProps`(assigneeRules / multiMode / emptyStrategy / formPerms / events…)与共享 **PropertyPanel 完全复用**——它们本就与设计器解耦(`target = process | {nodeId,nodeType}`)。**所以这次"重写"实质只是替换画布层 + 序列化层,领域模型与属性面板不动**,这是最大的省力点。

### 1.3 react-flow 画布层

- **自定义节点组件**:每种 BPMN 元素一个 React 组件(圆形起止事件、圆角矩形用户任务、菱形网关、双框子流程、边界定时器)。OA 扩展节点(抄送/AI/Webhook)映射为带 listener 的 serviceTask。
- **自定义边**:`SequenceFlowEdge` 带条件标签 + 默认分支标记;网关出边强制配置条件或默认。
- **交互**:拖拽调色板新增、连线时按 BPMN 规则做连接校验(起始无入边、结束无出边、网关须成对/分叉合流、禁止悬空)、`elkjs`/`dagre` 自动布局(用于导入的 .bpmn 或 AI 生成流程)。
- **校验层**:合并现有 `bpmn/oa/validate.ts` 与 `dingtalk/validate.ts` 为一个模型级校验器,保存前拦截。
- **只读态**:实例详情复用同一套节点组件渲染 + 高亮当前节点/已完成路径(替换 bpmn-js 的高亮),数据来自 Flowable 运行时。

### 1.4 服务端改动(交「磐石」)

1. 扩展 `JsonToBpmnConverter` 接受统一 `ProcessModel`(是现钉钉 JSON 的超集,补齐并行/包容网关、定时边界、子流程),据 `position/waypoints` 生成 BPMN `DI`,使部署出的 BPMN 带正确图形信息。
2. 新增 `POST /api/wf/models/import`(.bpmn XML → ProcessModel)与 `GET /api/wf/models/{id}/bpmn`(导出 XML),内部用 Flowable `BpmnXMLConverter`。
3. `ConditionCompiler` 的 UEL 结构化路径保持不变(见第三部分,简单条件仍走 UEL 保证 Flowable 原生高性能)。

### 1.5 迁移与清理

前端删除 `bpmn-js`、`diagram-js-grid` 依赖,保留 `@xyflow/react`;删除 `designer/bpmn/`,新建 `designer/flow/`(canvas + nodes + edges + serialize);`designer/dingtalk/` 作为"简易模式"可保留或收敛进新设计器的布局预设。remediation 的 F-05(拆 property-panel)因面板被原样复用而不再必要;F-10(bpmn 懒加载)作废。

---

## 第二部分 · 非在线表单如何向流程暴露字段(显隐/必填/编辑)

### 2.1 问题

在线设计的表单有 `schemaJson`,流程节点可内省字段做 `formPerms`(每节点 visible/editable/required)。但**开发者手写的 React 表单 / 外部系统表单**没有 schemaJson,流程节点配置界面不知道有哪些字段可配。

### 2.2 方案:统一"字段清单契约"+ 表单提供者接口

所有表单(无论来源)必须发布机器可读的字段清单 `FormFieldManifest`,收敛到统一 `FormProvider` 抽象:

**范围已锁定**:只覆盖两类表单——ONLINE(在线设计器)与 CODE(本仓库手写 react-hook-form 表单)。不做外部系统表单(EXTERNAL 暂不实现)。

```ts
type FormType = 'ONLINE' | 'CODE';
interface FormFieldManifest {
  formKey: string;
  formType: FormType;
  fields: FieldDescriptor[];      // key,label,type,group,可选 options/dataSource
}
interface FieldPolicy { visible: boolean; editable: boolean; required: boolean }
```

- **ONLINE**:清单由 `schemaJson` 派生(已有能力)。
- **CODE**:手写的 react-hook-form 表单在组件旁静态导出清单并注册:
  ```ts
  // 某手写 react-hook-form 表单
  export const formMeta: FormFieldManifest = { formKey:'leave', formType:'CODE',
    fields:[{key:'days',label:'请假天数',type:'number'}, ...] };
  registerForm('leave', { component: LeaveForm, manifest: formMeta });
  ```
  前端维护 `formRegistry: formKey → { component, manifest }`。react-hook-form 的 `useForm` 字段名与 manifest 的 `key` 必须对齐——可用一个小工具从 zod schema 或字段常量派生 manifest,减少手工维护漂移。

### 2.3 统一端点

`GET /api/wf/forms/{formKey}/fields` → 返回 `FormFieldManifest`,与来源无关(ONLINE 从 schemaJson,CODE/EXTERNAL 从后台登记的清单)。后端 `wf_form_def` 增加 `form_type` 与"仅字段清单"存储(CODE/EXTERNAL 不存 schemaJson)。

### 2.4 设计时 & 运行时

- **设计时**:流程节点的"字段权限"编辑器按 `formKey` 拉 manifest,渲染 visible/editable/required 矩阵,写入该节点 `WfNodeProps.formPerms`(已有字段,不新增模型)。
- **运行时**:任务领取时引擎回传该节点 `formPerms`;
  - ONLINE 表单:`form-renderer` 已支持 `visibleWhen/requiredWhen`,叠加节点级 `formPerms`(取交集,节点策略优先)。
  - CODE 表单(react-hook-form):注册的组件必须接收 `fieldPolicy: Record<key, FieldPolicy>` 约定属性;包裹层(`<HostedForm formKey formData fieldPolicy>`)通用地处理 visible(不渲染)与 readonly(react-hook-form 字段 `disabled`),required 通过在包裹层向该字段的 zod/rules 注入必填校验实现。组件遵守该契约即获得节点级联动能力。

**产出契约**:`FormFieldManifest` / `FieldPolicy` / `formRegistry` / `HostedForm` 包裹层 + 后端 `/fields` 端点。这样"节点字段权限编辑器"与"运行时渲染"消费同一份清单,在线与手写表单统一。

---

## 第三部分 · 公式与脚本引擎重构

### 3.1 现状问题

- 前端 `form-runtime.ts` 用 `new Function` 假沙箱(F-01,安全谎言:window/fetch/localStorage 全可达)。
- 后端 `FormulaEvaluator`(工作流,手写解析器)与 `ConditionCompiler`(结构化→UEL)各自为政;**表单计算公式(前端)与工作流条件/处理人公式(后端)是两套系统**,函数集不通用。

### 3.2 目标架构:两层,职责与信任级别截然不同

关键区分:**公式(Tier 1)安全无副作用、高频求值(每次击键 / 每次网关)、任何人可用;脚本(Tier 2)完整权限、可有副作用、低频、仅受信管理员可写。两者绝不能混——把脚本的全权限下放到公式高频路径会同时炸掉性能和安全。**

#### Tier 1 —— 公式(表达式,安全、无副作用)

表单计算字段与工作流条件共用同一门表达式语言,类电子表格函数语法:`SUM(items.amount) > 1000 && TODAY() - startDate > 3`。

- **后端引擎**:放弃手写解析器,选可嵌入、可注册自定义函数、**可禁反射/禁任意对象访问**的引擎。**推荐 Aviator**(高性能、天生适合安全表达式、自定义函数干净);QLExpress 亦可但其强项在脚本层。
  - "后端可自定义公式的代码" = 以 `@FormulaFunction` Bean 注册 Java 实现的纯函数(`deptLeader(user)`、`dictLabel(code,val)`、`workDays(a,b)`),引擎运行时可见,业务方按需增函数。**Tier 1 自定义函数是白名单纯函数,不暴露 ApplicationContext**——要调 Bean 的属于 Tier 2 脚本。
- **工作流条件**:简单结构化条件仍编译 **UEL**(Flowable 原生、快,保持现 `ConditionCompiler` / 前端 `serde` 字节级互镜像不变);"高级公式"条件走引擎(网关调 `${exprEval.eval(execution,'表达式')}` Bean)。**简单走 UEL、高级走引擎**,跨端字节兼容约束只锁在简单路径。
- **前端实时预览**:表单计算不可能每次击键调后端。用**安全客户端 AST 解释器**(`jsep` + 受控求值,或 `formulajs`/`hot-formula-parser`)——**绝不用 `new Function`**;提交以后端为准。直接消灭 F-01 假沙箱。

#### Tier 2 —— 脚本(多语言,完整 Spring 上下文,受信)

用于表达式表达不了的复杂逻辑:多步、读写流程变量、**调用应用内 Spring Bean / 类 / 方法**(用户明确要求)。这是权限最高的能力。

**后端引擎选定:LiteFlow(dromara,已核实)作为多语言脚本执行器。** 用户提议,评估后采纳——一个框架即覆盖 Groovy / JavaScript(GraalJS)/ QLExpress / Aviator / Lua / Python 六种脚本语言 + Java/Kotlin,自带 SPI 选择与启动预编译(性能接近原生),直接满足"支持多种脚本"。**明确边界:Flowable 仍是唯一流程引擎;LiteFlow 只当嵌入式脚本执行器**,在 Flowable 节点/监听器里被调用——不引入第二个编排引擎与 Flowable 打架。

- **脚本访问 Spring / Java(已核实机制)**:LiteFlow 用 `@ScriptBean("x")` / `@ScriptMethod` 显式把 Bean/方法暴露给脚本,`@ContextBean` 暴露上下文,`includeMethodName/excludeMethodName` 收敛可调方法。**这套"显式暴露"模型恰好是治理优势**——脚本只能调被刻意放出来的东西,而非裸奔整个容器。要满足"能调任意类方法",就注册一个 `@ScriptBean("spring")` 的门面(包 `ApplicationContext`,`spring.bean(name)`),把"全量可达"作为最高信任脚本的显式选项;默认仍走白名单门面(dict/org/http/db 等)。
- **三类脚本目标**:
  1. **Java 脚本 → LiteFlow Groovy**(`liteflow-script-groovy`,官方推荐,语法最近 Java)。
  2. **Python 脚本 → LiteFlow Python = Jython(Python 2)**(`liteflow-script-python`)。**⚠️ 关键限制:LiteFlow 的 Python 走 Jython,只支持 Python 2、无 C 扩展(numpy/pandas 不可用),且需在启动类初始化 `PythonInterpreter`。** 若确需 Python 3,LiteFlow 覆盖不了,须另接 GraalPy(额外依赖)——见 3.4 待确认。
  3. **前端脚本 → 浏览器内 UI 逻辑**(字段联动、自定义校验、动态选项、计算显示)。**运行在浏览器,够不到 Spring**;要服务端数据走 `api()`。残余风险是自伤 XSS / 读 token——办法是**诚实标注受信边界 + 权限门禁**,`new Function` 可留但删掉"绝不暴露 window/fetch"的虚假声明(F-01 真正的修复是诚实,不是假装隔离)。
- **统一后端封装:`ScriptService`**——把 LiteFlow 脚本执行包一层,注入统一上下文(流程变量 `vars`、表单 `form`、`execution`),用 `@ScriptBean` 门面暴露 `spring`/`log`/`http`/`db`;LiteFlow 已做预编译缓存,我方补**执行超时(看护线程 + 中断)与资源限额**。前端脚本不经此路径(浏览器内执行)。
- **接入点**:工作流新增 `scriptTask` 节点 + `execution/task` 监听器钩子 + 高级条件/处理人可接脚本;表单可挂服务端 `onSubmit` 钩子跑后端脚本。每段脚本建模为一个 LiteFlow 脚本组件/链,由 Flowable 的 `JavaDelegate`/监听器传入上下文后调用。

### 3.3 脚本治理(安全边界,硬约束)

Tier 2 脚本 = 完整应用权限,等价于"把 Java 代码提交进仓库",治理必须落实:

1. **作者权限收口**:新增独立权限码 `wf:script:write`,只发平台管理员/开发;普通用户即使能配流程也不能写/改脚本。
2. **脚本是定义态工件,非运行时用户输入**:随流程/表单定义版本化、走部署审核,禁止最终用户运行时注入脚本体。
3. **全量审计**:每次执行记录 who / 哪段脚本 / 何时 / 耗时 / 结果(`wf_script_exec_log` 或复用 `wf_operation`);"测试运行"端点同权限、同审计。
4. **不撒谎**:文档与 UI 明确"后端脚本以应用完整权限运行,等同受信代码";杜绝任何"已沙箱/隔离"虚假措辞,前端脚本同理。
5. **限额兜底**:超时、内存/语句上限,防死循环与资源耗尽(防 bug,不防作者)。

### 3.4 重构落地 + 待确认

- 后端新增 `ExpressionService`(Tier 1 引擎,推荐 Aviator——LiteFlow 已带,可共用 + `@FormulaFunction` 注册表)与 `ScriptService`(Tier 2 封装 LiteFlow + 上下文注入 + `@ScriptBean` 门面 + 超时限额 + 治理);统一表单计算、流程条件、处理人公式到同一表达式函数库。
- 前端:公式设计器(函数/字段选择 + 实时校验,产出规范表达式串)+ 安全 AST 预览解释器;脚本编辑器(Java/Groovy、Python、前端 JS 三类,含语言标签与"测试运行");**删除 `form-runtime.ts` 的 `new Function` 假沙箱声明**。
- **全部已定(2026-07-09)**:脚本引擎 = LiteFlow;Java 脚本 = LiteFlow Groovy;**Python = LiteFlow Jython(Python 2),全部脚本收敛进 LiteFlow,不引 GraalPy**;治理 = 3.3 五条照此落实,`wf:script:write` 仅限管理员。Jython 限制(Py2 语法、无 C 扩展、启动初始化 `PythonInterpreter`)已知悉并接受。
- **✅ N-B-00 spike 已验证通过(2026-07-09)**:LiteFlow **2.16.0** 在 Spring Boot 4.0.1 / Java 21 下可用,四项实测全绿,无需回退。**关键修正:SB4 必须用专门坐标 `com.yomahub:liteflow-spring-boot4-starter:2.16.0`(不是普通 `liteflow-spring-boot-starter`,后者仅 SB2/3)**;脚本插件 `liteflow-script-groovy` / `-graaljs` / `-python`(Jython 2.7.4)同版本。`@ScriptBean("spring")` 门面让脚本拿到 Spring Bean 已验证(Groovy/GraalJS/Jython 三引擎均通过);Jython 在 Java 21 无需特殊 JVM 参数即跑通(仅 Py2、无 C 扩展)。**依赖体积**:全套 +~118MB(Jython 49MB、GraalJS 63MB、Groovy+LiteFlow 本体 ~9MB)——体积几乎全来自脚本引擎本身,与选 LiteFlow 无关。若按需砍语言:仅 Groovy≈+9MB。

---

## 附录 A · `ProcessModel` 归一化契约规格（路径三·N-F-00,2026-07-09 定契约)

> 契约实现:`src/pages/workflow/designer/flow/model.ts`(纯类型,禁 any,`import type` 复用 `WfNodeProps`/`BranchCondition`/`FlowConfig`)。
> 本节是 1.2 的落地补充,是后续 **N-B-01(扩展转换器)** 与 **N-F-01(react-flow 画布)** 的共同契约依据。

### A.1 顶层结构与设计原则

`ProcessModel = { schemaVersion:1, key, name, version?, formKey?, flowConfig?, nodes: FlowNode[], edges: SequenceFlow[] }`。

根本原则:**与 BPMN 2.0 是"图"1:1 映射,不是"树"**。
- 旧钉钉 `designerJson` 是嵌套线性树(`nodes[]` + `branches[].steps[]` 递归),**没有** startEvent/endEvent、**没有**网关节点、**没有**边、**没有**坐标——这些全由后端 `JsonToBpmnConverter` 在转换时凭空合成(合成网关成对、合成顺序流、`autoLayout()` 合成坐标)。
- `ProcessModel` 把这些全部显式化:startEvent/endEvent/exclusive|parallel|inclusiveGateway 都是**一等节点**,连线是**显式 `edge`**,坐标/waypoints 由**前端画布产出**。后端不再合成拓扑,只做「图 → BpmnModel」的直译 + 据坐标补 BPMN DI。
- 因此 `ProcessModel` 是旧 `designerJson` 的**严格超集**:旧能表达的(审批/抄送/条件/并行/包容/子流程/定时/触发/AI/自动通过拒绝)全覆盖,并新增旧表达不了的(成对 fork-join 任意拓扑、嵌套 `subProcess`、`timerBoundary` 边界定时、周期定时 `cycle`、边级高级公式条件)。

### A.2 字段逐项说明

**ProcessModel(顶层)**
| 字段 | 说明 | 旧对应 |
|---|---|---|
| `schemaVersion` | 恒为 `1`,后续演进迁移判别 | 无(旧无版本) |
| `key` | BPMN process id(服务端 sanitize) | `defCode`(转换器入参) |
| `name` | 流程名 | `name`(转换器入参) |
| `formKey` | `formCode:version`,写入各 userTask formKey | 转换器入参 `formKey` |
| `flowConfig` | 复用 `shared/config.ts` 的 `FlowConfig`(操作开关/启动/流程变量) | `designerJson.flowConfig`,原样 |
| `nodes` | 扁平 `FlowNode[]` | `designerJson.nodes`(但旧是嵌套树) |
| `edges` | 显式 `SequenceFlow[]` | 无(旧由后端合成) |

**FlowNodeBase(所有节点共有)**:`id` / `name` / `position{x,y}` / `size?{w,h}` / `props?: WfNodeProps`。
- `position`/`size`:前端画布坐标,服务端生成 `BPMNShape`。旧无(后端 autoLayout)。
- `props`:**审批域属性一律走 `WfNodeProps`**(assigneeRules/multiMode/voteConfig/emptyStrategy/ccUsers/formPerms/timeout/events/handleOptions/auditMenu/commentRequired…)。共享 PropertyPanel 原样复用,零改动。
- **关键迁移点**:旧钉钉「分支条件」挂在 `nodeProps[branchId].condition`;新模型**条件迁到 `edge.condition`**——网关出边即分支,条件是边的属性,不再是节点属性。

**SequenceFlow(边)**:`id` / `source` / `target` / `name?` / `waypoints?: Point[]` / `isDefault?` / `condition?: BranchCondition` / `expression?: string`。
- 条件三态(互斥优先级 `expression` > `condition` > 无):`condition` 走结构化 → 后端 `ConditionCompiler` 编译 UEL(**跨端字节兼容红线**);`expression` 是高级公式逃生口(Tier 1 引擎,原样下发);皆空即无条件顺序边/并行出边。
- `isDefault`:网关默认出边的**唯一真相源**,后端据此设置 `gateway.default`(不在网关节点上再存一份,避免双真相源)。

### A.3 与旧 dingtalk model 的节点对应

| 旧钉钉 StepNode.kind | ProcessModel FlowNode.type | 迁移说明 |
|---|---|---|
| `approval` | `userTask` | props 原样;`assignees`/`mode` 冗余字段废弃(以 props.assigneeRules/multiMode 为准) |
| `cc` | `cc` | 抄送人从 `step.users` 迁到 `props.ccUsers` |
| `condition` | `exclusiveGateway`(成对 split/join)+ 出边 | 每个 branch → 一条网关出边,`branch` 内 condition → `edge.condition`,默认分支 → `edge.isDefault` |
| `inclusive` | `inclusiveGateway`(成对)+ 出边 | 同上 |
| `parallel` | `parallelGateway`(成对 fork/join)+ 无条件出边 | 分支 → 无条件出边 |
| `subprocess` | `callActivity` | `defCode/async/paramMap` → `callActivity` 配置 |
| `timer` | `timerCatch` | 中间捕获定时,`mode/value` 保留;另新增 `timerBoundary`/`cycle` |
| `trigger` | `serviceTask{service.impl:"trigger"}` | triggerType/handler/webhookUrl/timer 迁入 service |
| `ai` | `ai` | model/systemPrompt/formContext/outputMap → `ai` 配置 |
| `autoApprove` | `serviceTask{service.impl:"autoApprove"}` | — |
| `autoReject` | `serviceTask{service.impl:"autoReject"}` + 尾接 `endEvent{terminate:true}` | 旧转换器自动补 terminate end;新模型显式化 |
| (无) | `startEvent` / `endEvent` | 旧由后端合成,新模型显式一等节点 |
| (无) | `subProcess`(嵌入式,含 children 子图) | 新增 |
| (无) | `timerBoundary` | 新增(边界定时,中断/非中断) |

### A.4 迁移注意点

1. **树 → 图的一次性转写**:旧 `designerJson` 载入时需一个 `designerJson → ProcessModel` 适配器(遍历嵌套树,合成 start/end、把每个 condition/parallel/inclusive 展开为成对网关 + 边、把分支条件搬到边、跑一次 dagre/elk 补坐标)。这是 N-F-01 画布导入旧定义的必经步。
2. **条件位置搬迁**:凡读写分支条件的旧代码路径,目标从 `nodeProps[branchId].condition` 改为 `edge.condition`。
3. **UEL 字节兼容不动**:`edge.condition`(结构化)→ 后端 `ConditionCompiler` 的编译规则、operator 符号映射(`== != > >= < <= contains notContains`)保持与现 `dingtalk/serialize.ts` 一致,简单条件仍走 UEL。
4. **props 零改动**:`WfNodeProps` 及 `shared/config.ts` 的 `FlowConfig` 不动,PropertyPanel 复用——这是本次重写最大省力点。
5. **`.bpmn` 往返**:`ProcessModel` 字段选型保证 Flowable `BpmnXMLConverter` 可无损往返(坐标↔DI、条件↔conditionExpression、OA 配置↔`oa:` extensionElements)。

---

## 附录 B · BPMN 映射表(N-B-01 / N-F-01 共同依据)

每个 `ProcessModel` 节点/边 → BPMN 元素 + 所需 `oa:` extension 字段 + **后端 `JsonToBpmnConverter` 需新增支持点**。

> 现状基线:现转换器 `JsonToBpmnConverter` 消费**嵌套树**,自行合成 start/end/网关/顺序流/坐标,已支持节点类型:approval、cc、condition、inclusive、parallel、autoApprove、autoReject、webhook、subprocess、timer、trigger、ai。
> **N-B-01 的本质改动**:新增一条**图直译**代码路径(`ProcessModel → BpmnModel`),与旧树路径并存或替换——把「合成拓扑」改为「直译显式节点+边」,并**消费前端坐标生成 DI**(替代 `autoLayout()`)。

| ProcessModel type | BPMN 元素 | delegate / 关键属性 | oa: extension 字段 | 后端 N-B-01 需新增支持 |
|---|---|---|---|---|
| `startEvent` | `StartEvent` | id/name | — | **新增**:直接消费显式 start 节点(旧固定合成 id="start") |
| `endEvent` | `EndEvent`(terminate 时加 `TerminateEventDefinition`) | — | — | **新增**:消费显式 end(旧固定合成 id="end";terminate 旧仅 autoReject 内部用) |
| `userTask` | `UserTask` | assignee `${assignee}` + 多实例 / candidateUsers | `assigneeRules` `multiMode` `voteConfig` `emptyStrategy` `allowedOps` `handleOptions` `timeout` `formPerms` `auditMenu` `commentRequired` `events`(+taskListener) | 逻辑复用现 `approval()`,改为从 `props` 取值 |
| `serviceTask{autoApprove}` | `ServiceTask` | `${wfAutoDecide}` autoDecision=APPROVE | `autoDecision` | 复用现 `autoApprove()` |
| `serviceTask{autoReject}` | `ServiceTask` | `${wfAutoDecide}` autoDecision=REJECT | `autoDecision` | 复用;**终止改由显式 `endEvent{terminate}` 承接**(不再自动补) |
| `serviceTask{trigger}` | `ServiceTask`(+可选前置 timer) | `${wfTriggerDelegate}` | `triggerType` `triggerHandler` `webhookUrl` `triggerConfig` | 复用现 `trigger()` |
| `serviceTask{delegate}` | `ServiceTask` | 任意 `delegateExpression` | — | **新增**:通用 delegate 直配(为将来 scriptTask 过渡) |
| `cc` | `ServiceTask` | `${wfCcDelegate}` | `ccUsers`(取 props.ccUsers) | 复用现 `cc()`,来源改 props |
| `ai` | `ServiceTask` | `${wfAiApprovalDelegate}` | `aiModel` `aiSystemPrompt` `aiFormContext` `aiOutputMap` | 复用现 `ai()` |
| `webhook` | `ServiceTask` | `${wfWebhookDelegate}` | `webhookUrl` | 复用现 `webhook()` |
| `exclusiveGateway` | `ExclusiveGateway` | `setDefaultFlow(defaultEdgeId)` | — | **改造**:不再由 condition 节点合成成对网关;直接建单个网关节点,default 取自 `edge.isDefault` |
| `parallelGateway` | `ParallelGateway` | 无条件出边 | — | **改造**:同上,fork/join 由前端显式建两个节点(旧自动成对) |
| `inclusiveGateway` | `InclusiveGateway` | default 同 exclusive | — | **改造**:同上 |
| `callActivity` | `CallActivity` | `calledElement` `inheritVariables` `inParameters` | `subDefCode` | 复用现 `subprocess()` 的 callActivity 分支;async 旁路拓扑改为**前端显式画**(旧后端合成 fork+subEnd) |
| `subProcess` | `SubProcess`(内联子元素) | 递归展开 children.nodes/edges | — | **新增(全新)**:嵌入式子流程递归转换,旧完全不支持 |
| `timerCatch` | `IntermediateCatchEvent` + `TimerEventDefinition` | timeDuration/timeDate | — | 复用现 `timer()` |
| `timerBoundary` | `BoundaryEvent`(attachedToRef=宿主) + `TimerEventDefinition` | `cancelActivity` | — | **新增(全新)**:边界事件,旧完全不支持;需处理 attachedTo 关联与出边 |
| `SequenceFlow` | `SequenceFlow` | `conditionExpression`(UEL) | `oa:condition`(结构化,供回编辑) | **改造**:消费显式 edge + waypoints 生成 BPMNEdge(旧 addFlow 自合成 + autoLayout);条件二源(condition→UEL / expression→原样) |
| (坐标) | BPMN DI(`BPMNShape`/`BPMNEdge`) | 消费 `position`/`size`/`waypoints` | — | **改造**:据前端坐标生成 DI,替代 `autoLayout()` 启发式 |

**N-B-01 新增支持点汇总(现在完全没有的)**:
1. **图直译路径**:消费扁平 `nodes[]`+显式 `edges[]`,替代嵌套树遍历 + 拓扑合成。
2. **显式 startEvent/endEvent** 节点(含 terminate 型 end)。
3. **网关不再成对合成**:直接建单网关,fork/join 拓扑由前端边表达。
4. **嵌入式 `subProcess`** 递归转换(全新)。
5. **`timerBoundary`** 边界定时事件(全新)。
6. **通用 `serviceTask{delegate}`** 直配。
7. **消费前端坐标/waypoints 生成 BPMN DI**,替代 `autoLayout()`。
8. **周期定时 `cycle`**(timeCycle)。
9. **边级 `expression` 高级公式条件**(Tier 1 引擎路径,与结构化 UEL 并存)。

**保持不变(红线)**:`ConditionCompiler` 的结构化 → UEL 编译规则与 operator 符号映射;`WfNodeProps` / `FlowConfig` 契约;各 delegate bean 名(`wfAssigneeResolver`/`wfCcDelegate`/`wfAutoDecide`/`wfTriggerDelegate`/`wfAiApprovalDelegate`/`wfWebhookDelegate`/`wfEventDelegate`/`wfVote`)。

## 附录 C · 主控对契约分歧的裁定（2026-07-09）

1. **OA 行为节点一律作一等 type，映射统一为 serviceTask+delegate**。凡用户在画布上放置的 OA 行为(抄送 cc / AI 审批 ai / webhook / 自动决策 autoDecision / 触发器 trigger)都作为一等 `type`，各自携带专属 config、在调色板有独立图标；BPMN 映射时统一落为 `serviceTask + 对应 delegate bean`。**不把 auto*/trigger 藏进 `serviceTask.impl`**（否则设计器 UX 与调色板语义不清）。另保留一个通用 `serviceTask{delegate}` 仅用于真正自定义的委托。→ 消除分歧①的不对称。
2. **`timerBoundary` 与 `timerCatch` 并存**（超集，保迁移）：`timerCatch`=旧 dingtalk 中间捕获语义，`timerBoundary`=新增边界事件。两者都留。
3. **拒绝终止显式化，但加两道保险**：接受"前端显式画 `endEvent{terminate:true}`"取代旧转换器在 autoReject 内部隐式补 terminate。**必须**：(a) 模型级校验器拦截"拒绝/autoReject 路径缺 terminate end"；(b) 旧模型→ProcessModel 迁移工具自动补 terminate end。不接受隐式行为静默丢失。
4. **边条件二源、互斥**：`condition`(结构化)只走 `ConditionCompiler`→UEL(红线不变)；`expression`(高级公式串)原样下发 Tier 1 引擎(Aviator / `exprEval` bean)。**同一条边二选一**，不同时存在；校验器拦截同时设置。
5. **新图直译路径与旧树路径并存过渡**：N-B-01 **新增**图直译路径，**不删**旧树路径。旧 dingtalk 设计器 + 现有 smoke 继续走旧路径；新 react-flow 设计器走新路径。待新设计器全面替换、smoke 迁移到新路径后，再由主控按阶段删除旧路径。→ 降低一次性替换风险。

### 附录 C 补充 · N-B-01 落地澄清（2026-07-09）

6. **结构化条件以 `ConditionOperator` 名下发**（`eq/ne/gt/gte/lt/lte/contains/notContains`），即 `BranchCondition` 原样。后端图直译路径用 `OP_SYMBOL`（镜像前端 `serde.ts#OP_UEL`）映射为符号后交 `ConditionCompiler`，UEL 产物与前端 `compileUel` 字节一致、`ConditionCompiler` 零改动。**N-F-01 序列化器产出 condition 时保持 operator 名形，不自行转符号。**
7. **`oa:` 扩展元素一律小写**（`oa:condition`、`oa:assigneeRules`…），遵循 moddle `tagAlias:lowerCase`。旧 bpmn-js serde 的大写 `oa:Condition` 随 bpmn-js 删除废弃，新路径与 .bpmn 往返统一用小写。
8. **分组认领只认 `props.handleOptions.candidate`**（WfNodeProps 原生）；旧钉钉模型的 `node.groupMode` 字段不带入新路径。

### 附录 C 再修正 · N-B-01 切片3（2026-07-09，以已落地 model.ts 为准）

9. **修正 C.1**：以**已实现的前端 `flow/model.ts` + 附录 B 映射**为准——`cc`/`ai`/`webhook` 是**一等 type**；`autoApprove`/`autoReject`/`trigger` 序列化为 **`serviceTask{service.impl:...}`**（非一等 type）。理由：前后端字节一致优先，否则前端产物 `{type:"serviceTask",service:{impl:"autoApprove"}}` 无法转换。**UX 与序列化分离**：调色板仍把"自动通过/自动拒绝/触发器"作独立可拖拽项呈现（好 UX），底层落为 serviceTask{impl}。C.1 中"auto*/trigger 也提升为一等 type"作废。BPMN 映射不变：全部 → serviceTask+delegate。
10. **trigger TIMER 前置延时**：遵循"图直译不合成拓扑"——真延时由前端**显式画 `timerCatch` 节点**；trigger 自身的 timer 值存 `oa:triggerTimer` 扩展供 `wfTriggerDelegate` 读，信息不丢，转换器不再像旧树路径那样合成中间捕获事件。
