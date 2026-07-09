# 星辰 OA · 项目修复与改进计划（Remediation Plan）

> 创建：2026-07-09 · 依据：三路全量审计（后端 / 前端 / 工程化）
> 状态标记：⬜ 待开始 · 🔵 进行中 · ✅ 已验收 · ⛔ 阻塞

## 验证记录

- **2026-07-09 批次 1/2 端到端验证通过（主控本地跑栈）**：docker 起 pg/redis → 后端启动（Flyway V1–V17 全部应用、`ddl-auto=validate` 通过，证明 B-01/02/03/04/07 的 schema 改动有效）→ 前端 `pnpm lint`/`tsc -b`/`build` 全绿 → `node server/smoke-test.mjs` **通过 377/378 项**（覆盖 401/403、数据权限、会议冲突 409(B-03)、加签/并签/减签/转办/委派/票签等）。唯一失败项「我的会议含新预订(HOST)」是 smoke 写死日期时段导致的时间脆弱性（会议已 FINISHED，断言要 UPCOMING），**非代码回归**，归入 Q-03 加固。验证期发现并修复既有 bug B-18。
- 启动必需环境变量：`OA_JWT_SECRET`（≥32 字符）。

## 0. 组织分工

| 角色 | 代号 | Agent 名 | 职责 |
|------|------|----------|------|
| **主控（Claude 主会话）** | 总揽 | — | 总体设计、任务拆解派单、进度推进、代码审查、最终验收、文档治理 |
| 后端工程师 | 磐石 | `oa-backend-dev` | server/ 全部 Java 代码、Flyway 迁移、安全配置 |
| 前端工程师 | 疾风 | `oa-frontend-dev` | src/ 全部 TS/React 代码、构建配置 |
| UI 设计师 | 丹青 | `oa-ui-designer` | 视觉与交互规范、组件视觉、暗色模式、空态/降级态设计 |
| 测试工程师 | 鹰眼 | `oa-qa-engineer` | CI 流水线、单测、smoke test、Playwright E2E、每批修复的回归验证 |

**工作流**：主控派单（引用本文档条目 ID）→ 对应 agent 实施 → 鹰眼回归验证 → 主控审查验收 → 勾选状态。任何跨端契约变更（如 UEL 格式、API envelope）必须由主控协调磐石与疾风同步修改。

---

## 1. 后端（磐石 · oa-backend-dev）

### 高危

- ✅ **B-01** JWT 密钥外部化。（磐石完成 2026-07-09：`application.yml` secret→`${OA_JWT_SECRET:}`；`OaJwtProperties` 加 `@PostConstruct` 非空 + ≥32 字符校验，缺失即快速失败。**破坏性：本地/CI 启动前必须先设 `OA_JWT_SECRET`**。待鹰眼回归。）
- ✅ **B-02** 敏感配置外部化 + prod profile。（磐石完成：`application.yml` 全部敏感项改 `${ENV:本地默认}`；新增 `application-prod.yml` 零内置凭据，缺失即启动失败。环境变量清单见完工报告。待鹰眼回归。）
- ✅ **B-03** 会议室预订竞态。（磐石完成 2026-07-09：迁移 `V16` 加 `btree_gist` + `EXCLUDE USING gist` 排他约束（半开区间、排除 CANCELED）；`create()` 保留内存快路径 + `saveAndFlush` 捕获 `DataIntegrityViolationException` 转 409。待鹰眼回归。）
- ✅ **B-04** 文件 IDOR。（磐石完成：`FileController` 补 `@PreAuthorize`；`FileService` 归属校验=上传者/持 `system:file:list`/数据权限 ALL，否则 403；新增迁移 `V15__file_view_permission.sql` 种子 `system:file:list`。待鹰眼回归。见 **B-17** 遗留项。）
- ✅ **B-05** 审批接口越权。（磐石完成：`my/done/cc/logs` 等补 `office:approval:list`，`withdraw` 补 create 权限 + OperLog；`ApprovalService.logs` 改归属校验=发起人/曾操作审批人/抄送人/数据权限覆盖者，否则 403。待鹰眼回归。）

### 中危

