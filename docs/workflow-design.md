# 工作流平台详细设计 v3（Flowable 8 + 中国式审批闭环）

> 状态：已定稿。引擎选型：**Flowable 8.0.0（Maven Central 实测 latest=8.0.0，适配 Spring Boot 4）**。
> 坐标说明：8.0 起 process 引擎 starter 更名为 `org.flowable:flowable-spring-boot-starter-process:8.0.0`（旧名 flowable-spring-boot-starter-process-engine 已停用）。
> 集成顺序：P1 首选官方 starter 直配 Boot 4；若个别自动装配不兼容再切手动装配 ProcessEngine（两条路 API 层无差异）。

## 0. 引擎集成策略 —— 【P1 Spike 实测结论】

**结论：官方 starter 直配成功，Plan B（手动装配 / 自研引擎）未启用。**

- 依赖坐标：`org.flowable:flowable-spring-boot-starter-process:8.0.0`。Flowable 8 已适配 Spring Boot 4 /
  Spring Framework 7 / jakarta；starter 的 `ProcessEngineAutoConfiguration` 自动复用平台主 `DataSource`
  与 `PlatformTransactionManager`（JPA `JpaTransactionManager`），与业务查询同库同事务。未出现 MyBatis /
  事务管理器冲突。
- 引擎参数经 `oa-boot` 的 `application.yml` 配置（非手动 `buildProcessEngine`）：
  ```yaml
  flowable:
    database-schema-update: true       # 引擎自建/升级 ACT_* 表（不进 Flyway）
    async-executor-activate: true      # 异步执行器（定时/超时催办）
    check-process-definitions: false   # 不扫描 classpath 自动部署，改由 WorkflowInitializer 编程部署
    idm:
      enabled: false                   # 关闭 IDM 引擎，用户/权限走平台 sys_* 体系
  ```
  引擎首启自建 ACT_*（含 common / engine / history / eventregistry）约 40+ 张表；Flyway 只管 `wf_*` 业务表。
- 平台全局事件监听器（TODO 通知 / 实例结束→APPROVED+RESULT 通知）经 `ProcessEngineConfigurationConfigurer`
  （`FlowableEngineConfig`）追加，不覆盖 starter 自动装配。
- **审批人求值实现方式（对设计 §3.2 的落地修订）**：未用“全局 TaskListener(create)”，而是等价实现为
  **多实例 collection 表达式 bean** `${wfAssigneeResolver.resolve(execution,'nodeId')}`——节点进入时求值
  assigneeRules 并按 emptyStrategy 兜底（AUTO_PASS=空集合→0 实例自动通过 / TO_ADMIN=注入 admin），
  结果注入多实例元素赋给 `assignee`。单人审批亦走 1 实例多实例，模型统一。抄送节点为 serviceTask
  `delegateExpression=${wfCcDelegate}`。
- **退回发起人（reject target=START）落地方式**：删除当前运行实例 + `wf_instance_ext.biz_status=REJECTED`
  （可重提）；`POST /instances/{id}/resubmit` 用（可改的）表单数据重新 `startProcessInstanceByKey`，
  复用同一 `wf_instance_ext` 行（更新 proc_inst_id）。退回上一步（PREV）走 `ChangeActivityStateBuilder.moveActivityIdTo`。
- 新模块 `oa-module-workflow`（依赖 `oa-module-system` + `oa-common` + flowable process starter），`oa-boot` 聚合。

## 1. 总体架构

```
表单定义(自研,版本化)          流程定义(BPMN XML,版本化)
  wf_form_def                   Flowable Deployment/ProcessDefinition + wf_process_ext(扩展档案)
       │                             │
       │  发起时快照 form schema      │ 部署即版本(engine 原生支持)
       ▼                             ▼
              ProcessInstance (Flowable ACT_RU_*) + wf_instance_ext(标题/摘要/表单数据快照)
                      │
                      ▼
              Task (ACT_RU_TASK) ←—— 中国式操作全部实现为对 Task/Execution 的服务层封装
                      │
                      ▼
              历史与跟踪 (Flowable HistoryService + wf_operation 业务动作补录)
```

设计原则：
1. **流转交给 Flowable**（节点推进、多实例、网关、CallActivity、历史）；**中国式语义在服务层封装**（Flowable 只是被调用的原语库）。
2. **两个设计器共存**：BPMN 设计器直接产出可部署 XML（专业模式）；仿钉钉设计器产出 JSON → **JsonToBpmnConverter** 转 BPMN XML 再部署（简易模式），JSON 原稿存 `wf_process_ext.designer_json` 供回显编辑。
3. **表单自研**（不用 Flowable FormEngine）：复用表单设计器 widget 模型，节点通过 `formKey=code:version` 绑定；节点级字段权限、事件全部存 BPMN `extensionElements`。

## 2. 数据层

### 2.1 Flowable 自管表（ACT_*，约 40 张）
`databaseSchemaUpdate=true` 由引擎首启自建/升级，**不进 Flyway**（两者管辖前缀隔离：Flyway 管业务表，引擎管 ACT_*）。README 注明。核心用到：
- ACT_RE_DEPLOYMENT / ACT_RE_PROCDEF —— 部署与流程定义（版本原生自增）
- ACT_RU_EXECUTION / ACT_RU_TASK / ACT_RU_VARIABLE / ACT_RU_IDENTITYLINK —— 运行时
- ACT_HI_PROCINST / ACT_HI_TASKINST / ACT_HI_ACTINST / ACT_HI_COMMENT —— 历史/意见

### 2.2 业务扩展表（V7__workflow.sql，Flyway 管）
```sql
wf_form_def      (id, code, name, version, schema_json TEXT, status DRAFT/PUBLISHED/DISABLED,
                  remark, created_by, created_at, UNIQUE(code,version))
wf_process_ext   (id, def_code, name, category, icon, form_code, form_version,
                  designer_type BPMN/DINGTALK, designer_json TEXT,   -- 简易设计器原稿
                  latest_deployment_id, status, remark, created_by, created_at)
wf_instance_ext  (id, proc_inst_id UNIQUE, def_code, title, initiator_id, initiator_dept_id,
                  form_code, form_version, form_schema_snapshot TEXT, form_data_json TEXT,
                  biz_status RUNNING/APPROVED/REJECTED/CANCELED/TERMINATED, created_at, ended_at)
wf_operation     (id, proc_inst_id, task_id, node_id, actor_id, actor_name,
                  action, detail_json, comment, created_at)
                 -- 业务动作审计：加签/转办/催办/跳转…（引擎历史不含这些语义）
wf_cc            (id, proc_inst_id, node_id, user_id, read_flag, created_at)
wf_delegate_rule (id, owner_id, delegate_to_id, def_code NULL=全部, start_date, end_date, enabled)
wf_seal          (id, name, image_file_id, enabled)                    -- 电子章(引文件管理)
wf_notify        (id, user_id, type TODO/RESULT/URGE/CC, title, content, proc_inst_id,
                  read_flag, created_at)                               -- 站内通知收件箱
```

