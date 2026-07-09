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

### Notes
- 破坏性：后端启动现在必须设置环境变量 `OA_JWT_SECRET`。
- 数据库新增迁移 V15（文件查看权限种子）、V16（会议排他约束）、V17（乐观锁 version 列）。