- ✅ **B-18**（验证期发现的既有 bug，主控 2026-07-09 修）SecurityConfig 未放行 `DispatcherType.ERROR`：匿名/出错请求向 `/error` 二次派发时被 `AuthorizationFilter` 再拒一次，401 响应已写出 → "response already committed" → 连接被重置（keep-alive 复用后表现为客户端 socket closed、smoke 间歇崩溃）。修复：`.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()`。修后 smoke 不再崩，匿名请求干净返回 401。
- ✅ **B-06** 日志接口收权 + DTO 化。（磐石完成：三接口补 `system:log:list`（V6 已种子）；新增 `LoginLogResponse`/`OperLogResponse` DTO，不再返回实体。待鹰眼回归。）
- ⬜ **B-17**（B-04 衍生遗留项）跨用户附件/电子章展示。B-04 收紧后，SELF 数据权限用户查看他人上传的审批附件、`instance-detail`/`wf-print` 的 `sealImageUrl` 会 403（裂图）。根治需文件与业务对象建立关联，或电子章走专用只读端点；**涉及跨端契约，主控协调 磐石+疾风 同步**。
- ⬜ **B-07** 乐观锁。全库无一处 `@Version`。给 `Approval`、`WfAddSign` 加 `@Version`，`approve/reject/withdraw`、`AddSignService.advance` 并发冲突转 409。**验收**：并发 approve+reject 只有一个成功且审计日志一致。
- ⬜ **B-08** 内存分页下推。`ApprovalService.done()`（:78-108）、`MeetingService.my()`（:107-120）全量加载后 subList。改为 repository 层分页查询。
- ⬜ **B-09** 热路径全表扫描。`AssigneeResolver.java:523,533,595,606,622` 多处 `findAll().stream()` 过滤，改为条件查询；顺带收敛 `UserNameResolver`/`DeptNameResolver` 重复实现。
- ⬜ **B-10** 首节点 WEBHOOK 时序缺陷：在 `wf_instance_ext` 落库前触发导致拿不到标题（workflow-design.md:301）。调整触发时机或补数据。（推迟：并入新方向工作流批次）
- ✅ **B-11** "唤醒"操作补权限。（磐石完成 2026-07-09：resurrect 端点补 `@PreAuthorize("hasAuthority('wf:instance:admin')")`，复用现有权限码不新增迁移，api-contract 同步。**衍生前端跟进 F-11**：唤醒按钮入口 gate 成 `resurrectable && isAdmin`。）

### 低危 / 债务

- ✅ **B-12** 密码重置去掉固定 `admin123`。（磐石完成：`resetPassword` 用 `SecureRandom` 生成 12 位去混淆随机明文，返回 `R<String>` data=新密码供管理员转交；DataInitializer 种子路径不受影响。**衍生前端跟进 F-12**：`system/user.tsx:448` toast 从"已重置为 admin123"改为显示返回的新密码。）
- ✅ **B-13** CORS 可配置化。（磐石完成：`oa.cors.allowed-origins` 配置项，dev 默认 localhost:5173/5181，prod 走 `OA_CORS_ALLOWED_ORIGINS`，保留 allowCredentials。）
- ⬜ **B-14** 状态魔法字符串 → 枚举（11 个实体 50 处 `STATUS_*` 常量；`MeetingService` 与实体存在两套状态词汇）。（待排期）
- ⬜ **B-15** 拆分 `InstanceService.java`（1216 行）。（推迟：新方向工作流批次会重构此类，届时一并拆）
- ✅ **B-16** `FormulaEvaluator` IF 注释。（磐石完成：改注释如实说明"参数已全量求值、IF 为先算两分支再择一"；因取人函数无副作用且失败降级空集，全量求值与惰性结果一致，无正确性 bug，重构惰性收益不足故只修注释。Q-02 补择一逻辑单测。）

## 2. 前端（疾风 · oa-frontend-dev）

### 高危

- ⬜ **F-01** form-runtime 假沙箱。`src/lib/form-runtime.ts:290-304` 注释声称隔离 window/fetch/DOM，实际 `new Function` 全局作用域可达一切。方案二选一（主控决策后实施）：a) Worker/iframe 真沙箱；b) 移除虚假声明 + 文档明确"脚本仅限受信管理员编写"并在后端限制表单定义写权限。
- ⬜ **F-02** 富文本编辑侧 XSS。`src/components/form-renderer.tsx:951` 把已存 HTML 直写 `innerHTML`（渲染侧已走 sanitizeHtml，编辑侧漏了）。编辑装载时同样过 `sanitizeHtml`。**验收**：存入 `<img src=x onerror=alert(1)>` 后重新打开编辑器不执行。

