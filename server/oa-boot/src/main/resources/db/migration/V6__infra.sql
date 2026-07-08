-- ============================================================
-- OA Platform - V6 基础设施域：文件 / 字典 / 登录日志 / 操作日志
--   + 权限种子（system:file:edit / system:dict:edit / system:log:list）
--   + 字典种子（leave_type / education / region 树形）
--   + 登录 / 操作日志历史示例
-- ============================================================

-- ------------------------------------------------------------
-- 1. 文件（存储可切换 LOCAL / MINIO / S3，file_hash 支撑秒传）
-- ------------------------------------------------------------
CREATE TABLE sys_file (
    id            BIGSERIAL PRIMARY KEY,
    original_name VARCHAR(255) NOT NULL,
    ext           VARCHAR(32),
    size          BIGINT       NOT NULL DEFAULT 0,
    content_type  VARCHAR(128),
    storage_type  VARCHAR(10)  NOT NULL,
    object_key    VARCHAR(255) NOT NULL,
    file_hash     VARCHAR(64),
    uploader_id   BIGINT,
    uploader_name VARCHAR(64),
    created_at    TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX idx_sys_file_hash ON sys_file (file_hash);
CREATE INDEX idx_sys_file_name ON sys_file (original_name);

-- ------------------------------------------------------------
-- 2. 字典：类型 + 树形字典项（parent_id = 0 为根）
-- ------------------------------------------------------------
CREATE TABLE sys_dict_type (
    id      BIGSERIAL PRIMARY KEY,
    code    VARCHAR(64)  NOT NULL UNIQUE,
    name    VARCHAR(64)  NOT NULL,
    remark  VARCHAR(255),
    enabled BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE sys_dict_item (
    id        BIGSERIAL PRIMARY KEY,
    type_id   BIGINT      NOT NULL,
    parent_id BIGINT      NOT NULL DEFAULT 0,
    label     VARCHAR(64) NOT NULL,
    value     VARCHAR(64) NOT NULL,
    sort      INTEGER     NOT NULL DEFAULT 0,
    enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
    remark    VARCHAR(255)
);
CREATE INDEX idx_dict_item_type ON sys_dict_item (type_id);

-- ------------------------------------------------------------
-- 3. 登录日志 / 操作日志
-- ------------------------------------------------------------
CREATE TABLE sys_login_log (
    id         BIGSERIAL PRIMARY KEY,
    username   VARCHAR(64),
    ip         VARCHAR(64),
    location   VARCHAR(64),          -- IP 归属地（ip2region v2 离线解析）
    user_agent VARCHAR(255),
    success    BOOLEAN      NOT NULL DEFAULT TRUE,
    message    VARCHAR(255),
    created_at TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_log_username ON sys_login_log (username);

CREATE TABLE sys_oper_log (
    id         BIGSERIAL PRIMARY KEY,
    username   VARCHAR(64),
    module     VARCHAR(64),
    action     VARCHAR(64),
    method     VARCHAR(128),
    params     VARCHAR(1000),
    status     VARCHAR(10),
    error_msg  VARCHAR(500),
    cost_ms    BIGINT,
    ip         VARCHAR(64),
    created_at TIMESTAMP   NOT NULL DEFAULT now()
);
CREATE INDEX idx_oper_log_module ON sys_oper_log (module);

-- ------------------------------------------------------------
-- 4. 权限种子：三个 BUTTON 权限
--    超管（ADMIN）代码级全量无需授权行；DEPT_MANAGER 不授权
-- ------------------------------------------------------------
INSERT INTO sys_permission (id, parent_id, code, name, type) VALUES
    (14, 0, 'system:file:edit', '文件维护', 'BUTTON'),
    (15, 0, 'system:dict:edit', '字典维护', 'BUTTON'),
    (16, 0, 'system:log:list',  '日志查询', 'BUTTON');
SELECT setval('sys_permission_id_seq', (SELECT MAX(id) FROM sys_permission));

-- ------------------------------------------------------------
-- 5. 字典种子
-- ------------------------------------------------------------
INSERT INTO sys_dict_type (id, code, name, remark, enabled) VALUES
    (1, 'leave_type', '请假类型', '审批/考勤模块请假类型', TRUE),
    (2, 'education',  '学历',     '人事档案学历选项',      TRUE),
    (3, 'region',     '行政区划', '树形字典示例（省>市>区）', TRUE);
SELECT setval('sys_dict_type_id_seq', (SELECT MAX(id) FROM sys_dict_type));

INSERT INTO sys_dict_item (id, type_id, parent_id, label, value, sort, enabled, remark) VALUES
    -- leave_type（平铺）
    (1,  1, 0, '年假', 'ANNUAL',   1, TRUE, NULL),
    (2,  1, 0, '事假', 'PERSONAL', 2, TRUE, NULL),
    (3,  1, 0, '病假', 'SICK',     3, TRUE, NULL),
    (4,  1, 0, '调休', 'COMP',     4, TRUE, NULL),
    -- education（平铺）
    (5,  2, 0, '专科', 'COLLEGE',  1, TRUE, NULL),
    (6,  2, 0, '本科', 'BACHELOR', 2, TRUE, NULL),
    (7,  2, 0, '硕士', 'MASTER',   3, TRUE, NULL),
    (8,  2, 0, '博士', 'DOCTOR',   4, TRUE, NULL),
    -- region（树形：省 > 市 > 区）
    (9,  3, 0,  '广东省', '440000', 1, TRUE, NULL),
    (10, 3, 9,  '广州市', '440100', 1, TRUE, NULL),
    (11, 3, 10, '天河区', '440106', 1, TRUE, NULL),
    (12, 3, 10, '越秀区', '440104', 2, TRUE, NULL),
    (13, 3, 9,  '深圳市', '440300', 2, TRUE, NULL),
    (14, 3, 13, '南山区', '440305', 1, TRUE, NULL),
    (15, 3, 0,  '浙江省', '330000', 2, TRUE, NULL),
    (16, 3, 15, '杭州市', '330100', 1, TRUE, NULL),
    (17, 3, 16, '西湖区', '330106', 1, TRUE, NULL);
SELECT setval('sys_dict_item_id_seq', (SELECT MAX(id) FROM sys_dict_item));

-- ------------------------------------------------------------
-- 6. 登录 / 操作日志历史示例
-- ------------------------------------------------------------
INSERT INTO sys_login_log (username, ip, location, user_agent, success, message, created_at) VALUES
    ('admin',    '192.168.1.10',   '内网',         'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0', TRUE,  '登录成功',       '2026-07-03 09:01:12'),
    ('manager',  '192.168.1.23',   '内网',         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/126.0',         TRUE,  '登录成功',       '2026-07-03 09:12:40'),
    ('zhangsan', '113.108.182.52', '广东省广州市', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1',        TRUE,  '登录成功',       '2026-07-04 08:55:03'),
    ('zhangsan', '113.108.182.52', '广东省广州市', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Safari/604.1',        FALSE, '用户名或密码错误', '2026-07-04 08:54:21'),
    ('lisi',     '10.20.30.40',    '内网',         'curl/8.6.0',                                                    FALSE, '用户名或密码错误', '2026-07-05 22:13:37');

INSERT INTO sys_oper_log (username, module, action, method, params, status, error_msg, cost_ms, ip, created_at) VALUES
    ('admin',   '用户', '创建',   'SysUserController.create',        '[{"username":"wangwu","name":"王五","deptId":2}]', 'SUCCESS', NULL,             86, '192.168.1.10', '2026-07-03 10:05:11'),
    ('admin',   '角色', '修改',   'SysRoleController.update',        '[3,{"code":"EMPLOYEE","name":"普通员工"}]',        'SUCCESS', NULL,             42, '192.168.1.10', '2026-07-03 10:18:02'),
    ('manager', '公告', '发布',   'AnnouncementController.create',   '[{"category":"NOTICE","title":"7 月例会安排"}]',   'SUCCESS', NULL,             65, '192.168.1.23', '2026-07-04 14:22:45'),
    ('manager', '审批', '同意',   'ApprovalController.approve',      '[3,{"comment":"同意"}]',                           'SUCCESS', NULL,             58, '192.168.1.23', '2026-07-04 15:40:19'),
    ('admin',   '部门', '删除',   'SysDeptController.delete',        '[9]',                                              'FAIL',    '部门下存在子部门，无法删除', 21, '192.168.1.10', '2026-07-05 11:02:56');
