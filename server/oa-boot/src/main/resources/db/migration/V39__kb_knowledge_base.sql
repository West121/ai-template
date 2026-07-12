-- ============================================================
-- 企业级 AI 知识库 · 批1（知识组织 + 文档基础）
--   设计：docs/design/ai-knowledge-base.md §2 数据模型 / §5 权限 / §7 批1
--   本批仅「知识组织 + 文档基础」：空间 / 成员 / 目录树 / 文档正文 / 标签。
--   表前缀 kb_。AI/检索/协作在批2-4（kb_doc_content.ydoc、kb_doc.summary 先建列留空）。
--   批D 的 ai_knowledge_doc（RAG）本批不动；两者种子内容互相呼应（请假制度等）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 知识空间（§2 kb_space）
--    visibility：PUBLIC 全员可见 / INTERNAL 登录可见 / PRIVATE 仅成员（§5 红线）
-- ------------------------------------------------------------
CREATE TABLE kb_space (
    id          BIGSERIAL    PRIMARY KEY,
    tenant_id   VARCHAR(32)  NOT NULL DEFAULT 'default',
    name        VARCHAR(128) NOT NULL,
    code        VARCHAR(64)  NOT NULL UNIQUE,
    description VARCHAR(500),
    icon        VARCHAR(64),
    visibility  VARCHAR(16)  NOT NULL DEFAULT 'INTERNAL',   -- PUBLIC | INTERNAL | PRIVATE
    owner_id    BIGINT,
    sort        INT          NOT NULL DEFAULT 0,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',     -- ACTIVE | ARCHIVED
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ
);
CREATE INDEX idx_kb_space_visibility ON kb_space (visibility, status);
CREATE INDEX idx_kb_space_owner ON kb_space (owner_id);

-- ------------------------------------------------------------
-- 2. 空间成员权限（§2 kb_space_member）—— 空间级 RBAC
--    principal_type：USER 用户 / DEPT 部门 / ROLE 角色（与 sys_* 主键对应）
--    role：VIEWER 只读 / EDITOR 可编 / ADMIN 管理
-- ------------------------------------------------------------
CREATE TABLE kb_space_member (
    id             BIGSERIAL   PRIMARY KEY,
    space_id       BIGINT      NOT NULL,
    principal_type VARCHAR(8)  NOT NULL,                    -- USER | DEPT | ROLE
    principal_id   BIGINT      NOT NULL,
    role           VARCHAR(8)  NOT NULL DEFAULT 'VIEWER',   -- VIEWER | EDITOR | ADMIN
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_kb_space_member UNIQUE (space_id, principal_type, principal_id)
);
CREATE INDEX idx_kb_space_member_space ON kb_space_member (space_id);
CREATE INDEX idx_kb_space_member_principal ON kb_space_member (principal_type, principal_id);

-- ------------------------------------------------------------
-- 3. 文档 / 目录节点（§2 kb_doc）—— 树：parent_id 自引用
--    type：FOLDER 目录 / DOC 文档
--    summary：AI 摘要（批3 填，先留空）
--    status：DRAFT 草稿 / PUBLISHED 已发布 / ARCHIVED 已归档
--    version：文档版本号（保存正文时自增；版本历史表在批4）
-- ------------------------------------------------------------
CREATE TABLE kb_doc (
    id         BIGSERIAL    PRIMARY KEY,
    space_id   BIGINT       NOT NULL,
    parent_id  BIGINT,                                      -- NULL = 空间根节点
    type       VARCHAR(8)   NOT NULL,                       -- FOLDER | DOC
    title      VARCHAR(200) NOT NULL,
    sort       INT          NOT NULL DEFAULT 0,
    summary    VARCHAR(1000),                               -- AI 摘要，批3 填
    status     VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',       -- DRAFT | PUBLISHED | ARCHIVED
    creator_id BIGINT,
    updater_id BIGINT,
    version    INT          NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);
CREATE INDEX idx_kb_doc_space_parent ON kb_doc (space_id, parent_id);

