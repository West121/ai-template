-- ============================================================
-- 企业级 AI 知识库 · 批2（检索 + AI 问答 + 相关推荐）
--   设计：docs/design/ai-knowledge-base.md §2/§3/§7 批2 / §8 红线
--   本批新增「分块向量」表：文档保存正文时把 content_text 分块，
--   有嵌入凭据写 embedding（vector），无凭据留空（NULL）→ 全文/ILIKE 降级。
--   语义检索（pgvector <=> 余弦）+ 全文混合排序、相关推荐、RAG 问答扩检索源均基于此表。
--   pgvector 扩展在 V36 已 CREATE EXTENSION（ai_knowledge_doc 同款）；此处仅建表。
-- ============================================================

-- ------------------------------------------------------------
-- kb_doc_embedding（§2）—— 与 kb_doc 一对多（一篇文档多块）
--   doc_id     所属文档（kb_doc.id；应用层级联删，无 FK 约束保持与其它 kb_* 一致）
--   chunk_seq  块序号（0 起）
--   chunk_text 分块纯文本（全文降级检索直接用；也作 RAG 注入片段来源）
--   embedding  vector（可空）：有嵌入凭据时写入；无则 NULL → 全文降级（不建向量索引，维度不固定）
--   updated_at 重建时间（保存正文触发全量重建：先删后插）
-- ------------------------------------------------------------
CREATE TABLE kb_doc_embedding (
    id         BIGSERIAL   PRIMARY KEY,
    doc_id     BIGINT      NOT NULL,
    chunk_seq  INT         NOT NULL DEFAULT 0,
    chunk_text TEXT        NOT NULL,
    embedding  vector,                                   -- 可空 → 无嵌入凭据走全文降级
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_doc_embedding_doc ON kb_doc_embedding (doc_id);
