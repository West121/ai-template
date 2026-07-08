-- ============================================================
-- OA Platform - V2 RBAC + 数据权限 + 兼任模型
--   sys_dept.ancestors / 岗位 / 角色 / 权限 / 任职（兼任）
--   oa_approval 增加 dept_id / applicant_id 用于数据权限过滤
-- ============================================================

-- ------------------------------------------------------------
-- 1. 部门：增加 ancestors（祖先链，如 '0,1'），对齐既有部门树
--    V1 已有：1 星辰科技(根) / 2 技术部 / 3 产品部 / 4 人事行政部
--    本版补：5 财务部
-- ------------------------------------------------------------
ALTER TABLE sys_dept ADD COLUMN ancestors VARCHAR(255) NOT NULL DEFAULT '';

UPDATE sys_dept SET parent_id = 0, ancestors = '0'  WHERE id = 1;
UPDATE sys_dept SET ancestors = '0,1'               WHERE parent_id = 1;

INSERT INTO sys_dept (id, name, parent_id, sort, ancestors) VALUES
    (5, '财务部', 1, 4, '0,1');
SELECT setval('sys_dept_id_seq', (SELECT MAX(id) FROM sys_dept));

-- ------------------------------------------------------------
-- 2. 岗位
-- ------------------------------------------------------------
CREATE TABLE sys_post (
    id   BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    sort INTEGER
);

INSERT INTO sys_post (id, code, name, sort) VALUES
    (1, 'CEO',     '总经理',   1),
    (2, 'PM_MGR',  '产品经理', 2),
    (3, 'DEV',     '工程师',   3),
    (4, 'FIN_DIR', '财务总监', 4),
    (5, 'HR',      '人事专员', 5);
SELECT setval('sys_post_id_seq', (SELECT MAX(id) FROM sys_post));

