-- ============================================================
-- OA Platform - V29 单据管理 BizDoc（契约 docs/design/bizdoc-design.md §2）
--   oa_bizdoc_def       单据定义（绑表单/编号规则/打印模板/可选审批流；submit_path=CODE 表单运行时发起路径）
--   oa_bizdoc           单据实例（表单数据 JSON；状态机 DRAFT→APPROVING→EFFECTIVE/REJECTED；VOID；乐观锁）
--   oa_bizdoc_print_tpl 可视化套打模板（§4 元素树 JSON，前端渲染）
--   权限码：bizdoc:def:write（定义管理）/ bizdoc:read / bizdoc:write
-- ============================================================

CREATE TABLE oa_bizdoc_def (
    id                   BIGSERIAL    PRIMARY KEY,
    code                 VARCHAR(64)  NOT NULL UNIQUE,
    name                 VARCHAR(128) NOT NULL,
    category             VARCHAR(64),
    icon                 VARCHAR(64),
    form_type            VARCHAR(16)  NOT NULL DEFAULT 'ONLINE',  -- ONLINE / CODE
    form_code            VARCHAR(64),
    submit_path          VARCHAR(255),                 -- CODE 表单运行时「新建」跳转路径（同公文 form_submit_path 口径）
    number_rule_id       BIGINT,                       -- 空=不占号（复用 oa_doc_number_rule）
    wf_def_code          VARCHAR(64),                  -- 空=纯台账（不走审批）
    list_config          TEXT,                         -- {columns:[{field,label,width?}], filters:[{field,label,type}]}
    default_print_tpl_id BIGINT,
    status               VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',   -- DRAFT / PUBLISHED / DISABLED
    remark               VARCHAR(255),
    created_by           BIGINT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ
);

CREATE TABLE oa_bizdoc (
    id                  BIGSERIAL    PRIMARY KEY,
    def_id              BIGINT       NOT NULL,
    def_code            VARCHAR(64)  NOT NULL,
    doc_no              VARCHAR(64),                   -- 单号（占号幂等；作废不回收）
    title               VARCHAR(200) NOT NULL,
    form_data           TEXT,                          -- 表单数据 JSON
    status              VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',   -- DRAFT/APPROVING/EFFECTIVE/REJECTED/VOID
    process_instance_id VARCHAR(64),
    creator_id          BIGINT,
    creator_name        VARCHAR(64),
    dept_id             BIGINT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ,
    version             BIGINT       NOT NULL DEFAULT 0          -- 乐观锁
);
CREATE INDEX idx_bizdoc_def ON oa_bizdoc (def_code, id DESC);
CREATE INDEX idx_bizdoc_proc ON oa_bizdoc (process_instance_id);

CREATE TABLE oa_bizdoc_print_tpl (
    id         BIGSERIAL    PRIMARY KEY,
    def_id     BIGINT       NOT NULL,
    name       VARCHAR(128) NOT NULL,
    paper      VARCHAR(8)   NOT NULL DEFAULT 'A4',    -- A4 / A5
    landscape  BOOLEAN      NOT NULL DEFAULT FALSE,
    content    TEXT,                                  -- §4 元素树 JSON（前端设计器/渲染器同源）
    is_default BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_bizdoc_tpl_def ON oa_bizdoc_print_tpl (def_id);

-- 权限码：ADMIN 全部；DEPT_MANAGER/EMPLOYEE/FINANCE 运行时读写（定义管理仅 ADMIN）
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'bizdoc:def:write', '单据定义管理', 'BUTTON'),
    (0, 'bizdoc:read',      '单据查询',     'BUTTON'),
    (0, 'bizdoc:write',     '单据录入',     'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code IN ('bizdoc:def:write', 'bizdoc:read', 'bizdoc:write');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.id IN (2, 3, 4) AND p.code IN ('bizdoc:read', 'bizdoc:write');