## 3. 流程定义模型

### 3.1 BPMN 扩展属性（extensionElements，命名空间 `oa`）
节点(UserTask)级：
```xml
<userTask id="Task_Mgr" name="部门经理审批" flowable:formKey="leave:3"
          flowable:candidateGroups="..."> <!-- 由 assigneeRules 解析后写入或运行时监听器求值 -->
  <extensionElements>
    <oa:assigneeRules>[{"type":"ORG","refs":[...]},{"type":"LEADER","level":1},
                       {"type":"FORM_FIELD","field":"approver"},{"type":"INITIATOR"}]</oa:assigneeRules>
    <oa:multiMode>ANY|ALL|SEQUENCE</oa:multiMode>          <!-- 转换器据此生成多实例配置 -->
    <oa:emptyStrategy>AUTO_PASS|TO_ADMIN|BLOCK</oa:emptyStrategy>
    <oa:formPerms>{"days":"EDIT","reason":"READ","salary":"HIDDEN"}</oa:formPerms>
    <oa:timeout>{"hours":24,"action":"REMIND|AUTO_PASS|AUTO_REJECT","remindEvery":8}</oa:timeout>
    <oa:allowedOps>["approve","reject","addSign","transfer","assist","print","seal"]</oa:allowedOps>
    <oa:rejectTo>PREV|START|ANY</oa:rejectTo>
    <oa:events>[{"trigger":"nodeEnter","action":"NOTIFY",...},{"trigger":"taskTimeout",...}]</oa:events>
    <oa:seal>{"sealId":1,"when":"APPROVED"}</oa:seal>
  </extensionElements>
</userTask>
```
流程级：`<oa:processEvents>`（instanceStarted/Completed/Rejected/Canceled）。
条件分支：沿用结构化条件（字段/操作符/值 JSON）→ 转换器编译成 UEL 表达式 `${days > 3}`，两份都存（回显用结构化，执行用 UEL）。

### 3.2 审批人规则求值（TaskCreateListener 全局监听）
任务创建时按 assigneeRules 顺序求值出用户集合：
- ORG：OrgRef 展开（DEPT→部门任职用户集，ROLE→角色任职用户集，USER 直取）
- LEADER(level)：沿发起人（或上任务处理人，可配 basis）的 sys_dept ancestors 取 N 级部门负责人
- FORM_FIELD：读流程变量中的表单字段（选人控件）
- INITIATOR：发起人
命中 wf_delegate_rule 则替换为受托人（identityLink 记录 origin）。为空按 emptyStrategy。
多实例节点：转换器生成 `multiInstanceLoopCharacteristics`（ALL=并行+completionCondition 全部完成 / ANY=并行+一票完成 / SEQUENCE=串行），collection 变量由监听器注入求值结果。

## 4. 功能全集：语义定义 → Flowable 实现映射（评审后确认版）

### 4.1 流程结构
| 功能 | 语义 | 实现 | 期 |
|---|---|---|---|
| 条件分支(排它) | 按条件择一分支，含异常路由与默认分支 | exclusiveGateway + UEL（结构化条件编译）| P1 |
| 并行分支 | fork 多分支 / join 汇聚 | parallelGateway 成对生成 | P1 |
| 包容分支 | 满足条件的多条都走，全不满足走默认 | inclusiveGateway + default flow | P2 |
| 父子流程 | 主流程节点自动进入子流程，结束自动回跳；支持同步/异步 | CallActivity（同步）；异步=并行网关旁路 + 信号回写 | P3 |
| 定时 | 时间节点定时执行进入下一步 | intermediateCatchEvent(timerEventDefinition)，AsyncExecutor 驱动 | P3 |
| 触发 | 节点执行触发器业务逻辑后进入下一步；立即/定时两种 | ServiceTask → 统一 TriggerDelegate（配置指向注册的触发器 bean / WEBHOOK）；定时=前置 timer | P3 |
| 动态构建 | 按当前任务动态建新任务，不体现在流程图 | taskService.newTask 挂实例的 ad-hoc 任务（协办机制推广），完成条件由服务层管理 | P3 |

### 4.2 多人审批模式（节点 multiMode）
| 功能 | 语义 | 实现 | 期 |
|---|---|---|---|
| 或签 ANY | 多人任一处理即过节点 | 并行多实例 + completionCondition ${nrOfCompletedInstances>0} | P1 |
| 并行会签 ALL | 多人同时收到，全部同意才过 | 并行多实例 + 全部完成 | P1 |
| 顺序会签 SEQUENCE | 依次收到，前一人提交后下一人才收到，全部同意才过 | 串行多实例 | P1 |
| 票签 VOTE | 按人配权重，通过权重占比 > 阈值(默认50%)即过 | 并行多实例 + completionCondition 调自定义 bean ${wfVote.pass(execution)}（权重表存节点配置，赞成权重和/总权重 > 阈值提前完成；反对使无法达阈值则节点判拒） | P2 |
| 分组策略 | 角色/部门解析出的人群两种模式：认领审批（一人认领办理）/ 全员参与（按上述多人模式） | groupMode=CLAIM → candidateGroup 任务 + taskService.claim；ALL → 展开成员进多实例 | P2 |
| 认领 | 公共任务池认领后办理（可退回池） | candidate 任务 claim / unclaim | P2 |