### 中危

- ✅ **F-03** 抽取 `useApiData` hook + 共享降级组件。（疾风完成 2026-07-09：`src/hooks/use-api-data.ts` + `<OfflineFallback>`/`<ErrorState>`；迁了 4 个代表页 meeting/rooms、attendance/trip、attendance/record、system/user，其余 31 页照 hook 顶部 7 步注释迁。lint/tsc 绿。）35 个页面重复 `loadError`/`NetworkError`(52 处)/`setLoading`(36 文件) 样板。新建 `src/hooks/use-api-data.ts` + `<OfflineFallback>`/`<ErrorState>` 组件（视觉规范由丹青出，见 U-01），分批迁移页面。**验收**：迁移后各页面离线降级行为一致，代码净删除数百行。
- ✅ **F-04** 启用 `exhaustive-deps`。（疾风完成：`.oxlintrc.json` 启用 `react/exhaustive-deps: warn`；修 7 处真实缺依赖/复杂依赖数组（含 form-renderer `useWidgetOptions`）；合理冻结依赖的 disable 补原因注释。lint 绿、src 内 0 exhaustive-deps 警告。）`.oxlintrc.json` 未启用该规则，代码中 8+ 处 disable 注释是死的（`form-renderer.tsx:952,1287,1657,1681`、`org-picker.tsx:181`、`user.tsx:670` 等）。启用规则、逐一排查真实 stale-closure 风险。
- ⬜ **F-05** 拆分巨型文件：`designer-core.tsx`(1850)、`form-renderer.tsx`(1753，含富文本/控件渲染/联动逻辑混杂)、`system/user.tsx`(1492)、`property-panel.tsx`(1333)。
- ⬜ **F-06** mock 降级数据与后端 DTO 同步机制：`dashboard/index.tsx:33-91` 等手工维护 mock 形状，用共享类型约束（`satisfies` 后端契约类型）防漂移。

### 低危

- ⬜ **F-11**（B-11 衍生）唤醒按钮入口 gate 成 `resurrectable && isAdmin`（`InstanceDetail`），非管理员不显示，避免点了 403。→ 交疾风随 F-03/F-04 后一并做。
- ⬜ **F-12**（B-12 衍生）`src/pages/system/user.tsx:448` 重置密码 toast 从硬编码"已重置为 admin123"改为显示接口返回的 `data`（新随机密码）。→ 交疾风。
- ⬜ **F-07** 401 处理：`api.ts:45-48` 整页 `window.location.href` 跳转 + 多请求惊群，改为单次事件 + router 跳转。
- ⬜ **F-08** `switchAssignment`（auth-store.ts:111-121）补 try/catch，与 login/refreshMe 一致。
- ⬜ **F-09** 替换废弃的 `document.execCommand`（form-renderer.tsx:955）。
- ⬜ **F-10** `defs.tsx`/`instance-detail.tsx` 内对设计器做嵌套 lazy，缩小路由 chunk。

## 3. UI（丹青 · oa-ui-designer）

- ⬜ **U-01** 制定统一的 加载 / 空态 / 离线降级 / 错误态 视觉规范，产出 `<OfflineFallback>`/`<ErrorState>`/`<EmptyState>` 组件设计稿与实现规格（与 F-03 配套，实现由疾风落地）。
- ⬜ **U-02** 设计器 UX 走查：钉钉设计器与 BPMN 设计器共享属性面板后的交互一致性、术语一致性（加签/并签/减签等）。
- ⬜ **U-03** 暗色模式全站走查（重点：BPMN 画布、表格、表单渲染器），产出问题清单交疾风修复。
- ⬜ **U-04** 视觉资产治理：根目录 4 张无引用 PNG（monitor/p2-addsign/p2-opbar/tasks，~415KB）归档到 `docs/assets/` 并在文档中引用，或删除。

## 4. 测试与工程化（鹰眼 · oa-qa-engineer）

### 高危

