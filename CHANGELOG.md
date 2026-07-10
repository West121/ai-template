# Changelog

本项目变更记录。版本策略：进入稳定阶段前以日期分组记录；里程碑打 tag。

## [Unreleased]

### Security
- JWT 密钥与 DB/Redis/xxl-job 等敏感配置外部化为环境变量，新增 `application-prod.yml`；启动强制校验 `OA_JWT_SECRET`（≥32 字符）(B-01/B-02)
- 文件下载/列表补鉴权与归属校验，防越权下载他人文件 (B-04)
- 审批 `my/done/cc/logs/withdraw` 补权限与归属校验，`logs` 防越权读他人审批记录 (B-05)
- 日志接口收敛到 `system:log:list` 权限并 DTO 化，不再返回实体 (B-06)
- 富文本编辑侧接入 sanitize，防存储型 XSS (F-02)
- SecurityConfig 放行 `DispatcherType.ERROR`，修复匿名/出错请求的 "response already committed" 连接重置 (B-18)

### Fixed / Correctness
- 会议室预订加 `btree_gist` 排他约束 + 409 兜底，杜绝并发双重预订 (B-03)
- `Approval`/`WfAddSign` 加乐观锁 `@Version`，并发冲突转 409 (B-07)
- `ApprovalService.done()` / `MeetingService.my()` 分页下推到 SQL（含精确成员匹配，修 `"1"` 误命中 `"11"`）(B-08)
- `AssigneeResolver` 全表扫描改条件查询 (B-09)

### Added
- CI 流水线 `.github/workflows/ci.yml`：前端 lint/tsc/build + 后端 compile 门禁 + 集成冒烟 (Q-01)
- `CLAUDE.md` 项目指南；`docs/remediation-plan.md` 修复计划；`docs/design/next-gen-workflow-and-formula.md` 下一代设计器/公式/脚本设计

### 下一代工作流设计器（路径三，全 E2E 验证）
- **react-flow 自研 BPMN 设计器**替换 bpmn-js：归一化 `ProcessModel` 契约（前端产出 JSON，后端 `GraphToBpmnConverter` 直译为 Flowable BpmnModel + 据坐标生成 BPMN DI）；全 14 类节点（事件/审批/排它·并行·包容网关/子流程/定时/callActivity/cc·ai·webhook·脚本 serviceTask）；调色板、连接规则校验、UI 打磨。E2E：排它条件路由 8/8、并行 fork/join 6/6。
- **删除 bpmn-js / diagram-js-grid**；FlowViewer 只读渲染器（实例详情运行时高亮）；新设计器接入生产流程定义页（GRAPH 类型 + `/api/wf/models/graph/deploy`）；钉钉设计器并存。
- **Aviator 安全表达式引擎（Tier1 公式）**：禁反射/new/静态/循环沙箱 + `@FormulaFunction` 自定义函数（deptLeader/dictLabel/workDays）+ 网关高级条件 `exprEval`。E2E 7/7。
- **LiteFlow 脚本引擎（Tier2）**：LiteFlow 2.16.0（Groovy/GraalJS/Jython）+ `@ScriptBean("spring")` 门面调任意 Bean + 治理（`wf:script:write`、`wf_script_exec_log` 审计、诚实标注非沙箱）+ scriptTask + test-run 端点。E2E 7/7。
- **F-01 假沙箱消灭**：前端公式改安全 AST 解释器（零 `new Function`）。
- **.bpmn 导入导出**（Flowable `BpmnXMLConverter` + `BpmnToGraphConverter` 全类型逆向）。往返 E2E 12/12。
- **表单字段清单系统**：`GET /api/wf/forms/{formKey}/fields`（ONLINE 从 schemaJson 派生）+ 前端 `formRegistry`/`HostedForm`/节点字段权限矩阵编辑器（写 `WfNodeProps.formPerms`）。
- smoke-test 新增 43 条断言覆盖上述全部场景，**smoke 总计 433/433**。

### Notes
- 破坏性：后端启动现在必须设置环境变量 `OA_JWT_SECRET`。
- 数据库新增迁移 V15（文件查看权限种子）、V16（会议排他约束）、V17（乐观锁 version 列）、V18（脚本引擎权限+审计表）、V19（表单字段清单 form_type）。
- 前端新增依赖 vitest；后端新增依赖 Aviator、LiteFlow（脚本插件 groovy/graaljs/python，约 +118MB jar）。
- 路径三收尾（已完成）：dagre 自动布局（整理布局按钮 + 坐标退化自动整理）、CODE 表单运行时接线（instance-detail 按来源分流 HostedForm，只读查看路径）、钉钉 designerJson→ProcessModel 适配器（已实现 + 单测）。前端 vitest 47。
- 真正剩余的可选后续（不影响主功能，已注释标注）：CODE 表单的可编辑办理/重新提交路径（当前为只读查看）、钉钉适配器接入"打开旧定义"入口（钉钉设计器并存、老定义仍可用）、CI integration-smoke 转硬门禁（当前 PR/手动 + 本地 smoke 433/433 覆盖）。