### 4.3 任务分配类
| 功能 | 语义 | 实现 | 期 |
|---|---|---|---|
| 分配 | 办理人自行决定转办/委派/主办等 | 节点 allowedOps 白名单控制可用操作 | P2 |
| 转办 | A 转 B，B 审批后进下一节点（责任转移） | setOwner(A)+setAssignee(B)，wf_operation(TRANSFER) | P2 |
| 离职转办(交接) | A 全部在途任务批量转 B | 按人扫 RU_TASK 批量 transfer + 委托规则改写 + 交接报告 | P2 |
| 委派 | A 转 B，B 审批后回到 A，A 再提交进下一节点 | taskService.delegateTask(B) / B resolveTask 回 A（Flowable 原生 DELEGATION 状态） | P2 |
| 代理 | A 预设代理人 B：B 完成则 A 无需操作、双方都可查；A 完成则 B 不再可见 | 任务 assignee=A + addCandidateUser(B)（两人均可办/可见）；任一完成即结束，历史双方可查（identityLink 保留）；预设规则=wf_delegate_rule(mode=AGENT) 任务创建时自动挂 candidate | P2 |
| 追加 | 发起时/运行中按实例动态调整某节点处理人（不改定义） | 实例变量 __assigneeOverride{nodeId:[refs]}，求值监听器优先读取 | P2 |
| 加签 | 办理人自行增加本节点办理人：前加签（先审完回我）/ 后加签（我过后他们审再进下节点） | addMultiInstanceExecution；后加签=完成前写 __postSign，节点后自动织入的动态多实例承接 | P2 |
| 减签 | 办理人操作前减少本节点办理人 | deleteMultiInstanceExecution（校验剩余≥1 且未办理） | P2 |

### 4.4 流转控制类
| 功能 | 语义 | 实现 | 期 |
|---|---|---|---|
| 驳回/退回 | 重置到某节点重审：退回发起人/上一步/任意节点 | ChangeActivityStateBuilder.moveActivityIdTo；MI 节点先收敛执行 | P1(上一步/发起人)、P2(任意) |
| 驳回后重审策略 | 1 继续执行（重审后直接回驳回点续走）2 退回驳回节点（重走中间路径） | 驳回时记 __rejectFrom/__strategy；被驳节点完成时按策略 moveTo 驳回点或自然流转 | P2 |
| 跳转 | 管理员把实例移到任意节点 | ChangeActivityState + wf:instance:admin | P2 |
| 拿回 | 下一节点尚未处理前，上一提交人取回重办 | 校验目标节点任务均无 act → moveTo 回本节点并置回本人 | P2 |
| 撤销 | 发起人撤销流程（无节点通过前） | deleteProcessInstance + biz_status=CANCELED | P1 |
| 终止 | 任意节点强制终止实例 | deleteProcessInstance（admin）| P2 |
| 唤醒 | 历史（已结束/被终止）任务唤醒重新进入审批 | 结束实例不可复活：按快照重建新实例 + ChangeActivityState 定位到唤醒节点 + 变量/表单迁移，ext 标记 resurrectFrom | P3 |
| 暂存待审 | 发起时草稿暂存，后续修改再提交激活 | wf_instance_ext(status=DRAFT) 不启动引擎；提交时 startProcessInstance | P2 |
| 穿越时空 | 指定日期发起补审，审批记录时间记为该日期 | 业务时间字段 biz_time（ext+operation 全链带出，展示/报表用业务时间；引擎真实时间不动，避免全局 Clock 污染） | P3 |

### 4.5 协作与体验类
| 功能 | 语义 | 实现 | 期 |
|---|---|---|---|
| 审批意见/附件 | 操作必带意见（可配必填）+ 附件 | taskService.addComment + 文件管理 id 列表 | P1 |
| 抄送 | 结果通知抄送人，同实例同人默认去重 | 节点完成事件写 wf_cc(唯一约束 inst+user) + 通知 | P1 |
| 已阅 | 任务/抄送查看状态展示 | wf_task_read(task_id,user_id,read_at)；打开详情即记 | P2 |
| 沟通 | 与当前处理人沟通（不影响流转） | 任务留言（comment type=COMMUNICATE，指定收件人+通知），线程化展示 | P2 |
| 催办 | 通知当前处理人（手动） | 通知 + wf_operation(URGE) | P2 |
| 自动提醒 | 按提醒时间/次数自动提醒，多渠道 | timer 边界事件 + NotifyChannel SPI（内置站内/日志渠道，短信/邮件/微信/钉钉留扩展点接口） | P2 |
| 超时审批 | 超时自动通过/拒绝 | timer 边界事件 → 自动 complete/reject（AsyncExecutor） | P2 |
| 跟踪 | 图高亮（已走/当前/未走）+ 时间线 | HistoryService + bpmn-js viewer overlay；时间线=wf_operation ∪ ACT_HI_COMMENT | P1 |
| 流程预测 | 按当前表单值静态演算后续路径与预计审批人 | BpmnModel DFS + UEL 离线求值 + 审批人规则试算 | P3 |
| 打印/盖章 | 套打视图 + 节点电子章叠加 | 前端打印页 + wf_seal（引文件管理）+ 用章记录 | P3 |
| 通知 | 待办到达/结果/催办/抄送等站内通知 | wf_notify 收件箱 + header 铃铛接真实数据 | P1 |
| AI 审批 | AI 智能体按配置智能路由/辅助审批 | 节点类型 AI：ServiceTask → AiApprovalDelegate（配置：模型/系统提示词/表单上下文注入/输出映射：approve|reject|route 变量+意见）；SPI 默认实现走 OpenAI 兼容/Claude API 配置，无 key 时降级为规则模拟并明示 | P3 |

## 5. 事件配置化（三层）

统一动作：`NOTIFY`（站内通知，P1）/ `WEBHOOK`（后端异步 POST 实例上下文，P2）/ `SCRIPT`（P3：表单侧受限 JS 前端执行；后端脚本仅存储不执行，避免注入面）。
- **表单事件**（前端动态渲染器执行）：`onLoad / onChange(field) / onSubmit`——联动显隐、默认值、提交拦截
- **流程事件**（FlowableEventListener 全局分发）：PROCESS_STARTED / PROCESS_COMPLETED / PROCESS_CANCELLED + 业务驳回事件
- **节点事件**（Execution/TaskListener 统一入口 `OaEventDelegate`，读 extensionElements 配置分发）：nodeEnter / nodeComplete / taskCreated / taskTimeout
所有监听器只有一个 Java 入口类，行为完全由定义 JSON 驱动（真正的配置化，不为每个流程写代码）。

## 6. API 契约（/api/wf，新模块 oa-module-workflow）

