-- ============================================================
-- V48 在线用户管理 + 踢人下线：权限码
--   system:online:list（查看在线会话）/ system:online:kick（踢人下线）。授予超级管理员角色(ADMIN=role 1)。
--   （超管代码级本就拥有全部权限码；此显式授予与既有 system:* 种子范式一致。前端菜单项由疾风挂。）
-- ============================================================
-- 序列对齐最大 id（历史迁移可能用显式 id 插过 sys_permission），避免自增撞号
SELECT setval('sys_permission_id_seq', (SELECT MAX(id) FROM sys_permission));

INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'system:online:list', '在线用户查看', 'MENU'),
    (0, 'system:online:kick', '踢人下线',     'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code IN ('system:online:list', 'system:online:kick');
