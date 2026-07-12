-- ============================================================
-- OA Platform - V36 AI 助手 V2 批D：记忆 / 摘要游标 / 长期记忆 / RAG(pgvector) / 知识库
--   (docs/design/ai-assistant-design-v2.md §13.3/§13.4/§12.2/§17，附3 亮点⑤晨报)
--   ai_chat_session.summarized_until_message_id  结构化滚动摘要游标（§13.3）
--   ai_user_memory                               长期偏好记忆（§13.4，可查删；敏感黑名单在应用层拒存）
--   ai_knowledge_doc                             RAG 知识文档（§12.2；embedding 可空 → 无嵌入凭据走全文降级）
--
-- pgvector：docker-compose postgres 镜像换 pgvector/pgvector:pg17（数据卷兼容，需 `docker compose up -d` 重建容器）。
--   embedding 列不指定固定维度（不建向量索引）——DeepSeek 无 /embeddings，默认走 PostgreSQL 全文/ILIKE 降级；
--   仅当配置嵌入凭据（ai-assistant.rag.embedding-enabled=true）时才写入向量并按 <=> 余弦距离检索。
-- ============================================================

-- pgvector 扩展（缺失时本迁移失败 → 提示换镜像；oa 为 DB 超级用户，CREATE EXTENSION 可用）
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------- §13.3 结构化滚动摘要游标（summary 存 JSON：userGoal/activeEntities/resolvedReferences） ----------
ALTER TABLE ai_chat_session ADD COLUMN summarized_until_message_id BIGINT;

-- ---------- §13.4 长期记忆（EXPLICIT 显式记住 / INFERRED 推断；用户可查删，软删 status=DELETED） ----------
CREATE TABLE ai_user_memory (
    id                BIGSERIAL        PRIMARY KEY,
    tenant_id         VARCHAR(32)      NOT NULL DEFAULT 'default',
    user_id           BIGINT           NOT NULL,
    memory_type       VARCHAR(16)      NOT NULL DEFAULT 'EXPLICIT',  -- EXPLICIT | INFERRED
    memory_key        VARCHAR(128)     NOT NULL,
    memory_value      TEXT             NOT NULL,
    confidence        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    source_message_id BIGINT,
    expires_at        TIMESTAMPTZ,
    status            VARCHAR(16)      NOT NULL DEFAULT 'ACTIVE',    -- ACTIVE | DELETED
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ
);
CREATE INDEX idx_ai_memory_user ON ai_user_memory (tenant_id, user_id, status);

-- ---------- §12.2 RAG 知识文档（embedding 可空；检索带 module_code/status 过滤，命中以「参考资料」注入） ----------
CREATE TABLE ai_knowledge_doc (
    id          BIGSERIAL   PRIMARY KEY,
    tenant_id   VARCHAR(32) NOT NULL DEFAULT 'default',
    title       VARCHAR(128) NOT NULL,
    module_code VARCHAR(32),
    content     TEXT        NOT NULL,
    chunk_seq   INT         NOT NULL DEFAULT 0,
    embedding   vector,                                  -- 无固定维度：兼容任意嵌入模型；不建向量索引（降级默认全文）
    status      VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
    version     INT         NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ
);
CREATE INDEX idx_ai_knowledge_status ON ai_knowledge_doc (status, module_code);

-- 种子 3 篇（请假制度 / 公文办理流程 / 系统使用指南）——全文/ILIKE 降级可命中
INSERT INTO ai_knowledge_doc (title, module_code, content) VALUES
 ('请假制度', 'attendance',
  '员工请假分为年假、事假、病假、婚假、产假等类型。请假需在「请假管理」页面提交申请，填写请假类型、起止时间与事由，'
  || '经直属上级审批通过后生效。年假额度按工龄核定，可在助手中查询假期额度剩余。病假连续三天以上需附医疗证明。'
  || '请假申请提交后进入审批流程，可在「我的审批-我发起」中查看审批进度；审批通过前可撤回申请。'),
 ('公文办理流程', 'document',
  '公文分为收文与发文两类。收文办理流程为登记、拟办、批办、承办、传阅、归档；'
  || '发文办理流程为拟稿、核稿、会签、签发、用印、编号、分发、归档。发文需在「发文管理」拟稿，选择文种（通知/通报/请示/报告等）、'
  || '密级与紧急程度，经核稿与签发后加盖电子印章并自动编号。公文文号台账可在「公文台账」检索。'),
 ('系统使用指南', 'system',
  '星辰 OA 是一体化办公平台，包含工作台、审批流程、公文、会议、考勤、请假、出差、公告、日程等模块。'
  || '登录后在工作台可查看待办、日程与公告概览。左侧菜单进入各功能模块，也可用顶部搜索或智能助手快速导航。'
  || '智能助手支持查询待办、发起审批、预订会议、创建日程、出统计报表，并可介绍系统功能与操作方法。');