- ✅ **Q-01** 最小 CI 流水线。（鹰眼完成 2026-07-09：`.github/workflows/ci.yml` = Job A 快速门禁（前端 lint/tsc/build 本地已实证通过 + 后端 compile）+ Job B 集成冒烟（services 起 pg/redis + 起后端 + smoke-test，暂 `continue-on-error`）。`OA_JWT_SECRET` secret 优先 + 兜底串注入。**遗留**：Job B 需真实 runner 首跑验证后转硬门禁 → 并入 **Q-03**；`.claude/worktrees/` 应加入 oxlint/git 忽略避免本地扫到嵌套 worktree。）
- ✅ **Q-02（后端部分）** 纯逻辑单测。（鹰眼完成 2026-07-09：`ConditionCompilerTest`(17) + `FormulaEvaluatorTest`(19，含 B-16 IF 择一) + `AssigneeResolverTest`(22，Mockito)；`mvn -pl oa-module-workflow -am test` = 70 项全过。ConditionCompiler 与前端 serde 字节级镜像验证成立。）
  - ⬜ **Q-02（前端部分，推迟）** vitest 覆盖 serde/form-runtime/dingtalk-serialize —— 这些文件将被新方向重写，改为在路径七随 `ProcessModel` 序列化与公式 AST 一并建 vitest（见 N-Q-04）。
- ✅ **Q-03** smoke-test 加固。（鹰眼完成 2026-07-09：修时间脆弱性（会议改用"明天"计算时段，任何时刻跑稳定）；清理失败改为醒目 WARNING；补 B-11/12/13 共 10 条断言。整合后 smoke **390/390 全绿**。**残余**：B-04/B-05 专用断言（现由既有 403 检查间接覆盖）、B-07 真并发断言、CI Job B 真实 runner 验证 → 后续 QA 小批处理。）

### 中危

- ⬜ **Q-04** Playwright E2E 冒烟：登录 → 发起审批 → 审批通过 → 设计器保存后重新打开回读一致。设计器是 fix 最密集区域且目前零 UI 覆盖。
- ⬜ **Q-05** 常态职责：每个批次修复完成后执行回归（相关单测 + smoke test + 抽查 E2E），出验证报告给主控验收。

## 5. 文档与治理（主控直管）

- ⬜ **D-01** 重写根 README：反映真实全栈架构（server/ 后端、api.ts 客户端、离线降级机制），快速开始补后端启动。当前 README 会误导新人以为是纯 mock 模板。
- ✅ **D-01** 重写根 README（主控 2026-07-09）：反映全栈架构、后端启动（含 `OA_JWT_SECRET`）、`src/lib/api.ts` 与离线降级、指向 server/README 与 docs。
- ✅ **D-02** `docs/flow-designer-v2.md` 顶部加"已被 next-gen 设计取代"横幅。
- ✅ **D-03** `docs/superpowers/plans/STATUS.md` 说明台账已非活跃 backlog，以 remediation-plan/design 为准。
- ✅ **D-04** `api-contract.md` 加"最后更新"头；新建 `CHANGELOG.md`（[Unreleased] 记录批次 1/2）。
- ✅ **D-05** CLAUDE.md 已随 `chore:` 提交纳入版本管理。

## 6. 实施批次

| 批次 | 内容 | 条目 |
|------|------|------|
| 第一批 · 安全止血 | 密钥外部化、IDOR、XSS | ✅ B-01 B-02 B-04 B-05 B-06 F-02（待鹰眼回归）；F-01 并入第七部分 |
| 第二批 · 正确性 | 并发与性能 | B-03 B-07 B-08 B-09 + Q-03 断言 |
| 第三批 · 工程化 | CI + 单测 + E2E | Q-01 Q-02 Q-03 Q-04 |
| 第四批 · 可维护性 | 样板抽取、拆文件、文档 | F-03 F-04 F-06 B-14 B-15 D-01~D-05 |
| 第五批 · 新方向 | react-flow 设计器 + 表单字段 + 公式/脚本 | 见第七部分（作废 F-05 F-10 U-02 U-03，F-01 并入 N-F-08/09）|

跨端约束提醒：`compileUel/parseUel`（前端 serde.ts）与后端 `ConditionCompiler` 格式必须字节级兼容，任何一侧改动需双端同步 + Q-02 双向单测护航。

---

## 7. 新方向：下一代设计器 / 表单字段 / 公式与脚本

