-- ============================================================
-- OA Platform - V20 中国式公文（发文/收文）高级化
--   契约：docs/design/gongwen-advanced.md 第 2 节。
--   1) oa_document 扩列（全部可空，兼容存量；GB/T 9704 版式项 + 流转态 + 用印/归档/流程关联）
--   2) 新表：文号规则/序号池/文号台账/红头模板/传阅单/办文意见
--   3) 种子：文号规则（六角括号）+ 一套示范红头模板
--   4) 权限码：office:doc:send/review/issue/seal/recv/assign/archive/number（授予 ADMIN，部分授予 DEPT_MANAGER）
--   仅 oa_*/sys_*；ddl-auto=validate 需与实体严格对齐。
-- ============================================================

-- ------------------------------------------------------------
-- 1. oa_document 扩列（ALTER ADD COLUMN，全部可空）
-- ------------------------------------------------------------
ALTER TABLE oa_document ADD COLUMN copy_no             VARCHAR(16);
ALTER TABLE oa_document ADD COLUMN issuer              VARCHAR(64);
ALTER TABLE oa_document ADD COLUMN issuing_org         VARCHAR(128);
ALTER TABLE oa_document ADD COLUMN doc_type            VARCHAR(16);
ALTER TABLE oa_document ADD COLUMN main_recipients     TEXT;
ALTER TABLE oa_document ADD COLUMN cc_recipients       TEXT;
ALTER TABLE oa_document ADD COLUMN attachments         TEXT;
ALTER TABLE oa_document ADD COLUMN annotation          VARCHAR(255);
ALTER TABLE oa_document ADD COLUMN template_id         BIGINT;
ALTER TABLE oa_document ADD COLUMN seal_status         VARCHAR(16);
ALTER TABLE oa_document ADD COLUMN sealed_by           VARCHAR(64);
ALTER TABLE oa_document ADD COLUMN sealed_at           TIMESTAMP;
ALTER TABLE oa_document ADD COLUMN process_instance_id VARCHAR(64);
ALTER TABLE oa_document ADD COLUMN archived            BOOLEAN;
ALTER TABLE oa_document ADD COLUMN archive_no          VARCHAR(64);
ALTER TABLE oa_document ADD COLUMN archived_at         TIMESTAMP;
ALTER TABLE oa_document ADD COLUMN secret_expire       DATE;

CREATE INDEX idx_document_proc_inst ON oa_document (process_instance_id);
CREATE INDEX idx_document_archived  ON oa_document (archived);

