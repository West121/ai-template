-- ============================================================
-- V43 数据权限高级化 · DP1a：多维可扩展框架
--   维度元数据(sys_data_dimension) + 基础数据(sys_cost_center/biz_project)
--   + 角色/用户维度授权配置表 + oa_approval 接入 costCenter/project 维度(端到端)
--   向后兼容红线：仅新增表/列 + 少量种子；现有 dept 维行为完全不变(未配业务维=不限)。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 维度元数据（配置化：改维度=改数据 + 对应 provider bean + 实体列）。内建 dept/self 不入表。
-- ------------------------------------------------------------
CREATE TABLE sys_data_dimension (
    code        VARCHAR(64)  PRIMARY KEY,
    label       VARCHAR(64)  NOT NULL,
    entity      VARCHAR(128),
    column_name VARCHAR(64),
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO sys_data_dimension (code, label, entity, column_name, enabled) VALUES
    ('costCenter', '成本中心', 'Approval', 'cost_center_id', TRUE),
    ('project',    '项目',     'Approval', 'project_id',     TRUE);

-- ------------------------------------------------------------
-- 2. 基础数据：成本中心 / 项目（CUSTOM 可选值来源）
-- ------------------------------------------------------------
CREATE TABLE sys_cost_center (
    id      BIGSERIAL PRIMARY KEY,
    code    VARCHAR(64) NOT NULL UNIQUE,
    name    VARCHAR(64) NOT NULL,
    enabled BOOLEAN     NOT NULL DEFAULT TRUE
);
INSERT INTO sys_cost_center (id, code, name) VALUES
    (1, 'CC-RD',  '研发成本中心'),
    (2, 'CC-MKT', '市场成本中心'),
    (3, 'CC-FIN', '财务成本中心');
SELECT setval('sys_cost_center_id_seq', (SELECT MAX(id) FROM sys_cost_center));

CREATE TABLE biz_project (
    id      BIGSERIAL PRIMARY KEY,
    code    VARCHAR(64)  NOT NULL UNIQUE,
    name    VARCHAR(128) NOT NULL,
    enabled BOOLEAN      NOT NULL DEFAULT TRUE
);
INSERT INTO biz_project (id, code, name) VALUES
    (1, 'PRJ-A', '阿尔法项目'),
    (2, 'PRJ-B', '贝塔项目'),
    (3, 'PRJ-C', '伽马项目');
SELECT setval('biz_project_id_seq', (SELECT MAX(id) FROM biz_project));

-- ------------------------------------------------------------
-- 3. 角色 / 用户 维度授权（scope=ALL 不限 / CUSTOM 仅 value 集内）；(principal, dimension) 唯一
-- ------------------------------------------------------------
CREATE TABLE sys_role_data_dimension (
    id        BIGSERIAL PRIMARY KEY,
    role_id   BIGINT      NOT NULL,
    dimension VARCHAR(64) NOT NULL,
    scope     VARCHAR(16) NOT NULL,
    CONSTRAINT uk_role_data_dim UNIQUE (role_id, dimension)
);
CREATE INDEX idx_role_data_dim_role ON sys_role_data_dimension (role_id);
CREATE TABLE sys_role_data_dimension_value (
    config_id BIGINT NOT NULL,
    value     BIGINT NOT NULL,
    PRIMARY KEY (config_id, value)
);

CREATE TABLE sys_user_data_dimension (
    id        BIGSERIAL PRIMARY KEY,
    user_id   BIGINT      NOT NULL,
    dimension VARCHAR(64) NOT NULL,
    scope     VARCHAR(16) NOT NULL,
    CONSTRAINT uk_user_data_dim UNIQUE (user_id, dimension)
);
CREATE INDEX idx_user_data_dim_user ON sys_user_data_dimension (user_id);
CREATE TABLE sys_user_data_dimension_value (
    config_id BIGINT NOT NULL,
    value     BIGINT NOT NULL,
    PRIMARY KEY (config_id, value)
);

-- ------------------------------------------------------------
-- 4. oa_approval 接入 costCenter / project 维度（端到端）：加列 + 索引化 IN + 少量种子
--    索引支撑「col IN (可见集)」走索引（§四 性能）。
-- ------------------------------------------------------------
ALTER TABLE oa_approval
    ADD COLUMN cost_center_id BIGINT,
    ADD COLUMN project_id     BIGINT;
CREATE INDEX idx_oa_approval_cost_center ON oa_approval (cost_center_id);
CREATE INDEX idx_oa_approval_project     ON oa_approval (project_id);

-- DP 测试种子：技术部(dept 2, admin ALL 可见)下 3 单，覆盖不同 costCenter/project，供多维过滤命中/不命中验证
INSERT INTO oa_approval (title, type, applicant, status, reason, dept_id, applicant_id, cost_center_id, project_id) VALUES
    ('DP维度-研发A采购', 'PURCHASE', '系统管理员', 'PENDING', '研发成本中心/阿尔法项目', 2, 1, 1, 1),
    ('DP维度-研发B报销', 'EXPENSE',  '系统管理员', 'PENDING', '研发成本中心/贝塔项目',   2, 1, 1, 2),
    ('DP维度-市场C用章', 'OTHER',    '系统管理员', 'PENDING', '市场成本中心/伽马项目',   2, 1, 2, 3);
