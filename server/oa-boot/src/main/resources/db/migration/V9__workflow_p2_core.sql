-- ============================================================
-- OA Platform - V9 工作流 P2 批次1（核心操作）
--   1) 权限点 wf:instance:admin（跳转/终止/管理员实例列表/交接）授予 ADMIN
--   2) P2 多人协作测试用户 lisi(李四) / wangwu(王五)，便于加签/票签/分组等端到端验证
--   委托规则表 wf_delegate_rule 已在 V7 建，本批只补 mode 语义（代理=命中挂 candidate，无需新列）
-- ============================================================

-- 权限点：流程实例管理（跳转/终止/交接/管理员列表）
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'wf:instance:admin', '流程实例管理', 'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code = 'wf:instance:admin';

-- P2 协作测试用户（明文密码 admin123，启动时 DataInitializer 会 BCrypt 回写）
INSERT INTO sys_user (username, password, name, dept, post, phone, enabled) VALUES
    ('lisi',   'admin123', '李四', '人事行政部', '人事专员', '13800000004', TRUE),
    ('wangwu', 'admin123', '王五', '人事行政部', '人事专员', '13800000005', TRUE);

-- 主任职：人事行政部(dept_id=4) / 人事专员(post_id=5)
INSERT INTO sys_user_assignment (user_id, dept_id, post_id, is_primary, enabled)
SELECT id, 4, 5, TRUE, TRUE FROM sys_user WHERE username IN ('lisi', 'wangwu');

-- 授 EMPLOYEE 角色(role_id=3)
INSERT INTO sys_assignment_role (assignment_id, role_id)
SELECT a.id, 3
FROM sys_user_assignment a
JOIN sys_user u ON u.id = a.user_id
WHERE u.username IN ('lisi', 'wangwu');
