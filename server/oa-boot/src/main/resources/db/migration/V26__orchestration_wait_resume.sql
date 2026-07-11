-- ============================================================
-- OA Platform - V26 编排批3：Wait 挂起 / 失败续跑（契约 orchestration-design.md §9.2/§9.3）
--   orch_exec 扩列：
--     resume_token     wait 挂起恢复令牌（免登录 POST /api/orch/resume/{token}）
--     current_segment  分段链当前段（0=主段；挂起一次 +1，信息列）
--     parent_exec_id   失败续跑血缘（新 exec 指向失败的父 exec）
--     context_snapshot 完整上下文快照 JSON {payload,vars,outputs,failedNodes,waitNodeId?,waitDeadline?}
--                      —— 完整不截断（节点留痕的 8KB 截断仅用于展示列）
--   状态值新增 WAITING（无 schema 变更）。仅 orch_*。
-- ============================================================

ALTER TABLE orch_exec ADD COLUMN resume_token     VARCHAR(64);
ALTER TABLE orch_exec ADD COLUMN current_segment  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orch_exec ADD COLUMN parent_exec_id   BIGINT;
ALTER TABLE orch_exec ADD COLUMN context_snapshot TEXT;

CREATE INDEX idx_orch_exec_resume ON orch_exec (resume_token);
