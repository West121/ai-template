-- ============================================================
-- OA Platform - V18 工作流 Tier 2 脚本引擎（LiteFlow）治理（N-B-05/06/07）
--   1) 新增权限码 wf:script:write（脚本编写：写/改流程脚本节点、测试运行端点）
--      —— 仅授予超管（ADMIN，role_id=1）；ADMIN 亦代码级自动拥有全部权限（PermissionService），
--         此处显式授权行是"仅管理员可写脚本"治理红线的落地凭据。
--      —— 普通用户 / 部门经理即使能配流程，也不得写/改脚本（Tier 2 = 应用完整权限，非沙箱）。
--   2) 脚本执行审计表 wf_script_exec_log：每次脚本执行（含 scriptTask 运行时 + 测试运行）落库一条，
--      记录 who / 脚本标识 / 语言 / 耗时 / 成功失败 / 时间，供安全审计追溯。
--   风格对齐 V7-V17：BIGSERIAL 主键、timestamptz 时间列。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 权限码 wf:script:write（仅 ADMIN）
-- ------------------------------------------------------------
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'wf:script:write', '流程脚本编写', 'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code = 'wf:script:write';

-- ------------------------------------------------------------
-- 2. 脚本执行审计（Tier 2 脚本以应用完整权限运行，全量审计是硬约束）
-- ------------------------------------------------------------
CREATE TABLE wf_script_exec_log (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     BIGINT,                      -- 执行者用户 id（运行时可能为系统/异步线程 → 空）
    actor_name   VARCHAR(64),                 -- 执行者名（空=系统）
    script_ref   VARCHAR(255),                -- 脚本标识：scriptTask=<procDefId>#<nodeId>；测试运行=test-run
    lang         VARCHAR(16)  NOT NULL,        -- groovy / js / python
    source       VARCHAR(20)  NOT NULL,        -- TASK（流程节点运行时） / TEST_RUN（编辑器测试）
    success      BOOLEAN      NOT NULL,        -- 执行是否成功
    cost_ms      BIGINT,                       -- 执行耗时（毫秒，含编译）
    error_msg    TEXT,                         -- 失败原因（成功为空）
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_wf_script_log_actor ON wf_script_exec_log (actor_id);
CREATE INDEX idx_wf_script_log_time  ON wf_script_exec_log (created_at);