-- ------------------------------------------------------------
-- 3. 角色（data_scope: ALL / DEPT_AND_CHILD / DEPT / SELF / CUSTOM）
-- ------------------------------------------------------------
CREATE TABLE sys_role (
    id         BIGSERIAL PRIMARY KEY,
    code       VARCHAR(64) NOT NULL UNIQUE,
    name       VARCHAR(64) NOT NULL,
    data_scope VARCHAR(20) NOT NULL,
    sort       INTEGER,
    enabled    BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO sys_role (id, code, name, data_scope, sort, enabled) VALUES
    (1, 'ADMIN',        '系统管理员', 'ALL',            1, TRUE),
    (2, 'DEPT_MANAGER', '部门经理',   'DEPT_AND_CHILD', 2, TRUE),
    (3, 'EMPLOYEE',     '普通员工',   'SELF',           3, TRUE),
    (4, 'FINANCE',      '财务',       'CUSTOM',         4, TRUE);
SELECT setval('sys_role_id_seq', (SELECT MAX(id) FROM sys_role));

-- ------------------------------------------------------------
-- 4. 权限点（MENU / BUTTON）
-- ------------------------------------------------------------
CREATE TABLE sys_permission (
    id        BIGSERIAL PRIMARY KEY,
    parent_id BIGINT,
    code      VARCHAR(64) NOT NULL UNIQUE,
    name      VARCHAR(64) NOT NULL,
    type      VARCHAR(10) NOT NULL
);

INSERT INTO sys_permission (id, parent_id, code, name, type) VALUES
    (1, 0, 'dashboard',               '工作台',   'MENU'),
    (2, 0, 'office:approval',         '审批管理', 'MENU'),
    (3, 2, 'office:approval:list',    '审批查询', 'BUTTON'),
    (4, 2, 'office:approval:create',  '发起审批', 'BUTTON'),
    (5, 2, 'office:approval:approve', '审批处理', 'BUTTON'),
    (6, 0, 'system:user:list',        '用户查询', 'MENU');
SELECT setval('sys_permission_id_seq', (SELECT MAX(id) FROM sys_permission));

-- ------------------------------------------------------------
-- 5. 角色-权限
--    ADMIN=全部；DEPT_MANAGER=dashboard + office:approval 全部；
--    EMPLOYEE=dashboard/approval/list/create；FINANCE=dashboard/approval/list/approve
-- ------------------------------------------------------------
CREATE TABLE sys_role_permission (
    role_id       BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);

INSERT INTO sys_role_permission (role_id, permission_id) VALUES
    (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6),
    (2, 1), (2, 2), (2, 3), (2, 4), (2, 5),
    (3, 1), (3, 2), (3, 3), (3, 4),
    (4, 1), (4, 2), (4, 3), (4, 5);

-- ------------------------------------------------------------
-- 6. 角色自定义数据范围（CUSTOM）：FINANCE → 财务部
-- ------------------------------------------------------------
CREATE TABLE sys_role_dept (
    role_id BIGINT NOT NULL,
    dept_id BIGINT NOT NULL,
    PRIMARY KEY (role_id, dept_id)
);

INSERT INTO sys_role_dept (role_id, dept_id) VALUES (4, 5);

-- ------------------------------------------------------------
-- 7. 任职（一人多任职，一条主任职，其余兼任）
--    用户：1 admin / 2 manager(王经理) / 3 zhangsan(张三)
-- ------------------------------------------------------------
CREATE TABLE sys_user_assignment (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT  NOT NULL,
    dept_id    BIGINT  NOT NULL,
    post_id    BIGINT  NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    enabled    BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO sys_user_assignment (id, user_id, dept_id, post_id, is_primary, enabled) VALUES
    (1, 1, 2, 1, TRUE,  TRUE),   -- admin    主任职 技术部 / 总经理
    (2, 2, 3, 2, TRUE,  TRUE),   -- manager  主任职 产品部 / 产品经理
    (3, 2, 5, 4, FALSE, TRUE),   -- manager  兼任   财务部 / 财务总监
    (4, 3, 4, 5, TRUE,  TRUE);   -- zhangsan 主任职 人事行政部 / 人事专员
SELECT setval('sys_user_assignment_id_seq', (SELECT MAX(id) FROM sys_user_assignment));

CREATE TABLE sys_assignment_role (
    assignment_id BIGINT NOT NULL,
    role_id       BIGINT NOT NULL,
    PRIMARY KEY (assignment_id, role_id)
);

INSERT INTO sys_assignment_role (assignment_id, role_id) VALUES
    (1, 1),   -- admin 主任职 → ADMIN
    (2, 2),   -- manager 主任职 → DEPT_MANAGER
    (3, 4),   -- manager 兼任 → FINANCE
    (4, 3);   -- zhangsan 主任职 → EMPLOYEE

-- ------------------------------------------------------------
-- 8. 审批单：增加 dept_id / applicant_id，分布既有 5 条 + 新增 3 条
--    产品部(3) 3 条 PENDING / 财务部(5) 2 条 PENDING /
--    人事(4) 2 条(1 PENDING) / 技术部(2) 1 条
-- ------------------------------------------------------------
ALTER TABLE oa_approval
    ADD COLUMN dept_id      BIGINT,
    ADD COLUMN applicant_id BIGINT;

UPDATE oa_approval SET dept_id = 4, applicant_id = 3    WHERE id = 1;  -- 年假 张三   人事 PENDING
UPDATE oa_approval SET dept_id = 3, applicant_id = NULL WHERE id = 2;  -- 采购 王经理 产品 PENDING
UPDATE oa_approval SET dept_id = 4, applicant_id = 3    WHERE id = 3;  -- 报销 张三   人事 APPROVED
UPDATE oa_approval SET dept_id = 2, applicant_id = NULL WHERE id = 4;  -- 加班 王经理 技术 REJECTED
UPDATE oa_approval SET dept_id = 5, applicant_id = 3    WHERE id = 5;  -- 用章 张三   财务 PENDING

INSERT INTO oa_approval (title, type, applicant, status, reason, dept_id, applicant_id) VALUES
    ('会议室扩容申请',       'PURCHASE', '王经理',     'PENDING', '产品评审会议室不够用，申请增设一间',    3, NULL),
    ('产品部团建费用申请',   'EXPENSE',  '王经理',     'PENDING', 'Q3 团建预算 6000 元',                   3, NULL),
    ('财务系统维保付款申请', 'PURCHASE', '系统管理员', 'PENDING', '财务系统年度维保付款 35000 元',         5, 1);

CREATE INDEX idx_oa_approval_dept      ON oa_approval (dept_id);
CREATE INDEX idx_oa_approval_applicant ON oa_approval (applicant_id);