```
表单定义  GET /form-defs?keyword&pageNum        POST /form-defs（草稿）  PUT /form-defs/{id}
          POST /form-defs/{id}/publish          GET /form-defs/{code}/latest  GET /form-defs/{code}/versions
流程定义  GET /process-defs?category&keyword    POST /process-defs {designerType, designerJson|bpmnXml, formCode...}
          POST /process-defs/{id}/publish（转换+部署）  GET /process-defs/{code}/latest  /versions  /diagram(xml)
发起      GET  /startable                        -- 可发起流程列表(卡片墙)
          POST /instances {defCode, formData, title?}
实例      GET /instances/my | /instances/done-by-me | /instances/cc（含未读）
          GET /instances/{id} → {ext快照, formData, 当前节点, 任务列表, 时间线, 高亮活动集}
          POST /instances/{id}/cancel|urge|jump{targetNodeId}|terminate|predict
任务      GET /tasks/todo?keyword&pageNum       -- 徽标数并入现有 pending-count 聚合
          POST /tasks/{id}/approve{comment,attachments,formData?}   /reject{targetNodeId?,comment}
          POST /tasks/{id}/add-sign{users,pre|post}  /counter-sign{users}  /transfer{user}
          POST /tasks/{id}/assist{users,comment}     /retrieve
委托规则  GET/POST/DELETE /delegate-rules
通知      GET /notifies?unread  POST /notifies/{id}/read  GET /notifies/unread-count
印章      GET/POST/DELETE /seals
```
权限码：wf:def:edit（定义管理）、wf:instance:admin（跳转/作废/交接）；数据权限：todo/done 天然按人，实例列表管理员视角走【DS】。

## 7. 前端闭环

1. **表单设计器**：加「保存/发布为表单定义」（code/name/版本），字段补稳定 `key`
2. **流程定义管理页**（/workflow/defs）：定义列表（分类/版本/状态/发布）、新建时二选一进入 BPMN 设计器或仿钉钉设计器（均加“保存为流程定义”与节点属性面板扩展：审批人规则(OrgPicker)/多人模式/表单权限矩阵/超时/事件/操作白名单）
3. **动态表单渲染器** `FormRenderer`：schema+权限矩阵 → RHF+zod 动态渲染（复用表单设计器预览的实现抽成通用组件）
4. **发起中心**（/workflow/start）：可发起流程卡片墙 → 动态表单 → 提交
5. **流程任务**：待办（操作按钮按节点 allowedOps 动态渲染，含加签/转办/协办等弹窗，选人全部用 OrgPicker）/ 已办 / 我发起 / 抄送
6. **实例详情页**：表单快照(只读/可编辑按驳回状态) + bpmn-js Viewer 跟踪高亮 + 时间线 + 右上操作（撤销/催办/打印…）
7. **通知铃铛**：header 现有通知面板接 wf_notify 真实数据
8. 审批中心菜单整合：现有简易审批保留为“快捷审批”，新增“流程中心”一组菜单

## 8. 实施分期（每期含迁移/契约/冒烟/浏览器巡检）

- **P1 引擎落地 + 基础闭环**：Spike（starter 7.1.0 直配 Boot 4，失败切手动装配）→ V7 业务表 → 表单/流程定义 CRUD+发布（JSON→BPMN 转换器：顺序节点/排它分支/并行分支/或签/并行会签/顺序会签/抄送节点）→ 发起中心 + 动态表单渲染器 → approve / reject(上一步/发起人) / cancel + 意见附件 + 抄送去重 + 站内通知 + 跟踪高亮 + 待办/已办/我发起/实例详情
- **P2 中国式全家桶**：包容分支、票签、分组策略/认领、转办/离职交接/委派/代理/追加/加签/减签、任意驳回+重审策略、跳转/终止/拿回/暂存待审、已阅/沟通/催办/自动提醒(SPI)/超时审批、WEBHOOK 事件、管理员实例列表
- **P3 高级**：父子流程(同步/异步)、定时/触发/动态构建、唤醒、穿越时空(业务时间)、流程预测、打印/盖章、表单 SCRIPT 事件、AI 审批节点

