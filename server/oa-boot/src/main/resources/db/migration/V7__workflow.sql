-- ============================================================
-- OA Platform - V7 工作流平台业务扩展表（Flowable 内嵌，ACT_* 由引擎自管不进 Flyway）
--   业务扩展表：表单定义 / 流程定义档案 / 实例扩展 / 操作审计 / 抄送 / 委托规则 / 印章 / 站内通知
--   风格对齐 V1-V6：BIGSERIAL 主键、timestamptz 时间列
-- ============================================================

-- 表单定义（自研，版本化；code+version 唯一，PUBLISHED 不可改，改=新版本 draft）
CREATE TABLE wf_form_def (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    version     INTEGER      NOT NULL DEFAULT 1,
    schema_json TEXT         NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',   -- DRAFT / PUBLISHED / DISABLED
    remark      VARCHAR(255),
    created_by  BIGINT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uk_wf_form_def_code_ver UNIQUE (code, version)
);

-- 流程定义档案（一条/def_code；引擎负责流程版本，本表存设计器原稿与元数据）
CREATE TABLE wf_process_ext (
    id                   BIGSERIAL PRIMARY KEY,
    def_code             VARCHAR(64)  NOT NULL UNIQUE,
    name                 VARCHAR(128) NOT NULL,
    category             VARCHAR(64),
    icon                 VARCHAR(64),
    form_code            VARCHAR(64),
    form_version         INTEGER,
    designer_type        VARCHAR(20)  NOT NULL DEFAULT 'DINGTALK',  -- BPMN / DINGTALK
    designer_json        TEXT,
    bpmn_xml             TEXT,
    latest_deployment_id VARCHAR(64),
    process_definition_id VARCHAR(128),
    status               VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',      -- DRAFT / PUBLISHED / DISABLED
    remark               VARCHAR(255),
    created_by           BIGINT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 实例扩展（标题 / 表单快照 / 业务状态）
CREATE TABLE wf_instance_ext (
    id                   BIGSERIAL PRIMARY KEY,
    proc_inst_id         VARCHAR(64)  NOT NULL UNIQUE,
    def_code             VARCHAR(64)  NOT NULL,
    def_name             VARCHAR(128),
    title                VARCHAR(255) NOT NULL,
    initiator_id         BIGINT,
    initiator_name       VARCHAR(64),
    initiator_dept_id    BIGINT,
    form_code            VARCHAR(64),
    form_version         INTEGER,
    form_schema_snapshot TEXT,
    form_data_json       TEXT,
    biz_status           VARCHAR(20)  NOT NULL DEFAULT 'RUNNING',    -- RUNNING/APPROVED/REJECTED/CANCELED/TERMINATED
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ended_at             TIMESTAMPTZ
);
CREATE INDEX idx_wf_instance_initiator ON wf_instance_ext (initiator_id);
CREATE INDEX idx_wf_instance_status    ON wf_instance_ext (biz_status);

-- 业务动作审计（加签/转办/驳回/撤销… 引擎历史不含这些语义）
CREATE TABLE wf_operation (
    id           BIGSERIAL PRIMARY KEY,
    proc_inst_id VARCHAR(64) NOT NULL,
    task_id      VARCHAR(64),
    node_id      VARCHAR(64),
    node_name    VARCHAR(128),
    actor_id     BIGINT,
    actor_name   VARCHAR(64),
    action       VARCHAR(32) NOT NULL,       -- SUBMIT/APPROVE/REJECT/CANCEL/RESUBMIT/CC...
    detail_json  TEXT,
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wf_operation_inst ON wf_operation (proc_inst_id);

-- 抄送（同实例同人去重）
CREATE TABLE wf_cc (
    id           BIGSERIAL PRIMARY KEY,
    proc_inst_id VARCHAR(64) NOT NULL,
    node_id      VARCHAR(64),
    user_id      BIGINT      NOT NULL,
    read_flag    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_wf_cc_inst_user UNIQUE (proc_inst_id, user_id)
);
CREATE INDEX idx_wf_cc_user ON wf_cc (user_id);

-- 委托规则（P2 使用，P1 建表）
CREATE TABLE wf_delegate_rule (
    id             BIGSERIAL PRIMARY KEY,
    owner_id       BIGINT      NOT NULL,
    delegate_to_id BIGINT      NOT NULL,
    def_code       VARCHAR(64),                -- NULL = 全部流程
    start_date     DATE,
    end_date       DATE,
    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 电子章（P3 使用，P1 建表）
CREATE TABLE wf_seal (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(64) NOT NULL,
    image_file_id BIGINT,
    enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 站内通知收件箱
CREATE TABLE wf_notify (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT      NOT NULL,
    type         VARCHAR(20) NOT NULL,        -- TODO / RESULT / URGE / CC
    title        VARCHAR(255) NOT NULL,
    content      TEXT,
    proc_inst_id VARCHAR(64),
    read_flag    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wf_notify_user ON wf_notify (user_id, read_flag);

-- ------------------------------------------------------------
-- 种子：请假表单定义（PUBLISHED）+ 请假审批流程档案（DINGTALK，待启动时发布部署）
-- ------------------------------------------------------------
INSERT INTO wf_form_def (code, name, version, schema_json, status, remark, created_by) VALUES
    ('leave', '请假申请单', 1,
     '{"widgets":[{"key":"leaveType","label":"请假类型","type":"select","required":true,"options":[{"label":"年假","value":"ANNUAL"},{"label":"事假","value":"PERSONAL"},{"label":"病假","value":"SICK"}]},{"key":"startDate","label":"开始日期","type":"date","required":true},{"key":"endDate","label":"结束日期","type":"date","required":true},{"key":"days","label":"请假天数","type":"number","required":true},{"key":"reason","label":"请假事由","type":"textarea","required":true}]}',
     'PUBLISHED', '内置请假申请单', 1);

-- 请假审批：发起 → 部门经理(LEADER level1, ANY) → 条件(天数>3 → 总经理 admin, 否则跳过) → 抄送 zhangsan(hr) → 结束
-- 该 designer_json 由 WorkflowInitializer 启动时转换为 BPMN 并部署到引擎
INSERT INTO wf_process_ext (def_code, name, category, icon, form_code, form_version, designer_type, designer_json, status, created_by) VALUES
    ('leave_approval', '请假审批', '人事', 'leave', 'leave', 1, 'DINGTALK',
     '{"nodes":[{"id":"mgr","type":"approval","name":"部门经理审批","assigneeRules":[{"type":"LEADER","level":1}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"},{"id":"cond","type":"condition","name":"天数判断","branches":[{"id":"b_gt3","name":"天数大于3","conditions":[{"field":"days","operator":">","value":3}],"steps":[{"id":"gm","type":"approval","name":"总经理审批","assigneeRules":[{"type":"ORG","refs":[{"kind":"USER","username":"admin"}]}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"}]},{"id":"b_default","name":"默认","default":true,"steps":[]}]},{"id":"cc1","type":"cc","name":"抄送人事","users":[{"username":"zhangsan"}]}]}',
     'DRAFT', 1);

-- 请假发起人(张三/人事行政部)的部门经理设为王经理(manager,id=2)，使 LEADER level1 解析出与总经理(admin)不同的审批人
UPDATE sys_dept SET leader_id = 2 WHERE name = '人事行政部';

-- ------------------------------------------------------------
-- 权限点：工作流定义管理（wf:def:edit）授予 ADMIN
-- ------------------------------------------------------------
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'workflow',      '流程中心',   'MENU'),
    (0, 'wf:def:edit',   '流程定义管理', 'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code IN ('workflow', 'wf:def:edit');
