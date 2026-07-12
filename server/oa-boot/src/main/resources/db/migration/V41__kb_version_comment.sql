-- ============================================================
-- 企业级 AI 知识库 · 批4a（版本历史 + 评论，不含 CRDT）
--   设计：docs/design/ai-knowledge-base.md §2（kb_doc_version / kb_comment）/ §5 权限 / §7 批4
--   本批新增两表：
--     kb_doc_version —— 保存正文（PUT /docs/{id}/content）与回滚时的正文快照，version 单调递增；
--     kb_comment     —— 文档评论/回复（parent_id 自引用建回复树，任意深度）。
--   editor_name / user_name 不入表（§2 只存 editor_id / user_id），读时经 KbNameResolver 解析。
--   CRDT（ydoc 实时协同）在批4b，本批不动 kb_doc_content.ydoc。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 版本历史（§2 kb_doc_version）—— 与 kb_doc 一对多（一篇文档多版）
--    version      快照对应的 kb_doc.version（保存/回滚后自增值；同文档内唯一）
--    content_json TipTap JSON 快照（后端只存不解析）
--    content_text 纯文本快照（供版本 diff / 查看渲染降级）
--    editor_id    本次保存/回滚的操作人；note：回滚版记 “回滚自 vX”，普通保存留空
-- ------------------------------------------------------------
CREATE TABLE kb_doc_version (
    id           BIGSERIAL   PRIMARY KEY,
    doc_id       BIGINT      NOT NULL,
    version      INT         NOT NULL,
    content_json TEXT,
    content_text TEXT,
    editor_id    BIGINT,
    note         VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_kb_doc_version UNIQUE (doc_id, version)
);
CREATE INDEX idx_kb_doc_version_doc ON kb_doc_version (doc_id, version DESC);

-- ------------------------------------------------------------
-- 2. 评论 / 回复（§2 kb_comment）—— parent_id 自引用（NULL = 根评论）
--    anchor：选区锚点（批4a 前端做文档级评论，先建列留空）
--    user_id：评论人（展示名读时解析）；content：评论正文（@提及仅文本 “@名字”，本批不结构化）
-- ------------------------------------------------------------
CREATE TABLE kb_comment (
    id         BIGSERIAL   PRIMARY KEY,
    doc_id     BIGINT      NOT NULL,
    parent_id  BIGINT,                                      -- NULL = 根评论
    user_id    BIGINT      NOT NULL,
    content    TEXT        NOT NULL,
    anchor     VARCHAR(500),                                -- 选区锚点，批4a 留空
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_comment_doc ON kb_comment (doc_id, created_at);

-- ------------------------------------------------------------
-- 3. 种子文档回填初始版本快照（v1）—— 让 V39 种子文档（DOC 节点）版本历史非空，
--    editor_id 取创建人，note 记 “初始版本”。content 直接取当前 kb_doc_content 快照。
-- ------------------------------------------------------------
INSERT INTO kb_doc_version (doc_id, version, content_json, content_text, editor_id, note, created_at)
SELECT d.id, d.version, c.content_json, c.content_text, d.creator_id, '初始版本', d.created_at
FROM kb_doc d
JOIN kb_doc_content c ON c.doc_id = d.id
WHERE d.type = 'DOC';