> 设计文档：`docs/design/next-gen-workflow-and-formula.md`（决策已锁定：JSON+后端转 BPMN；多语言脚本含完整 Spring 上下文；仅本仓库手写 react-hook-form 表单）。
> **前置**：脚本治理与依赖三点待用户最终确认（Groovy vs 纯 Java、是否引 GraalPy、治理模型）——见设计文档 3.4。确认后本部分开工。
> **作废**：F-05（面板原样复用无需拆）、F-10（bpmn-js 删除）、U-02/U-03（随新设计器重定义为 N-U-01/02）；F-01 由 N-F-08/09 一并解决。

### 后端（磐石）

- ✅ **N-B-00**（spike）**通过 2026-07-09**：LiteFlow **2.16.0** 在 SB4.0.1/Java21 可用，四项实测全绿，无需回退。**坐标修正：SB4 用 `liteflow-spring-boot4-starter:2.16.0`（非普通 starter）**；`@ScriptBean` 门面访问 Spring Bean 验证成功（Groovy/GraalJS/Jython 均通过）；Jython 2.7.4 在 Java21 跑通。依赖 +~118MB（Jython 49 / GraalJS 63 / 其余 ~9）。
- 🔵 **N-B-01（切片1+2a ✅，端到端验证通过）** `GraphToBpmnConverter` 图直译（与旧路径并存）：start/end(含terminate)/审批userTask/排它·并行·包容网关/条件边(结构化→UEL+expression逃生口)/坐标生成DI，77 单测全过。部署端点 `POST /api/wf/models/graph/deploy`(ProcessDefService TYPE_GRAPH 分支复用 Flowable 部署链)。**主控 E2E 实证 8/8**：ProcessModel→部署 Flowable→发起→INITIATOR 解析→审批→条件网关(days>3 走 e3)→APPROVED、highlight 路径正确。**切片3 待办**：subProcess、timerCatch/Boundary/cycle、callActivity、OA行为节点(cc/ai/webhook/serviceTask)、.bpmn 导入导出端点、模型级校验器(附录C.3/C.4)。
- ✅ **N-B-02** .bpmn 导入/导出端点（磐石完成，E2E 12/12）：`GET /api/wf/models/{id}/bpmn` 导出 + `POST /api/wf/models/import`；`BpmnToGraphConverter` 全类型逆向（条件读 oa:condition 无损、坐标从 DI 还原）。往返 ProcessModel→XML→ProcessModel 无损。111 单测。
- ⬜ **N-B-03** 表单字段清单端点 `GET /api/wf/forms/{formKey}/fields`；`wf_form_def` 增 `form_type` + CODE 仅存清单。
- ✅ **N-B-04** `ExpressionService`（Aviator 5.4.3，强沙箱：解释模式+禁 new/反射/静态/循环+空 ALLOWED_CLASS_SET）+ `@FormulaFunction` 注册器 + 示例函数（deptLeader/dictLabel/workDays）+ exprEval 网关门面；GraphToBpmnConverter 边 expression 走 `${exprEval.evalBoolean}`。98 单测 + E2E 7/7（高级条件运行时 Aviator 路由、自定义函数、沙箱拒 new）。
- ✅ **N-B-05/06/07** LiteFlow 脚本引擎 Tier2（磐石完成，E2E 7/7）：LiteFlow 2.16.0（spring-boot4-starter + groovy/graaljs/python，`enable=false` 仅用脚本 SPI，全应用装配 15s 启动）+ `ScriptService`（三语言 + `@ScriptBean("spring")` 门面调任意 Bean + 执行超时）+ 治理（`wf:script:write` V18、`wf_script_exec_log` 审计、诚实标注非沙箱）+ scriptTask→`wfScriptDelegate` + `POST /api/wf/script/test-run`。E2E：脚本节点运行时经门面调 Bean + 写 vars → 下游 Aviator 网关路由；test-run groovy/GraalJS 均成功。ScriptServiceTest 6/6。前端编辑器 = N-F-09。
- ✅ **N-B-06** 脚本治理（随 N-B-05/06/07 完成）。
- ✅ **N-B-07** scriptTask 接入（随 N-B-05/06/07 完成；execution/task 监听器钩子可后续按需扩展）。

### 前端（疾风）

