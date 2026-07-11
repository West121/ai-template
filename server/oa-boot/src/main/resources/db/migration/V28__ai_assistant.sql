-- ============================================================
-- OA Platform - V28 AI 智能助手（契约 docs/design/ai-assistant-design.md §2）
--   ai_chat_session：会话（用户隔离；title=首问摘要；summary=滚动摘要）
--   ai_chat_message：消息（role USER|ASSISTANT|TOOL；cards=卡片 JSON；tool_calls=工具调用审计）
--   助手登录即用（无新权限码）；工具沿用各自模块权限码。
-- ============================================================

CREATE TABLE ai_chat_session (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    BIGINT       NOT NULL,
    title      VARCHAR(128),
    summary    TEXT,                          -- 滚动摘要（超窗异步 LLM 压缩）
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);
CREATE INDEX idx_ai_session_user ON ai_chat_session (user_id, updated_at DESC);

CREATE TABLE ai_chat_message (
    id         BIGSERIAL    PRIMARY KEY,
    session_id BIGINT       NOT NULL,
    role       VARCHAR(16)  NOT NULL,         -- USER / ASSISTANT / TOOL
    content    TEXT,
    cards      TEXT,                          -- Card[] JSON（§3 六类卡）
    tool_calls TEXT,                          -- 工具调用留痕 [{step,tool,args,result}]（审计）
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_message_session ON ai_chat_message (session_id, id);
