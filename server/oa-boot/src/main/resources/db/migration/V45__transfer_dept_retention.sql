-- ============================================================
-- V45 转岗治理 · DP3a：旧部门数据保留期
--   sys_dept_retention：转岗后保留期内该用户仍可见旧部门数据；过期自动收敛（查询按 expire_at>now 过滤）。
--   折入 PermissionService 部门维可见集。仅新增表；不改现有行为（无保留记录=不影响）。
-- ============================================================
CREATE TABLE sys_dept_retention (
    id        BIGSERIAL PRIMARY KEY,
    user_id   BIGINT    NOT NULL,
    dept_id   BIGINT    NOT NULL,
    expire_at TIMESTAMP NOT NULL
);
-- 查询「某用户当前保留期内旧部门」的复合索引（每请求装配 UserContext 时命中）
CREATE INDEX idx_sys_dept_retention_user ON sys_dept_retention (user_id, expire_at);
