# 数据权限高级化 + 人员生命周期治理

> 用户裁定(2026-07-12):**做可扩展多维数据权限**(部门+成本中心/项目/自定义) + **做完整转岗/离职治理**;**排在知识库/管理框架之后**。

## 现状(查证)

- 数据权限只按**部门维度**:`DataScope{selfOnly, deptIds, userId}` → `dept_id IN deptIds OR applicant_id=userId`;5 档 ALL/DEPT_AND_CHILD/DEPT/SELF/CUSTOM(角色 dataScope + 活动任职部门)。JPA Specification 下推。
- 转岗/离职:仅 `sys_user.enabled` 开关 + 多任职 assignment 切换;无待办交接/审批链改派/历史归属/权限迁移的系统治理。

## 一、多维数据权限(可扩展,不只部门)

**核心:数据维度可插拔**(和管理操作框架/报表维度同思路)。
1. **维度注册**:业务实体声明自己的数据维度字段——除内建 `dept`(dept_id)/`self`(applicant_id),加业务维度
   `costCenter`(cost_center_id)/`project`(project_id)/自定义。方式:`@DataDimension(code,column)` 标实体
   或 `DataDimensionProvider` bean。**新维度注册即可用**。
2. **权限配置**:角色/用户在**每个维度**上配可见范围——`dept∈可见部门(现有 5 档)` AND/OR `costCenter∈{研发}`
   AND `project∈{A,B}`。存 `sys_role_data_dimension`/`sys_user_data_dimension`(principal/dimension/scope
   ALL|CUSTOM/value 集)。
3. **查询组合**:`DataScopeSpecification` 升级为**多维组合**——遍历该实体声明的维度,每维取用户配置的范围拼
   Predicate,维度间 AND(可配 OR);未配维度=不限。向后兼容:现有只有 dept 维度的实体行为不变。
4. **成本中心/项目基础数据**:建 `sys_cost_center`/`biz_project`(或复用组织/自定义档案);业务单据(报销/
   采购/审批)加 cost_center_id/project_id 字段(渐进,按需)。
5. **UI**:角色/用户编辑增"数据维度授权"(选维度+范围);实体维度声明在代码。
6. **红线**:维度白名单(注册的才可配),范围值走校验,Specification 参数化(不拼 SQL);默认更严(未配=按内建
   部门维度,不放大)。

## 二、人员生命周期治理

### 离职(offboarding)
- 触发:用户置离职(新状态 `RESIGNED` 或 enabled=false+离职标记+离职日期)。
- **账号**:禁登录;token 失效。
- **待办交接**:该用户名下未办 wf_task **批量转办**给指定继任者/其上级(交接向导:选继任者→批量 transfer,留痕)。
- **审批链改派**:流程定义里"指定该用户/其为部门负责人"的节点,运行中实例自动改派(继任者/部门新负责人);
  未来实例按新组织解析。
- **历史数据**:applicant_id/办理记录**不变**(可追溯);可见性归其上级/继任者/管理员(数据权限即时失效——
  离职用户不再出现在任何数据维度范围)。
- **组织**:若是部门负责人→需先指定新负责人(阻断离职或提示)。

### 转岗(transfer)
- 触发:任职变更(换部门/岗位/角色,多任职 assignment 增删)。
- **权限**:数据权限/功能权限按**新任职**即时生效(切换活动任职 re-sign token,现有机制);多维范围按新配置。
- **历史归属**:本人发起/办理的历史数据仍归本人(applicant 不变);可见性按当前权限(转岗后可能看不到旧部门
  数据——可配"旧部门数据保留期"过渡)。
- **审批链**:进行中实例里该用户的待办**保留**(转岗不自动改派,除非离职);新实例按新组织。
- **直属上级**:转岗后 LEADER 规则自动按新部门经理(见 workflow-design「直属上级默认部门经理」)。

### 分工/批次(排知识库/管理框架后)
- 批DP1 多维数据权限框架 + 成本中心/项目基础 + 角色/用户维度授权(磐石后端 DataScopeSpecification 多维/
  维度注册/配置表/UI 疾风)。
- 批DP2 离职 offboarding(状态+交接向导+审批链改派+权限失效)。
- 批DP3 转岗(任职变更+权限迁移+历史归属+保留期)。
- 每批向后兼容、smoke(KEEP=1)、防白屏。

## 三、交接表结构(用户追问)

- **sys_handover**(交接单):id/tenant_id/from_user_id(离职/转出)/to_user_id(继任)/type(RESIGN|TRANSFER)/
  reason/status(DRAFT|RUNNING|DONE)/operator_id/created/completed_at。
- **sys_handover_item**(交接项,逐项可重试幂等):id/handover_id/item_type(WF_TASK 待办|WF_NODE_ASSIGNEE
  流程节点指派|DEPT_LEADER 部门负责人|KB_SPACE_OWNER 知识库空间|DATA_OWNER 数据归属|SCHEDULE/MEETING…)/
  ref_type/ref_id/old_value/new_value(json)/status(PENDING|DONE|SKIPPED)/note。
- 流程:离职/转岗触发→扫描该用户名下各类归属→逐项建 item→交接向导选继任者→批量执行(转办/改派/换 owner,
  各调对应业务 Service)→item 级留痕+失败重试单项+审计。**部门负责人未指定继任则阻断离职**。

## 四、配置化 + 大型企业级性能(用户硬要求)

**配置化(不硬编码)**:维度=元数据 `sys_data_dimension`(code/label/entity/column/enabled);授权=配置表
`sys_role_data_dimension`/`sys_user_data_dimension`(principal/dimension/scope ALL|CUSTOM/value 集);实体声明
维度=注解/provider。**改维度/授权=改数据不改代码**。

**性能(支撑 10w+ 用户/千万级数据)——核心:绝不在查询时实时算权限**:
1. **可见范围预计算+缓存**:用户各维度可见 ID 集(可见部门/成本中心/项目集)在**登录/权限变更时预计算**→
   Redis 缓存(TTL+主动失效);查询直接取缓存集拼 `col IN (:集)`,**不 join 权限表、不递归**。
2. **部门树用闭包表/物化路径**:DEPT_AND_CHILD 子部门集——`sys_dept_closure`(ancestor/descendant/depth)或
   dept.path 物化路径(`LIKE '1/2/%'`),索引取子树不跑递归 CTE;部门树预算缓存。
3. **索引化 IN**:业务表 dept_id/cost_center_id/project_id/applicant_id/created 复合索引,`IN(集)` 走索引。
4. **短路优化**:ALL→**不拼 Specification**(全表最快);SELF→applicant_id=?(索引);范围集过大(集团几千部门)
   →`EXISTS(授权临时表)` / `col = ANY(数组)` 避免超长 IN。
5. **缓存失效**:组织/角色/授权/任职变更→精准失效受影响用户范围缓存(<1s 生效)。
6. **超大表**:按 dept_id/created 声明式分区(PG);冷热归档。
7. **多维组合下推数据库**(不内存过滤);维度间可配 AND/OR;分页/count 同条件。
- **基准目标**:千万行单表按权限过滤 P95 < 200ms;权限变更缓存失效 < 1s。
