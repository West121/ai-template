-- ============================================================
-- OA Platform - V4 用户企业级档案扩展（增量迁移，不清库）
-- sys_user 新增：工号 / 邮箱 / 性别 / 生日 / 入职日期 / 办公地点 /
--               直属上级 / 头像 / 备注
-- ============================================================

ALTER TABLE sys_user ADD COLUMN emp_no          VARCHAR(32);
ALTER TABLE sys_user ADD COLUMN email           VARCHAR(128);
ALTER TABLE sys_user ADD COLUMN gender          VARCHAR(10) DEFAULT 'UNKNOWN';
ALTER TABLE sys_user ADD COLUMN birthday        DATE;
ALTER TABLE sys_user ADD COLUMN hire_date       DATE;
ALTER TABLE sys_user ADD COLUMN office_location VARCHAR(64);
ALTER TABLE sys_user ADD COLUMN leader_id       BIGINT;
ALTER TABLE sys_user ADD COLUMN avatar          VARCHAR(255);
ALTER TABLE sys_user ADD COLUMN remark          VARCHAR(255);

-- 存量数据性别兜底为 UNKNOWN
UPDATE sys_user SET gender = 'UNKNOWN' WHERE gender IS NULL;

-- ------------------------------------------------------------
-- 种子用户档案补全
-- ------------------------------------------------------------

UPDATE sys_user SET
    emp_no          = 'XC0001',
    email           = 'admin@xingchen.com',
    gender          = 'MALE',
    birthday        = DATE '1986-03-12',
    hire_date       = DATE '2020-06-01',
    office_location = 'A 座 12F-01',
    leader_id       = NULL,
    remark          = '平台超级管理员，负责系统运维与账号管理'
WHERE username = 'admin';

UPDATE sys_user SET
    emp_no          = 'XC0002',
    email           = 'manager@xingchen.com',
    gender          = 'MALE',
    birthday        = DATE '1988-11-05',
    hire_date       = DATE '2021-03-15',
    office_location = 'A 座 11F-06',
    leader_id       = (SELECT u.id FROM sys_user u WHERE u.username = 'admin'),
    remark          = '产品部负责人，主管产品规划与团队管理'
WHERE username = 'manager';

UPDATE sys_user SET
    emp_no          = 'XC0003',
    email           = 'zhangsan@xingchen.com',
    gender          = 'FEMALE',
    birthday        = DATE '1995-07-23',
    hire_date       = DATE '2023-04-10',
    office_location = 'B 座 3F-16',
    leader_id       = (SELECT u.id FROM sys_user u WHERE u.username = 'admin'),
    remark          = '人事专员，负责入职办理与考勤管理'
WHERE username = 'zhangsan';

-- 工号唯一约束（种子回填后再加，避免历史数据冲突）
ALTER TABLE sys_user ADD CONSTRAINT uk_sys_user_emp_no UNIQUE (emp_no);
