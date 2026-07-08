-- ============================================================
-- OA Platform - V3 办公业务域：审批扩展 / 公文 / 会议 / 考勤 /
--   请假 / 出差 / 公告 / 日程 + 权限码 + 中文种子数据（2026-07）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 审批单扩展：起止日期
-- ------------------------------------------------------------
ALTER TABLE oa_approval
    ADD COLUMN start_date DATE,
    ADD COLUMN end_date   DATE;

-- ------------------------------------------------------------
-- 2. 审批操作日志
-- ------------------------------------------------------------
CREATE TABLE oa_approval_log (
    id          BIGSERIAL PRIMARY KEY,
    approval_id BIGINT       NOT NULL,
    actor_id    BIGINT,
    actor_name  VARCHAR(64),
    action      VARCHAR(16)  NOT NULL,
    comment     VARCHAR(512),
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_approval_log_approval ON oa_approval_log (approval_id);
CREATE INDEX idx_approval_log_actor    ON oa_approval_log (actor_id, action);

-- ------------------------------------------------------------
-- 3. 审批抄送
-- ------------------------------------------------------------
CREATE TABLE oa_approval_cc (
    id          BIGSERIAL PRIMARY KEY,
    approval_id BIGINT  NOT NULL,
    user_id     BIGINT  NOT NULL,
    read_flag   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_approval_cc_user ON oa_approval_cc (user_id);

-- ------------------------------------------------------------
-- 4. 公文
-- ------------------------------------------------------------
CREATE TABLE oa_document (
    id         BIGSERIAL PRIMARY KEY,
    direction  VARCHAR(8)   NOT NULL,           -- RECEIVE / SEND
    code       VARCHAR(64)  NOT NULL,
    title      VARCHAR(200) NOT NULL,
    unit       VARCHAR(128),                    -- 来文 / 主送单位
    secret     VARCHAR(16)  NOT NULL,           -- PUBLIC / INTERNAL / SECRET
    urgency    VARCHAR(16)  NOT NULL,           -- NORMAL / URGENT / EXTRA
    status     VARCHAR(16)  NOT NULL,
    drafter    VARCHAR(64),
    signer     VARCHAR(64),
    content    TEXT,
    doc_date   DATE,
    dept_id    BIGINT,
    creator_id BIGINT,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_document_direction ON oa_document (direction, status);

-- ------------------------------------------------------------
-- 5. 会议室 / 会议预订
-- ------------------------------------------------------------
CREATE TABLE oa_meeting_room (
    id       BIGSERIAL PRIMARY KEY,
    name     VARCHAR(64) NOT NULL,
    floor    VARCHAR(16),
    capacity INTEGER,
    devices  VARCHAR(255),                      -- 逗号分隔
    status   VARCHAR(16) NOT NULL DEFAULT 'FREE'  -- FREE / MAINTAIN（BUSY 运行时计算）
);

CREATE TABLE oa_meeting (
    id           BIGSERIAL PRIMARY KEY,
    room_id      BIGINT       NOT NULL,
    subject      VARCHAR(128) NOT NULL,
    meeting_date DATE         NOT NULL,
    start_hour   INTEGER      NOT NULL,
    end_hour     INTEGER      NOT NULL,
    organizer    VARCHAR(64),
    organizer_id BIGINT,
    attendee_ids VARCHAR(255) NOT NULL DEFAULT '',  -- 逗号分隔用户 id
    status       VARCHAR(16)  NOT NULL DEFAULT 'BOOKED', -- BOOKED / CANCELED
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_meeting_room_date ON oa_meeting (room_id, meeting_date);

-- ------------------------------------------------------------
-- 6. 考勤
-- ------------------------------------------------------------
CREATE TABLE oa_attendance_record (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL,
    record_date DATE        NOT NULL,
    check_in    TIME,
    check_out   TIME,
    hours       DOUBLE PRECISION,
    status      VARCHAR(16) NOT NULL,           -- NORMAL / LATE / EARLY / ABSENT / REST
    CONSTRAINT uk_attendance_user_date UNIQUE (user_id, record_date)
);

-- ------------------------------------------------------------
-- 7. 请假 / 假期额度 / 出差
-- ------------------------------------------------------------
CREATE TABLE oa_leave (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL,
    applicant  VARCHAR(64),
    dept_id    BIGINT,
    type       VARCHAR(16) NOT NULL,            -- ANNUAL / PERSONAL / SICK / COMP
    start_date DATE,
    end_date   DATE,
    days       DOUBLE PRECISION,
    reason     VARCHAR(512),
    status     VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_leave_user ON oa_leave (user_id);
CREATE INDEX idx_leave_dept ON oa_leave (dept_id);

CREATE TABLE oa_leave_quota (
    id      BIGSERIAL PRIMARY KEY,
    user_id BIGINT           NOT NULL,
    type    VARCHAR(16)      NOT NULL,
    total   DOUBLE PRECISION NOT NULL,
    used    DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX idx_leave_quota_user ON oa_leave_quota (user_id);

CREATE TABLE oa_trip (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    applicant   VARCHAR(64),
    dept_id     BIGINT,
    destination VARCHAR(128) NOT NULL,
    start_date  DATE,
    end_date    DATE,
    transport   VARCHAR(16),                    -- TRAIN / FLIGHT / CAR
    budget      DOUBLE PRECISION,
    reason      VARCHAR(512),
    status      VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_trip_user ON oa_trip (user_id);
CREATE INDEX idx_trip_dept ON oa_trip (dept_id);

-- ------------------------------------------------------------
-- 8. 公告 / 公告已读
-- ------------------------------------------------------------
CREATE TABLE oa_announcement (
    id           BIGSERIAL PRIMARY KEY,
    category     VARCHAR(16)  NOT NULL,         -- NOTICE / RULE / NEWS
    title        VARCHAR(200) NOT NULL,
    content      TEXT,
    publisher    VARCHAR(64),
    publisher_id BIGINT,
    dept_id      BIGINT,
    top          BOOLEAN      NOT NULL DEFAULT FALSE,
    reads        INTEGER      NOT NULL DEFAULT 0,
    publish_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oa_announcement_read (
    id              BIGSERIAL PRIMARY KEY,
    announcement_id BIGINT NOT NULL,
    user_id         BIGINT NOT NULL,
    CONSTRAINT uk_announcement_read UNIQUE (announcement_id, user_id)
);

-- ------------------------------------------------------------
-- 9. 日程
-- ------------------------------------------------------------
CREATE TABLE oa_schedule (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT       NOT NULL,
    title         VARCHAR(128) NOT NULL,
    schedule_date DATE         NOT NULL,
    start_time    VARCHAR(5),                   -- 如 14:00
    end_time      VARCHAR(5),
    place         VARCHAR(128),
    type          VARCHAR(16)  NOT NULL         -- MEETING / REVIEW / TRIP / TRAINING / OTHER
);
CREATE INDEX idx_schedule_user_date ON oa_schedule (user_id, schedule_date);

-- ------------------------------------------------------------
-- 10. 新权限码与角色授权（契约「新增权限码与角色授权」）
--     ADMIN=全部；DEPT_MANAGER + document:list/edit + announcement:publish；
--     EMPLOYEE / FINANCE + document:list
-- ------------------------------------------------------------
INSERT INTO sys_permission (id, parent_id, code, name, type) VALUES
    (7,  0, 'office:document:list',        '公文查询', 'MENU'),
    (8,  0, 'office:document:edit',        '公文维护', 'BUTTON'),
    (9,  0, 'office:announcement:publish', '公告发布', 'BUTTON'),
    (10, 0, 'system:dept:edit',            '部门维护', 'BUTTON'),
    (11, 0, 'system:post:edit',            '岗位维护', 'BUTTON'),
    (12, 0, 'system:user:edit',            '用户维护', 'BUTTON'),
    (13, 0, 'system:role:edit',            '角色维护', 'BUTTON');
SELECT setval('sys_permission_id_seq', (SELECT MAX(id) FROM sys_permission));

INSERT INTO sys_role_permission (role_id, permission_id) VALUES
    -- ADMIN 全部
    (1, 7), (1, 8), (1, 9), (1, 10), (1, 11), (1, 12), (1, 13),
    -- DEPT_MANAGER
    (2, 7), (2, 8), (2, 9),
    -- EMPLOYEE
    (3, 7),
    -- FINANCE
    (4, 7);

-- ------------------------------------------------------------
-- 11. 既有审批单补数据：起止日期 + 王经理 applicant_id
-- ------------------------------------------------------------
UPDATE oa_approval SET applicant_id = 2 WHERE applicant = '王经理' AND applicant_id IS NULL;

UPDATE oa_approval SET start_date = '2026-07-13', end_date = '2026-07-17' WHERE id = 1;
UPDATE oa_approval SET start_date = '2026-07-08', end_date = '2026-07-10' WHERE id = 2;
UPDATE oa_approval SET start_date = '2026-06-10', end_date = '2026-06-12' WHERE id = 3;
UPDATE oa_approval SET start_date = '2026-06-13', end_date = '2026-06-14' WHERE id = 4;
UPDATE oa_approval SET start_date = '2026-07-07', end_date = '2026-07-07' WHERE id = 5;
UPDATE oa_approval SET start_date = '2026-07-10', end_date = '2026-07-31' WHERE id = 6;
UPDATE oa_approval SET start_date = '2026-07-18', end_date = '2026-07-19' WHERE id = 7;
UPDATE oa_approval SET start_date = '2026-07-08', end_date = '2026-07-08' WHERE id = 8;

-- 新增 4 条近一周已办结审批（丰富工作台周统计 / 已办列表），id 顺延 9~12
INSERT INTO oa_approval (title, type, applicant, status, reason, dept_id, applicant_id, start_date, end_date, created_at) VALUES
    ('病假申请：1 天',           'LEAVE',    '张三',   'APPROVED', '感冒发烧，就医休息一天',           4, 3, '2026-07-02', '2026-07-02', '2026-07-01 09:12:00'),
    ('差旅申请：北京客户回访',   'TRIP',     '王经理', 'APPROVED', '回访北京重点客户，洽谈续约事宜',   3, 2, '2026-07-09', '2026-07-11', '2026-07-02 10:05:00'),
    ('报销申请：招聘渠道费用',   'EXPENSE',  '张三',   'REJECTED', '6 月招聘渠道服务费 3200 元',       4, 3, '2026-06-28', '2026-06-28', '2026-07-03 14:30:00'),
    ('加班申请：月末结算',       'OVERTIME', '王经理', 'APPROVED', '财务月末结算需周末加班半天',       5, 2, '2026-07-04', '2026-07-05', '2026-07-03 16:40:00');

-- 抄送张三 2 条
INSERT INTO oa_approval_cc (approval_id, user_id, read_flag) VALUES
    (6, 3, FALSE),
    (8, 3, TRUE);

-- 每条审批一条 CREATE 日志 + 已办结单据的 APPROVE / REJECT 日志（近 7 天）
INSERT INTO oa_approval_log (approval_id, actor_id, actor_name, action, comment, created_at) VALUES
    (1,  3, '张三',       'CREATE',  NULL, '2026-07-04 09:10:00'),
    (2,  2, '王经理',     'CREATE',  NULL, '2026-07-03 15:20:00'),
    (3,  3, '张三',       'CREATE',  NULL, '2026-06-29 10:00:00'),
    (4,  2, '王经理',     'CREATE',  NULL, '2026-06-30 09:30:00'),
    (5,  3, '张三',       'CREATE',  NULL, '2026-07-06 11:20:00'),
    (6,  2, '王经理',     'CREATE',  NULL, '2026-07-05 14:00:00'),
    (7,  2, '王经理',     'CREATE',  NULL, '2026-07-06 16:30:00'),
    (8,  1, '系统管理员', 'CREATE',  NULL, '2026-07-06 17:10:00'),
    (9,  3, '张三',       'CREATE',  NULL, '2026-07-01 09:12:00'),
    (10, 2, '王经理',     'CREATE',  NULL, '2026-07-02 10:05:00'),
    (11, 3, '张三',       'CREATE',  NULL, '2026-07-03 14:30:00'),
    (12, 2, '王经理',     'CREATE',  NULL, '2026-07-03 16:40:00'),
    (3,  2, '王经理',     'APPROVE', '费用合理，同意报销',               '2026-07-01 10:20:00'),
    (4,  1, '系统管理员', 'REJECT',  '版本已延期，无需周末加班',         '2026-07-02 11:00:00'),
    (9,  1, '系统管理员', 'APPROVE', '注意休息，尽快康复',               '2026-07-01 11:30:00'),
    (10, 1, '系统管理员', 'APPROVE', '同意，注意控制差旅成本',           '2026-07-03 09:40:00'),
    (11, 2, '王经理',     'REJECT',  '发票不齐，请补充后重新提交',       '2026-07-04 10:15:00'),
    (12, 2, '王经理',     'APPROVE', '月末结算需要，同意加班',           '2026-07-06 09:20:00');

-- ------------------------------------------------------------
-- 12. 会议室 + 会议预订种子（围绕 2026-07-07 / 07-08）
-- ------------------------------------------------------------
INSERT INTO oa_meeting_room (id, name, floor, capacity, devices, status) VALUES
    (1, '星河', '3F', 8,  '投屏,白板,视频会议',          'FREE'),
    (2, '云汉', '3F', 12, '投屏,白板',                   'FREE'),
    (3, '曜石', '4F', 6,  '白板',                        'FREE'),
    (4, '听涛', '4F', 20, '投屏,音响,视频会议',          'MAINTAIN'),
    (5, '望岳', '5F', 4,  '投屏',                        'FREE'),
    (6, '凌云', '7F', 30, '投屏,音响,LED大屏,视频会议',  'FREE');
SELECT setval('oa_meeting_room_id_seq', (SELECT MAX(id) FROM oa_meeting_room));

INSERT INTO oa_meeting (room_id, subject, meeting_date, start_hour, end_hour, organizer, organizer_id, attendee_ids, status) VALUES
    (1, '产品晨会',         '2026-07-07', 9,  10, '王经理',     2, '3',   'BOOKED'),
    (2, 'Q3 需求评审会',    '2026-07-07', 14, 16, '王经理',     2, '1,3', 'BOOKED'),
    (3, '人事招聘面试',     '2026-07-07', 10, 12, '张三',       3, '',    'BOOKED'),
    (5, '周度经营复盘',     '2026-07-07', 16, 17, '系统管理员', 1, '2',   'BOOKED'),
    (6, '全员大会彩排',     '2026-07-07', 15, 17, '系统管理员', 1, '2,3', 'CANCELED'),
    (1, '客户产品演示',     '2026-07-08', 10, 11, '王经理',     2, '',    'BOOKED'),
    (2, '迭代规划会',       '2026-07-08', 9,  11, '系统管理员', 1, '2,3', 'BOOKED'),
    (3, '面试复盘',         '2026-07-06', 15, 16, '张三',       3, '',    'BOOKED');

-- ------------------------------------------------------------
-- 13. 公文种子：收文 6 条 + 发文 5 条
-- ------------------------------------------------------------
INSERT INTO oa_document (direction, code, title, unit, secret, urgency, status, drafter, signer, content, doc_date, dept_id, creator_id) VALUES
    ('RECEIVE', '沪科协〔2026〕18号', '关于开展 2026 年度高新技术企业认定申报的通知',       '市科学技术协会',           'INTERNAL', 'NORMAL', 'TO_SIGN',    NULL, NULL, '请符合条件的企业于 7 月 31 日前完成线上申报。',       '2026-07-03', 2, 1),
    ('RECEIVE', '数管函〔2026〕7号',  '关于报送 2026 年上半年信息化项目验收材料的函',       '市大数据管理局',           'PUBLIC',   'URGENT', 'PROCESSING', NULL, NULL, '请于 7 月 15 日前报送项目验收材料。',                 '2026-07-01', 2, 1),
    ('RECEIVE', '人社发〔2026〕23号', '关于调整社会保险缴费基数的通知',                     '市人力资源和社会保障局',   'PUBLIC',   'NORMAL', 'FINISHED',   NULL, NULL, '自 2026 年 7 月起执行新的社保缴费基数标准。',         '2026-06-20', 4, 3),
    ('RECEIVE', '税函〔2026〕41号',   '关于开展企业所得税汇算清缴自查的通知',               '区税务局',                 'INTERNAL', 'EXTRA',  'TO_SIGN',    NULL, NULL, '请于 7 月 20 日前完成自查并报送自查报告。',           '2026-07-06', 5, 2),
    ('RECEIVE', '园管发〔2026〕33号', '关于园区消防安全专项检查的通知',                     '高新区园区管委会',         'PUBLIC',   'URGENT', 'PROCESSING', NULL, NULL, '7 月中旬开展消防安全专项检查，请提前自查整改。',       '2026-07-02', 4, 3),
    ('RECEIVE', '云启函〔2026〕9号',  '关于联合举办产品创新大赛的商函',                     '云启互联科技有限公司',     'SECRET',   'NORMAL', 'FINISHED',   NULL, NULL, '拟联合举办产品创新大赛，请贵司确认合作意向。',         '2026-06-25', 3, 2),
    ('SEND',    '星发〔2026〕1号',    '关于印发《员工考勤与休假管理办法（2026 修订版）》的通知', '各部门',              'INTERNAL', 'NORMAL', 'PUBLISHED',  '张三',       '系统管理员', '新版考勤与休假管理办法自 7 月 1 日起施行。',   '2026-06-15', 4, 3),
    ('SEND',    '星发〔2026〕2号',    '关于 2026 年年中总结会议安排的通知',                 '各部门',                   'PUBLIC',   'NORMAL', 'ISSUED',     '王经理',     '系统管理员', '年中总结会议定于 7 月 17 日召开，请做好准备。', '2026-06-30', 3, 2),
    ('SEND',    '星发〔2026〕3号',    '关于加强研发代码与数据安全管理的通知',               '技术部、产品部',           'SECRET',   'URGENT', 'REVIEWING',  '系统管理员', NULL,         '进一步规范代码仓库权限与数据出境审批流程。',   '2026-07-04', 2, 1),
    ('SEND',    '星发〔2026〕4号',    '关于开展三季度供应商对账工作的函',                   '财务部',                   'INTERNAL', 'NORMAL', 'DRAFT',      '王经理',     NULL,         '请各供应商配合完成三季度对账工作。',           '2026-07-06', 5, 2),
    ('SEND',    '星发〔2026〕5号',    '关于组织 7 月消防疏散演练的通知',                     '各部门',                   'PUBLIC',   'URGENT', 'DRAFT',      '张三',       NULL,         '定于 7 月 16 日下午组织全员消防疏散演练。',     '2026-07-06', 4, 3);

-- ------------------------------------------------------------
-- 14. 考勤种子：manager(2) / zhangsan(3)，2026-06-08 ~ 2026-07-07
--     周末 REST，穿插 LATE / EARLY / ABSENT；07-07 仅签到未签退
-- ------------------------------------------------------------
INSERT INTO oa_attendance_record (user_id, record_date, check_in, check_out, hours, status) VALUES
    -- ===== 王经理 (user_id = 2) =====
    (2, '2026-06-08', '08:52', '18:10', 9.3, 'NORMAL'),
    (2, '2026-06-09', '08:47', '18:03', 9.3, 'NORMAL'),
    (2, '2026-06-10', '08:55', '18:22', 9.5, 'NORMAL'),
    (2, '2026-06-11', '09:12', '18:20', 9.1, 'LATE'),
    (2, '2026-06-12', '08:41', '18:05', 9.4, 'NORMAL'),
    (2, '2026-06-13', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-06-14', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-06-15', '08:50', '18:15', 9.4, 'NORMAL'),
    (2, '2026-06-16', '08:44', '18:02', 9.3, 'NORMAL'),
    (2, '2026-06-17', '08:57', '18:30', 9.6, 'NORMAL'),
    (2, '2026-06-18', NULL,    NULL,    NULL, 'ABSENT'),
    (2, '2026-06-19', '08:49', '18:08', 9.3, 'NORMAL'),
    (2, '2026-06-20', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-06-21', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-06-22', '08:53', '18:12', 9.3, 'NORMAL'),
    (2, '2026-06-23', '08:46', '18:06', 9.3, 'NORMAL'),
    (2, '2026-06-24', '09:26', '18:45', 9.3, 'LATE'),
    (2, '2026-06-25', '08:51', '18:18', 9.5, 'NORMAL'),
    (2, '2026-06-26', '08:39', '18:01', 9.4, 'NORMAL'),
    (2, '2026-06-27', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-06-28', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-06-29', '08:48', '18:09', 9.4, 'NORMAL'),
    (2, '2026-06-30', '08:47', '17:05', 8.3, 'EARLY'),
    (2, '2026-07-01', '08:54', '18:20', 9.4, 'NORMAL'),
    (2, '2026-07-02', '08:42', '18:03', 9.4, 'NORMAL'),
    (2, '2026-07-03', '08:56', '18:35', 9.7, 'NORMAL'),
    (2, '2026-07-04', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-07-05', NULL,    NULL,    NULL, 'REST'),
    (2, '2026-07-06', '09:15', '18:30', 9.3, 'LATE'),
    (2, '2026-07-07', '09:02', NULL,    NULL, 'LATE'),
    -- ===== 张三 (user_id = 3) =====
    (3, '2026-06-08', '08:38', '18:02', 9.4, 'NORMAL'),
    (3, '2026-06-09', '08:45', '18:06', 9.4, 'NORMAL'),
    (3, '2026-06-10', '08:51', '18:11', 9.3, 'NORMAL'),
    (3, '2026-06-11', '08:43', '18:00', 9.3, 'NORMAL'),
    (3, '2026-06-12', '08:49', '18:07', 9.3, 'NORMAL'),
    (3, '2026-06-13', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-06-14', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-06-15', '08:46', '18:04', 9.3, 'NORMAL'),
    (3, '2026-06-16', '09:08', '18:12', 9.1, 'LATE'),
    (3, '2026-06-17', '08:40', '18:01', 9.4, 'NORMAL'),
    (3, '2026-06-18', '08:52', '18:15', 9.4, 'NORMAL'),
    (3, '2026-06-19', '08:41', '16:58', 8.3, 'EARLY'),
    (3, '2026-06-20', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-06-21', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-06-22', '08:47', '18:05', 9.3, 'NORMAL'),
    (3, '2026-06-23', '08:53', '18:10', 9.3, 'NORMAL'),
    (3, '2026-06-24', '08:44', '18:02', 9.3, 'NORMAL'),
    (3, '2026-06-25', NULL,    NULL,    NULL, 'ABSENT'),
    (3, '2026-06-26', '08:50', '18:08', 9.3, 'NORMAL'),
    (3, '2026-06-27', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-06-28', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-06-29', '08:42', '18:03', 9.4, 'NORMAL'),
    (3, '2026-06-30', '08:48', '18:12', 9.4, 'NORMAL'),
    (3, '2026-07-01', '08:39', '18:00', 9.4, 'NORMAL'),
    (3, '2026-07-02', '09:21', '18:26', 9.1, 'LATE'),
    (3, '2026-07-03', '08:45', '18:05', 9.3, 'NORMAL'),
    (3, '2026-07-04', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-07-05', NULL,    NULL,    NULL, 'REST'),
    (3, '2026-07-06', '08:51', '18:14', 9.4, 'NORMAL'),
    (3, '2026-07-07', '08:52', NULL,    NULL, 'NORMAL');

-- ------------------------------------------------------------
-- 15. 假期额度（三个用户）
-- ------------------------------------------------------------
INSERT INTO oa_leave_quota (user_id, type, total, used) VALUES
    (1, 'ANNUAL', 10, 5), (1, 'COMP', 4, 2), (1, 'SICK', 15, 1),
    (2, 'ANNUAL', 10, 5), (2, 'COMP', 4, 2), (2, 'SICK', 15, 1),
    (3, 'ANNUAL', 10, 5), (3, 'COMP', 4, 2), (3, 'SICK', 15, 1);

-- ------------------------------------------------------------
-- 16. 请假 6 条 / 出差 5 条
-- ------------------------------------------------------------
INSERT INTO oa_leave (user_id, applicant, dept_id, type, start_date, end_date, days, reason, status, created_at) VALUES
    (3, '张三',       4, 'ANNUAL',   '2026-07-15', '2026-07-17', 3, '暑期回乡探亲',                 'PENDING',   '2026-07-05 10:20:00'),
    (3, '张三',       4, 'SICK',     '2026-06-23', '2026-06-23', 1, '感冒发烧，就医休息',           'APPROVED',  '2026-06-22 16:40:00'),
    (2, '王经理',     3, 'ANNUAL',   '2026-07-20', '2026-07-24', 5, '年假出行，工作已交接',         'PENDING',   '2026-07-06 09:30:00'),
    (2, '王经理',     3, 'COMP',     '2026-06-12', '2026-06-12', 1, '版本发布周末加班调休',         'APPROVED',  '2026-06-10 11:00:00'),
    (1, '系统管理员', 2, 'PERSONAL', '2026-07-10', '2026-07-10', 1, '办理个人证件',                 'REJECTED',  '2026-07-06 15:10:00'),
    (3, '张三',       4, 'PERSONAL', '2026-06-05', '2026-06-05', 1, '家中临时有事，后已协调解决',   'WITHDRAWN', '2026-06-04 09:50:00');

INSERT INTO oa_trip (user_id, applicant, dept_id, destination, start_date, end_date, transport, budget, reason, status, created_at) VALUES
    (2, '王经理',     3, '上海', '2026-07-09', '2026-07-11', 'FLIGHT', 4500, '重点客户回访与需求调研',   'PENDING',  '2026-07-02 10:05:00'),
    (3, '张三',       4, '杭州', '2026-07-14', '2026-07-15', 'TRAIN',  1800, '高校校园招聘宣讲',         'PENDING',  '2026-07-06 14:20:00'),
    (1, '系统管理员', 2, '深圳', '2026-06-17', '2026-06-19', 'FLIGHT', 5200, '参加技术架构大会',         'APPROVED', '2026-06-11 09:00:00'),
    (2, '王经理',     5, '北京', '2026-06-24', '2026-06-25', 'TRAIN',  2100, '供应商年中对账',           'APPROVED', '2026-06-20 15:30:00'),
    (3, '张三',       4, '成都', '2026-07-21', '2026-07-23', 'FLIGHT', 3800, '分公司人事制度宣导',       'REJECTED', '2026-07-03 11:40:00');

-- ------------------------------------------------------------
-- 17. 公告 8 条（3 分类、2 置顶）+ 已读记录
-- ------------------------------------------------------------
INSERT INTO oa_announcement (id, category, title, content, publisher, publisher_id, dept_id, top, reads, publish_at) VALUES
    (1, 'NOTICE', '关于开展 7 月消防疏散演练的通知',                 '定于 7 月 16 日（周四）15:00 组织全员消防疏散演练，请各部门提前熟悉逃生路线，演练期间请勿乘坐电梯。', '张三',       3, 4, TRUE,  46,  '2026-07-06 10:00:00'),
    (2, 'NOTICE', '2026 年年中总结会议安排的通知',                   '年中总结会议定于 7 月 17 日（周五）9:30 在凌云会议厅召开，请各部门负责人准备年中述职材料。',           '系统管理员', 1, 1, TRUE,  82,  '2026-06-30 09:00:00'),
    (3, 'RULE',   '《员工考勤与休假管理办法（2026 修订版）》发布',   '新版办法自 7 月 1 日起施行：工作日 9:00 前签到，18:00 后签退；年假、调休申请统一走线上审批流程。',     '张三',       3, 4, FALSE, 120, '2026-06-16 09:30:00'),
    (4, 'RULE',   '研发代码与数据安全管理规定（试行）',               '代码仓库权限按最小化原则分配，生产数据导出须经部门负责人与安全负责人双重审批。',                     '系统管理员', 1, 2, FALSE, 64,  '2026-06-24 14:00:00'),
    (5, 'NEWS',   '公司荣获「2026 年度高新区优秀创新企业」称号',     '凭借在智能办公领域的持续创新，公司获评高新区优秀创新企业，感谢全体同事的努力！',                     '系统管理员', 1, 1, FALSE, 156, '2026-06-19 17:00:00'),
    (6, 'NEWS',   '产品 2.0 版本正式发布上线',                       '历经三个月迭代，产品 2.0 版本已于 7 月 1 日正式上线，新增智能审批与移动端打卡能力。',                 '王经理',     2, 3, FALSE, 98,  '2026-07-01 11:00:00'),
    (7, 'NOTICE', '7 月员工生日会报名开启',                          '7 月员工生日会将于 7 月 24 日 16:00 在听涛会议室举行，请 7 月生日的同事至行政处报名。',               '张三',       3, 4, FALSE, 37,  '2026-07-03 16:00:00'),
    (8, 'RULE',   '会议室使用与预订规范',                            '会议室实行线上预订制，先订先得；会后请及时带走个人物品并恢复桌椅摆放，遇冲突以系统预订记录为准。',   '张三',       3, 4, FALSE, 51,  '2026-06-27 10:30:00');
SELECT setval('oa_announcement_id_seq', (SELECT MAX(id) FROM oa_announcement));

INSERT INTO oa_announcement_read (announcement_id, user_id) VALUES
    (1, 3), (2, 3), (3, 3), (5, 3),
    (2, 2), (3, 2), (6, 2),
    (1, 1), (2, 1), (4, 1), (5, 1), (6, 1);

-- ------------------------------------------------------------
-- 18. 日程种子：manager(2) 7 月 8 条（07-07 三条）
-- ------------------------------------------------------------
INSERT INTO oa_schedule (user_id, title, schedule_date, start_time, end_time, place, type) VALUES
    (2, '产品晨会',           '2026-07-07', '09:00', '09:30', '星河会议室', 'MEETING'),
    (2, 'Q3 需求评审',        '2026-07-07', '14:00', '16:00', '云汉会议室', 'REVIEW'),
    (2, '新人转正面谈',       '2026-07-07', '17:00', '17:30', '洽谈室',     'OTHER'),
    (2, '客户产品演示',       '2026-07-08', '10:00', '11:00', '星河会议室', 'MEETING'),
    (2, '上海客户回访出差',   '2026-07-09', '08:00', '20:00', '上海',       'TRIP'),
    (2, '月度经营分析会',     '2026-07-13', '10:00', '12:00', '凌云会议室', 'MEETING'),
    (2, 'B 端产品设计培训',   '2026-07-16', '14:00', '17:00', '线上',       'TRAINING'),
    (2, '原型走查',           '2026-07-21', '15:00', '16:00', '曜石会议室', 'REVIEW');
