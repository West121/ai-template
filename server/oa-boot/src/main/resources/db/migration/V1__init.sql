-- ============================================================
-- OA Platform - V1 初始化：建表 + 种子数据（PostgreSQL 17）
-- ============================================================

-- 部门表
CREATE TABLE sys_dept (
    id        BIGSERIAL PRIMARY KEY,
    name      VARCHAR(64) NOT NULL,
    parent_id BIGINT,
    sort      INTEGER
);

-- 用户表
CREATE TABLE sys_user (
    id         BIGSERIAL PRIMARY KEY,
    username   VARCHAR(64)  NOT NULL UNIQUE,
    password   VARCHAR(255) NOT NULL,
    name       VARCHAR(64)  NOT NULL,
    dept       VARCHAR(64),
    post       VARCHAR(64),
    phone      VARCHAR(32),
    enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 审批单表
CREATE TABLE oa_approval (
    id         BIGSERIAL PRIMARY KEY,
    title      VARCHAR(128) NOT NULL,
    type       VARCHAR(32)  NOT NULL,
    applicant  VARCHAR(64)  NOT NULL,
    status     VARCHAR(32)  NOT NULL DEFAULT 'PENDING',
    reason     VARCHAR(512),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oa_approval_status ON oa_approval (status);

-- ------------------------------------------------------------
-- 种子数据
-- ------------------------------------------------------------

INSERT INTO sys_dept (name, parent_id, sort) VALUES
    ('星辰科技', NULL, 1),
    ('技术部',   1,    1),
    ('产品部',   1,    2),
    ('人事行政部', 1,  3);

-- 密码列为明文占位（admin123）。
-- 应用启动时 DataInitializer 会检测到非 BCrypt（不以 $2 开头）
-- 并用 BCryptPasswordEncoder.encode 回写，保证登录一定可用。
INSERT INTO sys_user (username, password, name, dept, post, phone, enabled) VALUES
    ('admin',    'admin123', '系统管理员', '技术部',     '平台管理员', '13800000001', TRUE),
    ('manager',  'admin123', '王经理',     '产品部',     '部门经理',   '13800000002', TRUE),
    ('zhangsan', 'admin123', '张三',       '人事行政部', '人事专员',   '13800000003', TRUE);

INSERT INTO oa_approval (title, type, applicant, status, reason) VALUES
    ('年假申请：5 天',       'LEAVE',       '张三',   'PENDING',  '春节回家探亲，申请 2 月 9 日至 13 日年假'),
    ('采购申请：显示器 x4',  'PURCHASE',    '王经理', 'PENDING',  '产品部新增工位，需采购 27 寸显示器 4 台'),
    ('报销申请：差旅费',     'EXPENSE',     '张三',   'APPROVED', '上海出差 3 天，交通住宿共计 2860 元'),
    ('加班申请：版本发布',   'OVERTIME',    '王经理', 'REJECTED', '周末发布 2.0 版本，申请周六加班'),
    ('用章申请：合同盖章',   'SEAL',        '张三',   'PENDING',  '与供应商签署年度框架合同，需加盖公章');