-- ------------------------------------------------------------
-- 4. 文档正文（§2 kb_doc_content）—— 与 kb_doc 1:1（PK=doc_id）
--    content_json：TipTap JSON（后端只存不解析，当 text 存）
--    content_text：纯文本（供批2 检索/嵌入抽取，前端保存时附带）
--    ydoc：Yjs 二进制文档状态（CRDT 批4 用，先建列留空）
-- ------------------------------------------------------------
CREATE TABLE kb_doc_content (
    doc_id       BIGINT      PRIMARY KEY,
    content_json TEXT,
    content_text TEXT,
    ydoc         BYTEA,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 5. 标签（§2 kb_tag + kb_doc_tag）—— 手动打标；AI 自动标签在批3
-- ------------------------------------------------------------
CREATE TABLE kb_tag (
    id         BIGSERIAL   PRIMARY KEY,
    tenant_id  VARCHAR(32) NOT NULL DEFAULT 'default',
    name       VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_kb_tag UNIQUE (tenant_id, name)
);

CREATE TABLE kb_doc_tag (
    doc_id BIGINT NOT NULL,
    tag_id BIGINT NOT NULL,
    PRIMARY KEY (doc_id, tag_id)
);
CREATE INDEX idx_kb_doc_tag_tag ON kb_doc_tag (tag_id);

-- ------------------------------------------------------------
-- 6. 功能权限码（§5）—— ADMIN(1) 全部（超管代码级已含全部，显式授权与既有迁移一致）；
--    DEPT_MANAGER(2)/EMPLOYEE(3)/FINANCE(4) 同样授予（细粒度以「空间可见性+成员角色」为准，服务层强制）。
-- ------------------------------------------------------------
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'kb:space:view',   '知识空间查看', 'MENU'),
    (0, 'kb:space:manage', '知识空间管理', 'BUTTON'),
    (0, 'kb:doc:view',     '知识文档查看', 'BUTTON'),
    (0, 'kb:doc:edit',     '知识文档编辑', 'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code IN ('kb:space:view', 'kb:space:manage', 'kb:doc:view', 'kb:doc:edit');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r, sys_permission p
WHERE r.id IN (2, 3, 4) AND p.code IN ('kb:space:view', 'kb:space:manage', 'kb:doc:view', 'kb:doc:edit');

-- ------------------------------------------------------------
-- 7. 种子：演示空间 + 文档（与 ai_knowledge_doc 种子内容呼应）
--    空间 1「公司制度库」PUBLIC（全员可见）；空间 2「产品团队空间」INTERNAL（登录可见）。
-- ------------------------------------------------------------
INSERT INTO kb_space (id, name, code, description, icon, visibility, owner_id, sort, status) VALUES
    (1, '公司制度库', 'policy',  '公司规章制度与办事流程，全员可查阅。', 'BookOpen', 'PUBLIC',   1, 1, 'ACTIVE'),
    (2, '产品团队空间', 'product', '产品团队内部知识沉淀，登录可见、成员可编。', 'Boxes',    'INTERNAL', 2, 2, 'ACTIVE');
SELECT setval('kb_space_id_seq', (SELECT MAX(id) FROM kb_space));

-- 空间 2 成员：manager(用户2) 为 ADMIN；产品部(部门3) 全员 VIEWER
INSERT INTO kb_space_member (id, space_id, principal_type, principal_id, role) VALUES
    (1, 2, 'USER', 2, 'ADMIN'),
    (2, 2, 'DEPT', 3, 'VIEWER');
SELECT setval('kb_space_member_id_seq', (SELECT MAX(id) FROM kb_space_member));

-- 空间 1 目录树：规章制度(目录) → 请假制度 / 公文办理流程；系统使用指南(根文档)
INSERT INTO kb_doc (id, space_id, parent_id, type, title, sort, status, creator_id, updater_id, version) VALUES
    (1, 1, NULL, 'FOLDER', '规章制度',     1, 'PUBLISHED', 1, 1, 1),
    (2, 1, 1,    'DOC',    '请假制度',     1, 'PUBLISHED', 1, 1, 1),
    (3, 1, 1,    'DOC',    '公文办理流程', 2, 'PUBLISHED', 1, 1, 1),
    (4, 1, NULL, 'DOC',    '系统使用指南', 2, 'PUBLISHED', 1, 1, 1);
SELECT setval('kb_doc_id_seq', (SELECT MAX(id) FROM kb_doc));

INSERT INTO kb_doc_content (doc_id, content_json, content_text) VALUES
    (2,
     '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"员工请假分为年假、事假、病假、婚假、产假等类型。请假需在「请假管理」页面提交申请，填写请假类型、起止时间与事由，经直属上级审批通过后生效。年假额度按工龄核定，病假连续三天以上需附医疗证明。"}]}]}',
     '员工请假分为年假、事假、病假、婚假、产假等类型。请假需在「请假管理」页面提交申请，填写请假类型、起止时间与事由，经直属上级审批通过后生效。年假额度按工龄核定，病假连续三天以上需附医疗证明。'),
    (3,
     '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"公文分为收文与发文两类。收文办理流程为登记、拟办、批办、承办、传阅、归档；发文办理流程为拟稿、核稿、会签、签发、用印、编号、分发、归档。"}]}]}',
     '公文分为收文与发文两类。收文办理流程为登记、拟办、批办、承办、传阅、归档；发文办理流程为拟稿、核稿、会签、签发、用印、编号、分发、归档。'),
    (4,
     '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"星辰 OA 是一体化办公平台，包含工作台、审批流程、公文、会议、考勤、请假、出差、公告、日程等模块。登录后在工作台可查看待办、日程与公告概览。"}]}]}',
     '星辰 OA 是一体化办公平台，包含工作台、审批流程、公文、会议、考勤、请假、出差、公告、日程等模块。登录后在工作台可查看待办、日程与公告概览。');

INSERT INTO kb_tag (id, name) VALUES
    (1, '制度'),
    (2, '流程');
SELECT setval('kb_tag_id_seq', (SELECT MAX(id) FROM kb_tag));

INSERT INTO kb_doc_tag (doc_id, tag_id) VALUES
    (2, 1),
    (3, 2);
