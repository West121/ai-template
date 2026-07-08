-- ============================================================
-- OA Platform - V5 部门企业级档案扩展（增量迁移，不清库）
-- sys_dept 新增：编码 / 负责人 / 启用状态 / 创建时间
-- ============================================================

ALTER TABLE sys_dept ADD COLUMN code       VARCHAR(32);
ALTER TABLE sys_dept ADD COLUMN leader_id  BIGINT;
ALTER TABLE sys_dept ADD COLUMN enabled    BOOLEAN   NOT NULL DEFAULT TRUE;
ALTER TABLE sys_dept ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- 种子部门档案补全（负责人：1=admin 系统管理员，2=manager 王经理，3=zhangsan 张三）
-- ------------------------------------------------------------

UPDATE sys_dept SET
    code       = 'XC-ROOT',
    leader_id  = NULL,
    created_at = TIMESTAMP '2024-01-02 09:00:00'
WHERE name = '星辰科技';

UPDATE sys_dept SET
    code       = 'XC-TECH',
    leader_id  = (SELECT u.id FROM sys_user u WHERE u.username = 'admin'),
    created_at = TIMESTAMP '2024-02-19 10:30:00'
WHERE name = '技术部';

UPDATE sys_dept SET
    code       = 'XC-PROD',
    leader_id  = (SELECT u.id FROM sys_user u WHERE u.username = 'manager'),
    created_at = TIMESTAMP '2024-04-08 14:00:00'
WHERE name = '产品部';

UPDATE sys_dept SET
    code       = 'XC-FIN',
    leader_id  = NULL,
    created_at = TIMESTAMP '2024-06-17 09:20:00'
WHERE name = '财务部';

UPDATE sys_dept SET
    code       = 'XC-HR',
    leader_id  = (SELECT u.id FROM sys_user u WHERE u.username = 'zhangsan'),
    created_at = TIMESTAMP '2024-09-05 11:00:00'
WHERE name = '人事行政部';

-- 编码唯一约束（种子回填后再加，避免历史数据冲突）
ALTER TABLE sys_dept ADD CONSTRAINT uk_sys_dept_code UNIQUE (code);