-- ------------------------------------------------------------
-- 2.1 文号规则
-- ------------------------------------------------------------
CREATE TABLE oa_doc_number_rule (
    id        BIGSERIAL    PRIMARY KEY,
    code      VARCHAR(64)  NOT NULL UNIQUE,     -- 规则编码
    name      VARCHAR(128) NOT NULL,
    org_code  VARCHAR(64)  NOT NULL,            -- 机关代字，如「星辰办」
    doc_type  VARCHAR(16),                      -- 文种；NULL = 通配
    pattern   VARCHAR(128) NOT NULL,            -- 如 '{org}〔{year}〕{seq}号'
    seq_scope VARCHAR(8)   NOT NULL DEFAULT 'YEAR', -- YEAR / MONTH / NONE
    seq_width INTEGER      NOT NULL DEFAULT 3,   -- 序号补零宽度
    enabled   BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- 2.2 序号池（占号防跳：rule_id+period 唯一，原子自增）
-- ------------------------------------------------------------
CREATE TABLE oa_doc_number_seq (
    id          BIGSERIAL   PRIMARY KEY,
    rule_id     BIGINT      NOT NULL,
    period      VARCHAR(16) NOT NULL,           -- 如 '2026' / '2026-07' / 'ALL'
    current_seq INTEGER     NOT NULL DEFAULT 0,
    version     BIGINT      NOT NULL DEFAULT 0, -- 乐观锁列（保留；占号走 ON CONFLICT 原子自增）
    CONSTRAINT uk_doc_number_seq UNIQUE (rule_id, period)
);

-- ------------------------------------------------------------
-- 2.3 文号台账/登记簿（正式占号落一行；作废只改状态不回收）
-- ------------------------------------------------------------
CREATE TABLE oa_doc_number_ledger (
    id          BIGSERIAL   PRIMARY KEY,
    doc_number  VARCHAR(64) NOT NULL UNIQUE,
    rule_id     BIGINT,
    document_id BIGINT,
    doc_title   VARCHAR(200),
    issued_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    issuer      VARCHAR(64),
    status      VARCHAR(16)  NOT NULL DEFAULT 'OCCUPIED'  -- OCCUPIED 占用 / VOID 作废
);
CREATE INDEX idx_doc_ledger_rule ON oa_doc_number_ledger (rule_id);
CREATE INDEX idx_doc_ledger_doc  ON oa_doc_number_ledger (document_id);

-- ------------------------------------------------------------
-- 2.4 红头/正文套版模板
-- ------------------------------------------------------------
CREATE TABLE oa_doc_template (
    id            BIGSERIAL    PRIMARY KEY,
    code          VARCHAR(64)  NOT NULL UNIQUE,
    name          VARCHAR(128) NOT NULL,
    type          VARCHAR(16)  NOT NULL DEFAULT 'FULL',  -- HEADER / BODY / FULL
    issuing_org   VARCHAR(128),                          -- 红头文字
    content       TEXT,                                  -- 含占位符的富文本（参考用；渲染以 render 端为准）
    seal_image_id BIGINT,                                -- 电子印章图片 file id
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- 2.5 传阅单（收文传阅，已阅回执）
-- ------------------------------------------------------------
CREATE TABLE oa_doc_circulation (
    id          BIGSERIAL   PRIMARY KEY,
    document_id BIGINT      NOT NULL,
    reader_id   BIGINT,
    reader_name VARCHAR(64),
    status      VARCHAR(16) NOT NULL DEFAULT 'PENDING',  -- PENDING / READ
    read_at     TIMESTAMP,
    opinion     VARCHAR(500),
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_doc_circulation_doc ON oa_doc_circulation (document_id);

-- ------------------------------------------------------------
-- 2.6 办文意见（全过程留痕，GB/T 处理签电子化）
-- ------------------------------------------------------------
CREATE TABLE oa_doc_opinion (
    id          BIGSERIAL   PRIMARY KEY,
    document_id BIGINT      NOT NULL,
    task_key    VARCHAR(32),                             -- 拟稿/核稿/签发/拟办/批办/承办/传阅/办结…
    user_id     BIGINT,
    user_name   VARCHAR(64),
    opinion     VARCHAR(1000),
    decision    VARCHAR(16),                             -- APPROVE 同意 / REJECT 退回 / TRANSFER 转办
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_doc_opinion_doc ON oa_doc_opinion (document_id);

-- ------------------------------------------------------------
-- 3. 种子：文号规则（六角括号）+ 示范红头模板
-- ------------------------------------------------------------
INSERT INTO oa_doc_number_rule (code, name, org_code, doc_type, pattern, seq_scope, seq_width, enabled) VALUES
    ('XCF', '星辰发文', '星辰发', NULL, '{org}〔{year}〕{seq}号', 'YEAR', 3, TRUE),
    ('XCB', '星辰办公室发文', '星辰办', NULL, '{org}〔{year}〕{seq}号', 'YEAR', 3, TRUE);

INSERT INTO oa_doc_template (code, name, type, issuing_org, content, seal_image_id, enabled) VALUES
    ('RED_HEADER_FULL', '星辰科技红头文件', 'FULL', '星辰科技有限公司文件',
     '红头正文套版：份号/密级/紧急 → 发文机关标志 → 发文字号(+上行文签发人) → 红反线 → 标题 → 主送 → 正文 → 成文日期(+印章) → 附注 → 版记。占位符见 gongwen-format-spec.md 第 9.1 节。',
     NULL, TRUE);

-- ------------------------------------------------------------
-- 4. 权限码（@PreAuthorize），授予 ADMIN(1) 全部；DEPT_MANAGER(2) 办文常用
-- ------------------------------------------------------------
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'office:doc:send',    '发文拟稿',   'BUTTON'),
    (0, 'office:doc:review',  '公文核稿',   'BUTTON'),
    (0, 'office:doc:issue',   '公文签发',   'BUTTON'),
    (0, 'office:doc:seal',    '公文用印',   'BUTTON'),
    (0, 'office:doc:recv',    '收文登记',   'BUTTON'),
    (0, 'office:doc:assign',  '收文拟办批办', 'BUTTON'),
    (0, 'office:doc:archive', '公文归档',   'BUTTON'),
    (0, 'office:doc:number',  '文号规则管理', 'BUTTON');

-- ADMIN 全部
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission
WHERE code IN ('office:doc:send','office:doc:review','office:doc:issue','office:doc:seal',
               'office:doc:recv','office:doc:assign','office:doc:archive','office:doc:number');

-- DEPT_MANAGER 办文常用（拟稿/核稿/签发/收文/拟办批办/归档），不含文号规则管理
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 2, id FROM sys_permission
WHERE code IN ('office:doc:send','office:doc:review','office:doc:issue',
               'office:doc:recv','office:doc:assign','office:doc:archive');