## 9. 风险与对策
| 风险 | 对策 |
|---|---|
| Flowable 7 × Boot 4 兼容 | P1 首日 Spike；失败回退 v1 自研方案（API 不变） |
| JSON→BPMN 转换正确性 | 转换器单测 + 部署校验（引擎 parse 报错即拒绝发布）；BPMN 原生模式兜底 |
| ChangeActivityState 边界（MI 节点回退） | 驳回/拿回统一走服务层带前置校验；MI 目标节点回退先 deleteMultiInstanceExecution 收敛 |
| ACT_* 与业务表事务一致性 | 共享 DataSource + Spring 事务同参与 |
| 表达式注入 | 条件仅由结构化 JSON 编译生成，白名单操作符；不接受用户手写 UEL |
```

## 实施进度

### P1 后端（已完成，2026-07-07）
引擎：Flowable 8.0.0 官方 starter 直配 Boot 4 成功（详见 §0 实测结论）。新模块 `oa-module-workflow`，`oa-boot` 聚合。

- **迁移**：`V7__workflow.sql` 建 wf_form_def / wf_process_ext / wf_instance_ext / wf_operation / wf_cc(唯一 proc_inst_id+user_id) / wf_delegate_rule / wf_seal / wf_notify；权限点 workflow + wf:def:edit 授 ADMIN；请假表单+流程种子。ACT_* 由引擎自建。
- **表单定义**：CRUD + 发布 + 版本（code+version 唯一，PUBLISHED 不可改，改=新版本 DRAFT）。
- **流程定义**：CRUD + 发布（DINGTALK JSON→BPMN 转换部署 / BPMN 校验部署；引擎 parse 失败回滚）。
- **JsonToBpmnConverter**：审批(多实例 ANY/ALL/SEQUENCE)、条件(exclusiveGateway+UEL 白名单+默认分支)、抄送(serviceTask delegateExpression)；扩展元素 oa 命名空间。生成 BpmnModel 后自动补全 **BPMNDI 图形坐标**（最长路径分层布局，每节点 BPMNShape + 每连线 BPMNEdge），使前端 bpmn-js Viewer 可渲染并让 highlight 附着（节点 activityId↔BPMNShape、流转 flowId↔BPMNEdge）。**9 个单测通过**。
- **审批人求值**：`wfAssigneeResolver`（多实例 collection 表达式 bean）按 assigneeRules 顺序展开 ORG/LEADER/FORM_FIELD/INITIATOR + emptyStrategy 兜底。
- **运行时 API**：startable / instances(发起·my·detail·cancel·resubmit·cc) / tasks(todo·done·approve·reject) / notifies（全部 §6 契约，见 api-contract.md「工作流域」）。
- **事件**：全局监听 TASK_CREATED→TODO 通知；PROCESS_COMPLETED→biz_status=APPROVED + RESULT 通知；抄送节点→wf_cc(去重)+CC 通知。
- **种子**：请假审批可发起可跑通（WorkflowInitializer 启动部署，幂等）。

### 定义侧联调收尾（3 点）
- **种子引用 id 制**：V8 迁移将 leave_approval 的 ORG/抄送引用改为 `{kind:"USER",id}`（admin=1 / zhangsan=3），
  置回 DRAFT 令 WorkflowInitializer 重新部署（重生成含 DI + id 引用的 bpmnXml），设计器编辑重存不丢处理人。
- **条件 OR 逻辑**：condition 分支支持 `logic:"AND"|"OR"`（缺省 AND），ConditionCompiler AND→`&&` / OR→`||`；
  前端字段约定见 api-contract.md「工作流域」。
- **详情健壮性**：`GET /instances/{id}` 的 buildDetail 对引擎运行时/历史查询逐段 try-catch + 日志降级
  （异步流转瞬时状态不再抛 500，退化为空高亮/空节点而非整体失败）。

### 验收结果
- `mvn clean package`（含单测）成功；后端启动成功（引擎自建 ACT_* + Flyway V7）。
- `smoke-test.mjs`：**101 项全通过**（原 72 项无回归 + 新增 29 项工作流断言：发起/待办/审批/条件分支进总经理/驳回退回发起人/重提走通/撤销/抄送可见/通知未读增减/无权限建定义 403 + OR 分支创建·发布·命中·走通 + 种子 bpmnXml 含 DI + 引用 id 制）。用时间戳标题/编码保证可重复执行。

### 遗留 / P2 衔接
- reject target=PREV（退回上一步）走 ChangeActivityState，对多实例节点为最佳努力（smoke 仅覆盖 START）；MI 精细收敛留 P2。
- 加签/转办/委派/代理/票签/催办/超时/沟通/已阅 等中国式全家桶属 P2。
- 前端（表单设计器保存、流程定义管理页、发起中心、任务中心、实例详情 bpmn-js 跟踪、通知铃铛对接）未在本次后端范围内。

### P2 后端（已完成，2026-07-08）—— 中国式审批全家桶
分三批实现，每批编译 + 跑 smoke 通过再进下一批；最终 `mvn clean package`（含单测 12 项）成功，重启后 **smoke 204 项全绿**（101 原有 + 103 新增 P2 断言，无回归）。

**批次1 核心操作**（V9 迁移：wf:instance:admin 权限点 + 测试用户 lisi/wangwu）
- 加签 PRE/POST（addMultiInstanceExecution，MI 根父执行定位）、并签、减签（deleteMultiInstanceExecution，剩余≥1 校验）；转办（setOwner+setAssignee）、委派（delegateTask，approve 检测 DELEGATION 状态→resolveTask 回委派人）、拿回（下节点未 act 校验→moveActivityIdsToSingleActivityId 置回本人）。
- 任意驳回增强：target NODE + targetNodeId + resumeStrategy CONTINUE(__resumeMap 跳回驳回点)/BACK；跳转/终止/催办（管理员治理，wf:instance:admin @PreAuthorize）。
- 代理规则（wf_delegate_rule）：任务创建全局监听命中→给受托人挂 candidate（双方可见可办）；todo 查询 assignee∪involvedUser 且过滤转办/委派出去的 owner=我 任务。
- DTO 扩展：InstanceDetail 增 allowedOps/isAdmin/jumpTargets/comments/readByMe；TaskItem 增 groupClaim/delegated。管理员实例列表 GET /instances/admin。

**批次2 协作治理**（V10 迁移：wf_task_read 已阅表）
- 协办 assist / 追加节点 append-node（taskService.newTask ad-hoc 任务，不参与主流程完成条件，complete-adhoc 汇入时间线）；沟通 communicate（wf_operation COMMUNICATE→详情 comments 线程）；已阅 read（wf_task_read→readByMe）；认领 claim/unclaim；离职交接 handover（批量转办在途任务）；暂存草稿 draft/submit/drafts（biz_status=DRAFT，proc_inst_id 用 DRAFT- 占位，不启引擎；submit 激活启动引擎）。

**批次3 引擎增强**（V11 迁移：wf_vote 票签权重表）
- 票签 VOTE：并行多实例 + completionCondition wfVote.pass(execution)，权重/阈值存节点 voteConfig 扩展，approve 记 wf_vote，赞成权重占比>阈值提前完成、剩余票收敛。
- 包容分支 inclusiveGateway（condition gatewayType=INCLUSIVE）；分组策略 CLAIM（candidateUsers=wfAssigneeResolver.resolveCsv 运行时求值，入池 claim）。
- 超时：WfTimeoutScheduler（@Scheduled 服务层扫描，等价 timer 边界事件；支持 seconds 短周期验证）AUTO_PASS/AUTO_REJECT/REMIND(remindEvery)。
- NotifyChannel SPI（NotifyDispatcher + 内置 STATION/LOG，短信/邮件/微信/钉钉扩展点）；WEBHOOK 事件（webhook 节点→wfWebhookDelegate 异步 POST 实例上下文，HttpClient.sendAsync 重试+日志，不阻塞流转）。

**踩坑记录**：① 全局事件监听器注入 TaskService 会与 processEngine 循环依赖→改 ObjectProvider 延迟解析。② Flowable 8 无 TaskQuery.includeAssignedTasks()→代理可见改用 taskInvolvedUser + owner 过滤。③ addMultiInstanceExecution 的 parentExecutionId 须为「MI 根执行的父执行」（叶子→父(MI根)→父）。④ 迁移注释含 `${...}` 被 Flyway 当占位符→移除美元花括号。

### P2 联调修正（2026-07-08，V12）
- **加签退化修复**：原实现用 addMultiInstanceExecution 把被加签人织入当前节点多实例，遇 ANY(或签)节点会被加签人审完即满足、原审批人反而被跳过。改为**串行加签链**（wf_add_sign）：单个任务沿链 setAssignee 依次流转，approve 时非末位只流转下一人(不 complete)、末位才真正 complete 推进节点。PRE 链=[被加签人…,原审批人]（B→A→next）；POST 链=[原审批人,被加签人…]（A→B→next）。与 approve 整合，节点 multiMode 无关。并签(counter-sign)仍为并行 MI。
- **currentHandlers**：GET /instances/{id} 详情增 `currentHandlers:[{userId,name,taskId}]`（我所在节点除我以外的活动处理人），供前端减签弹窗勾选。
- **无效 userId 校验**：转办/委派/加签/协办/追加节点选人统一走 `AssigneeResolver.resolveRefsStrict`，解析后校验用户存在，无效即 400（不再静默创建 name=null 幽灵任务）。
- smoke 扩至 **217 项全绿**（新增前/后加签串行顺序断言、currentHandlers、无效用户 400）。

### P2 未尽项
- 委派/驳回 CONTINUE 对深层多实例节点为最佳努力；票签仅实现赞成权重提前完成（反对否决未单独建模）。
- 超时用服务层扫描器而非 BPMN timer 边界事件（功能等价，便于携带业务语义与短周期验证）。
- 短信/邮件/微信/钉钉 NotifyChannel 为扩展点空实现；WEBHOOK 在流程启动首节点触发时 wf_instance_ext 尚未落库（title 缺失），置于后续节点则上下文完整。
- 前端 P2 由并行 agent 开发，不在本次后端范围。

### P3 后端（已完成，2026-07-08）—— 高级能力
分三批实现，每批编译通过再进下一批；最终 `mvn clean package`（含单测）成功，重启后 **smoke 264 项全绿**（204 原有 P1/P2 + 加签修正后 217，本次在 217 基础上 +43 项 P3 断言 → 260 后又含既有小计=264，无回归）。仅一处联调修正：穿越时空 bizTime timestamptz 回读为 UTC，详情按服务器本地时区还原展示。

**批次1 结构**（无迁移，纯 BPMN 转换 + 详情扩展）
- 子流程 subprocess：JsonToBpmnConverter 新增 CallActivity。**同步** async=false 主流程等子流程结束回跳；**异步** async=true 并行网关旁路（fork→子流程分支到独立 end + 主流程分支继续，不阻塞）。inheritVariables=true 传父变量，paramMap→inParameters。被调子流程需先部署（calledElement=sanitize(defCode)=进程 key）。
- 定时 timer：intermediateCatchEvent(timerEventDefinition, duration/date)，AsyncExecutor 驱动。
- 触发 trigger：serviceTask→`wfTriggerDelegate`，handler 命中注册的 `WfTrigger` bean(可写变量影响路由) 或 webhookUrl 异步 POST；TIMER 前置 timer。内置 `wfEchoTrigger`。
- 节点表单权限：转换器补 approval 节点 `formPerms` 扩展；详情/待办按当前节点返回 `nodeFormPerms`。
- InstanceDetail 扩展：`subInstances`（HistoricActivityInstance activityType=callActivity + calledProcessInstanceId 关联子实例）、`nodeFormPerms`、`predictable`、`resurrectable`、`seals`、`bizTime`。

**批次2 治理**（V13：wf_instance_ext 增 biz_time/resurrect_from，wf_operation 增 biz_time）
- 流程预测 predict：POST instances/{id}/predict，按 designerJson 递归走图，条件分支用 `ConditionEvaluator`（与 ConditionCompiler 同结构化条件、白名单操作符）离线求值当前表单值/流程变量，approval 节点用 `AssigneeResolver.resolveOffline` 试算预计审批人；排除已完成节点；不落库。BPMN 专业模式返回空 path+note。
- 穿越时空 bizTime：StartInstanceRequest 增 bizTime（ISO 日期/日期时间），ext.biz_time + 首个 SUBMIT 操作 biz_time；详情按本地时区还原展示。
- 唤醒 resurrect：POST instances/{id}/resurrect{nodeId}，仅已结束实例；按 form_data 快照 startProcessInstanceByKey + ChangeActivityState.moveActivityIdsToSingleActivityId 定位重审，复用同一 ext 行(proc_inst_id 更新)、resurrect_from 记原实例，通知发起人。
- 印章管理 wf_seal（沿用 V7 表）：WfSeal 实体 + SealService/Controller，GET(登录)/POST/PUT/DELETE(【wf:def:edit】)，imageUrl=/api/infra/files/{imageFileId}/download 引用文件管理。

**批次3 智能**（无迁移；application.yml 加 oa.ai.*）
- AI 审批节点 ai：serviceTask→`wfAiApprovalDelegate`，读节点 aiModel/aiSystemPrompt/aiFormContext/aiOutputMap，组装上下文交 `AiApprovalProvider` SPI 决策。默认实现 `DefaultAiApprovalProvider`：enabled 且有 key→OpenAI 兼容 chat completions(解析 {"decision","comment"}，异常降级)；无 key→规则模拟默认通过，意见明示「AI模拟」。写 wf_operation(actor=AI, action=AI_APPROVE) + 按 outputMap 设变量。配置 `OaAiProperties`(@ConfigurationPropertiesScan 注册)。
- 动态构建 ad-hoc：POST instances/{id}/adhoc-task{name,assignees}（WfCollaborationService.adhocTask，taskService.newTask 不体现流程图、不参与主流程完成条件，complete-adhoc 汇入时间线）。

**踩坑记录**：① timestamptz 回读为 UTC 使日期偏移（bizTime "2025-01-15" 展示需 atZoneSameInstant(systemDefault) 还原本地）。② @ConfigurationProperties 类勿再加 @Component（@ConfigurationPropertiesScan 已注册，双注册报错）。③ 异步子流程用「并行网关无 join + 各分支独立 none end」实现 fire-and-forget，进程在所有并发 token 到达 end 后才 PROCESS_COMPLETED。④ CallActivity calledElement 取的是进程定义 key(=BPMN process id=sanitize(defCode))，非 deployment.key。⑤ `mvn -pl X -am package` 增量偶发不重打 boot 胖 jar，改 root `clean package` 确保 jar 含最新类。

### P3 未尽项
- 预测仅支持 DINGTALK designerJson 模式（BPMN 专业模式返回空 path + note）；LEADER/FORM_FIELD 离线试算依赖 initiator/表单值。
- AI 真实调用为 OpenAI 兼容 chat completions（Claude 走其 OpenAI 兼容端点/网关），无 key 时走模拟；smoke 覆盖模拟路径（actor=AI + 「AI模拟」意见），真实 API 未在 CI 内联调。
- seals 详情展示（已用章）从 wf_operation SEAL 动作聚合，当前无自动盖章写入点（留前端/后续用章记录接入）；打印套打页为前端职责。
- 唤醒未加独立权限点（治理入口，当前登录即可调，实际由管理员使用）；穿越时空 operation 级 biz_time 仅在首个 SUBMIT 落，后续操作可扩展。
- 前端 P3（workflow-p3.ts + 预测可视化/套打页/子流程入口/唤醒穿越入口/AI 节点属性面板）由并行 agent 开发，不在本次后端范围。

---

# P2 实施规格（中国式全家桶）—— 前后端共同契约

> 本节为 P2 前后端唯一契约依据。后端按此实现并回写 docs/api-contract.md 工作流域；前端按此开发，最终以 api-contract.md 为准。所有选人入参统一用 OrgRef `{kind:"USER"|"DEPT"|"ROLE", id:<number>}`。所有操作写 wf_operation 审计 + 触发通知。

## P2-A 任务操作（前缀 /api/wf/tasks/{id}）
| 端点 | 入参 | 语义 |
|---|---|---|
| POST add-sign | `{mode:"PRE"\|"POST", users:[OrgRef], comment?}` | 加签：PRE=被加签人先审完再回到我；POST=我通过后加签人审再进下节点。用 addMultiInstanceExecution，父任务 WAITING |
| POST counter-sign | `{users:[OrgRef], comment?}` | 并签：当前多实例节点追加平行审批人，与我同时审 |
| POST reduce-sign | `{removeUserIds:[number]}` | 减签：移除本节点未办理的其他审批人，剩余≥1，用 deleteMultiInstanceExecution |
| POST transfer | `{user:OrgRef, comment?}` | 转办：setOwner(我)+setAssignee(对方)，责任移交，对方审进下节点 |
| POST delegate | `{user:OrgRef, comment?}` | 委派：taskService.delegateTask，对方审完 resolve 回我，我再提交进下节点 |
| POST assist | `{users:[OrgRef], comment}` | 协办/征求意见：建独立意见任务，不参与完成条件，意见汇入主任务 |
| POST claim / unclaim | `-` | 认领/退回池（分组 CLAIM 节点的候选任务） |
| POST read | `-` | 已阅标记（wf_task_read） |
| POST communicate | `{toUserIds:[number], content}` | 沟通留言（不影响流转，通知对方，线程化） |
| approve 增强 | 原参 | 检测 delegation 状态：委派受托人 approve = resolveTask 回原委派人 |

## P2-B 流转控制 + 治理（前缀 /api/wf）
| 端点 | 入参 | 语义 / 权限 |
|---|---|---|
| POST tasks/{id}/reject（增强） | `{target:"PREV"\|"START"\|"NODE", targetNodeId?, comment, resumeStrategy:"CONTINUE"\|"BACK"}` | 任意节点驳回；CONTINUE=重审后回驳回点续走，BACK=重走中间路径 |
| POST tasks/{id}/retrieve | `{comment?}` | 拿回：我已办任务，在下一节点无人处理前取回重办（校验下节点未 act） |
| POST instances/{id}/jump | `{targetNodeId, comment?}` | 管理员跳转任意办理节点【wf:instance:admin】 |
| POST instances/{id}/terminate | `{comment?}` | 管理员终止实例【wf:instance:admin】 |
| POST instances/{id}/urge | `{comment?}` | 催办当前处理人（通知+记录，可重复） |
| POST instances/{id}/append-node | `{afterNodeId, name, assignees:[OrgRef], multiMode:"ANY"\|"ALL"\|"SEQUENCE"}` | 追加节点：实例级动态加处理人，不改定义（动态多实例/ad-hoc） |
| GET instances/admin | `?status=&keyword=&pageNum=&pageSize=` | 管理员全实例列表【wf:instance:admin】，走数据权限 |
| POST wf/handover | `{fromUserId, toUserId, comment?}` | 离职交接：批量转办某人全部在途任务【wf:instance:admin】 |

## P2-C 暂存待审（草稿）
| 端点 | 入参 | 语义 |
|---|---|---|
| POST instances/draft | `{defCode, formData, title?}` | 存草稿，wf_instance_ext.biz_status=DRAFT，不启动引擎 |
| PUT instances/{id}/draft | `{formData, title?}` | 修改草稿（仅 DRAFT + 本人） |
| POST instances/{id}/submit | `{formData?}` | 激活：启动引擎，DRAFT→RUNNING |
| GET instances/drafts | `?pageNum=&pageSize=` | 我的草稿列表 |

## P2-D 委托规则（代理预设）
| 端点 | 入参 | 语义 |
|---|---|---|
| GET/POST/DELETE wf/delegate-rules | `{delegateToId, defCode?(null=全部), startDate, endDate, enabled}` | 代理：命中时任务创建自动给受托人挂 candidate，双方可见可办，任一办结即结束，历史双方可查 |

## P2-E 定义侧增强（转换器 / 节点属性，不新增运行时 API）
- **票签 VOTE**：节点 `multiMode:"VOTE"` + `voteConfig:{weights:{userId:weight}, threshold:0.5}` → 并行多实例 + `completionCondition ${wfVote.pass(execution)}`（赞成权重占比>阈值提前完成，反对使无法达标则节点判拒）
- **包容分支**：condition 节点 `gatewayType:"INCLUSIVE"`（缺省 EXCLUSIVE）→ inclusiveGateway，满足的多分支都走，全不满足走 default
- **分组策略**：审批节点 `groupMode:"CLAIM"\|"ALL"`（配合 ORG=DEPT/ROLE 规则）→ CLAIM=candidateGroup+认领；ALL=展开成员进多实例
- **超时**：节点 `timeout:{hours, action:"REMIND"\|"AUTO_PASS"\|"AUTO_REJECT", remindEvery?}` → timer 边界事件 + AsyncExecutor 驱动，REMIND 按 remindEvery 重复提醒
- **操作白名单**：节点 `allowedOps:[...]`（approve/reject/addSign/reduceSign/transfer/delegate/assist/retrieve/print/seal...），详情/待办据此约束

## P2-F 事件配置化（后端执行）
- **NotifyChannel SPI**：`interface NotifyChannel { void send(NotifyMessage) }`，内置站内(wf_notify)+日志两实现；短信/邮件/微信/钉钉留空实现+扩展点注释
- **WEBHOOK 事件**：事件 `action:"WEBHOOK"` → OaEventDelegate 异步 POST 实例上下文(JSON)到配置 url，失败重试+日志，不阻塞流转
- 事件触发点（复用 P1 OaEventDelegate 单入口）：nodeEnter/nodeComplete/taskCreated/taskTimeout + instanceStarted/Completed/Rejected/Canceled

## P2 DTO 扩展（前端依赖）
- **InstanceDetail** 增：`allowedOps:string[]`（我当前任务可用操作，节点白名单∩权限）、`isAdmin:boolean`（我有 wf:instance:admin）、`jumpTargets:[{nodeId,name}]`（可跳转节点）、`comments:[{taskId,fromName,content,createdAt}]`（沟通线程）、`readByMe:boolean`
- **TaskItem** 增：`groupClaim:boolean`（是否待认领）、`delegated:boolean`
- **草稿/管理员列表项**沿用 InstanceListItem + biz_status 含 DRAFT

## P2 分批实施建议（后端 agent 内部）
批次1（核心操作）：加签/减签/转办/委派/代理规则/任意驳回+重审/拿回/跳转/终止/催办 + allowedOps + DTO 扩展 + 管理员列表
批次2（协作与治理）：协办/沟通/已阅/认领/追加节点/离职交接/暂存草稿
批次3（引擎增强）：票签/包容分支/分组策略/超时+提醒 SPI/WEBHOOK 事件
每批：迁移(V9/V10...) + smoke 断言 + api-contract 更新。

---

# P3 实施规格（高级能力）—— 前后端共同契约

> P3 前后端唯一契约依据。后端(server/)实现并回写 api-contract.md；前端 P3 类型放 **src/types/workflow-p3.ts**（不改 workflow.ts，避免与表单设计器第二波争用同文件）。选人仍用 OrgRef{kind,id}。

## P3-A 运行时新端点（/api/wf）
| 端点 | 入参/返回 | 语义 |
|---|---|---|
| POST instances/{id}/predict | → `{path:[{nodeId,nodeName,type,assignees:[{name}]}], note?}` | 流程预测：按当前表单值静态 DFS 求值条件分支，输出后续将经过节点+预计审批人，不落库 |
| POST instances/{id}/resurrect | `{nodeId, comment?}` → InstanceDetail | 唤醒：已结束实例(APPROVED/REJECTED/TERMINATED/CANCELED)按快照重建新实例并定位 nodeId 重审，ext 记 resurrectFrom |
| POST instances（增强） | 可选 `bizTime`(ISO 日期) | 穿越时空：补审，ext.biz_time 记录；时间线/审批记录展示用 bizTime，引擎真实时间不动 |
| GET/POST/DELETE wf/seals | `{name, imageFileId, enabled}` | 电子章管理（引用文件管理），POST/DELETE【wf:def:edit】 |

打印无需新端点：前端用 GET instances/{id} 详情（表单快照+timeline+seals）渲染套打页 + 浏览器打印。

## P3-B 定义侧节点类型（JsonToBpmnConverter + designer 节点属性）
| 节点 type | BPMN 映射 | props |
|---|---|---|
| subprocess 子流程 | CallActivity(同步) / async=并行旁路+信号回写 | `{defCode, async:bool, paramMap:{子变量:父字段}}` |
| timer 定时 | intermediateCatchEvent(timerEventDefinition) | `{mode:"duration"|"date", value}` |
| trigger 触发 | serviceTask→TriggerDelegate | `{triggerType:"IMMEDIATE"|"TIMER", handler|webhookUrl, timer?}` |
| ai AI审批 | serviceTask→AiApprovalDelegate | `{model, systemPrompt, formContext:[字段], outputMap:{approve/reject/route→变量+意见}}` |

- **AI 审批 SPI**：默认实现走 OpenAI 兼容/Claude API（读配置 oa.ai.* key/baseUrl/model）；无 key 时降级为规则模拟并在审批意见明示「AI模拟」。审批记录标注 actor=AI。
- **动态构建**：P2 append-node 已覆盖"实例级加处理人"；P3 补"不体现在流程图"的 ad-hoc 任务(服务层管理完成条件)。
- **节点表单字段权限**：节点 formPerms(P1 已有模型 HIDDEN/READ/EDIT)，详情/待办按当前节点返回 formPerms，前端 FormRenderer 已支持 perms → 运行渲染按节点权限显隐/只读。

## P3-C InstanceDetail 扩展（前端 workflow-p3.ts，交叉类型不改 workflow.ts）
```ts
interface WfInstanceDetailP3 extends WfInstanceDetail {
  subInstances?: { nodeId; subInstanceId; title; bizStatus }[]  // 子流程入口
  predictable?: boolean; resurrectable?: boolean
  seals?: { nodeName; sealImageUrl; userName; time }[]           // 已用章
  bizTime?: string                                               // 穿越时空业务时间
  nodeFormPerms?: Record<string, "HIDDEN"|"READ"|"EDIT">         // 当前节点字段权限
}
```

## P3 分批（后端 agent 内部）
1. 子流程(CallActivity 同步/异步) + 定时 + 触发 + 节点表单权限返回
2. 唤醒 + 穿越时空 + 流程预测 + 印章管理
3. AI 审批节点(SPI) + 动态构建 ad-hoc
每批：迁移(V13+)/smoke/api-contract。

## P3 前端（workflow-p3.ts + 不碰表单设计器域文件）
- 实例详情：预测(可视化后续路径)、打印套打页(表单+记录+盖章,浏览器打印)、盖章展示、子流程入口跳转、唤醒/穿越时空入口(治理)。
- 流程设计器(dingtalk)：子流程/定时/触发/AI 节点类型 + 属性配置面板。
- 节点表单权限：详情表单快照按 nodeFormPerms 渲染。
- 印章管理页(可选，或并入监控/治理)。