- 🔵 **N-F-01（切片1 ✅）** 新建 `designer/flow`：`FlowCanvas`(@xyflow/react) + start/end/审批/排它网关 4 类节点 + 条件边 + `serialize.ts` 双向往返(实测一致) + 复用共享 PropertyPanel(零改动) + 预览页 `/demo/flow-designer`。**切片2 待办**：其余 10 类节点、调色板拖拽、BPMN 连接规则校验、自动布局、旧 designerJson 迁移适配、只读运行时高亮、删 bpmn-js、接 FormFieldManifest。
- ⬜ **N-F-02** 调色板拖拽 + BPMN 连接规则校验 + `elkjs`/`dagre` 自动布局（导入用）。
- ✅ **N-F-03** `ProcessModel` 契约定义 + `serialize.ts` 双向往返 + 复用共享 PropertyPanel（随 N-F-01 切片1 完成，往返实测一致）。
- ⬜ **N-F-04** 合并 `bpmn/oa/validate.ts` + `dingtalk/validate.ts` 为模型级校验器。
- ⬜ **N-F-05** 实例详情用新节点组件渲染 + 运行时高亮（替换 bpmn-js 高亮）。
- ⬜ **N-F-06** 删除 `bpmn-js`/`diagram-js-grid` 依赖与 `designer/bpmn`。
- ⬜ **N-F-07** 表单字段契约 `FormFieldManifest`/`FieldPolicy` + `formRegistry`；手写 react-hook-form 表单导出 `formMeta` 注册；`HostedForm` 包裹层消费 `fieldPolicy` 做显隐/只读/必填。
- ✅ **N-F-08 / F-01** 安全 AST 解释器 `formula-eval.ts`（自写词法+Pratt，零 new Function，屏蔽原型链，23 vitest 含安全组）+ `formula-designer` 组件（接入 flow 边高级条件）+ form-runtime 迁移。**F-01 假沙箱消灭**：高频公式路径真隔离；Tier2 事件脚本保留 new Function 但诚实标注非沙箱、受信管理员专用。引入 vitest。
- ✅ **N-F-09** 脚本编辑器（疾风完成）：Groovy/JS/Python tab + 上下文速查 + 诚实"非沙箱"警示 + `wf:script:write` 权限 gate + 测试运行接 test-run 端点；model.ts/serialize 补 script 字段、接入设计器 scriptTask 模式。vitest 25（含脚本节点往返）。

### UI（丹青）

- ✅ **N-U-01** 新设计器视觉/交互规范 `docs/design/flow-designer-ui-spec.md`（丹青完成，22 条走查/2 P0/4 P1）。**主控裁定**：分歧A=A1（三网关统一 amber 色相 + 内部标记 X/＋/◯ 区分，BPMN 标准）；分歧B=cc/ai/webhook teal 集成家族、AI 更亮一档。
- ⬜ **N-U-01-fix**（疾风，设计器 UI 打磨专项，脚本编辑器之后）落地走查修复：**W-03(P0,跨端)** 前端把真实 size 写进 ProcessModel（后端 DI 默认仅兜底）；**W-14(P0)** 校验错误用 nodeId/edgeId 画布高亮 + 走 `--destructive`；W-01 节点分类色相（按裁定 A1/B）；W-10 边选中反馈、W-11 连线拖拽实时 isValidConnection、W-12 NodeToolbar 删除/复制；术语 W-18/19。
- ⬜ **N-U-02** 公式/脚本编辑器 UX 规范（函数/字段选择器、校验提示、测试运行结果态）。

### 测试（鹰眼）

- ⬜ **N-Q-01** `ProcessModel` ⇄ `BpmnModel` 往返 + .bpmn 导入导出往返一致。
- ⬜ **N-Q-02** `ExpressionService` 单测（内置 + 自定义函数、高级条件求值）。
- ⬜ **N-Q-03** `ScriptService` 单测：Groovy/GraalPy 能拿到注入的 `spring`/`vars`/`form` 并调 Bean；超时/限额生效；`wf:script:write` 门禁与审计。
- ⬜ **N-Q-04** 前端 vitest（`ProcessModel` 序列化、公式 AST 解释器、字段清单/策略应用）+ Playwright（设计器新建→保存→重开回读一致、脚本节点执行）。
