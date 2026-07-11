-- ============================================================
-- OA Platform - V33 AI 助手 V2 批A：安全与协议核心（docs/design/ai-assistant-design-v2.md §7/§9/§14/§15）
--   ai_action_draft         写操作动作草稿持久化状态机（替换内存 confirm；TOCTOU/幂等键）
--   ai_chat_message_part    消息 Part 化（§9.3：text + 卡片 partType）
--   ai_tool_call            工具调用审计（名称/参数哈希+脱敏摘要/结果摘要/耗时/risk）
--   ai_conversation_state   会话工作状态（§14.5，批D 使用，先建表）
--   ai_chat_session/message 补 §14.1/§14.2 列（tenant_id 常量 'default' 预留；消息幂等唯一约束）
-- ============================================================

-- ---------- §7.2 动作草稿（状态机 PENDING_CONFIRM→CONFIRMED→EXECUTING→SUCCEEDED/FAILED + CANCELLED/EXPIRED） ----------
CREATE TABLE ai_action_draft (
    id                BIGSERIAL    PRIMARY KEY,
    tenant_id         VARCHAR(32)  NOT NULL DEFAULT 'default',
    user_id           BIGINT       NOT NULL,
    session_id        BIGINT,
    source_message_id BIGINT,
    tool_name         VARCHAR(64)  NOT NULL,
    action_type       VARCHAR(64),
    payload_json      TEXT         NOT NULL,
    payload_hash      VARCHAR(64)  NOT NULL,          -- SHA-256(payload_json)，确认时校验未被篡改
    target_type       VARCHAR(32),                    -- task/schedule/meeting/...（TOCTOU 预检类型）
    target_id         VARCHAR(128),
    target_version    VARCHAR(128),                   -- 任务类=stage 时 assignee 快照（变更→AI_ACTION_STALE）
    expected_status   VARCHAR(32),
    risk_level        VARCHAR(32)  NOT NULL DEFAULT 'CONFIRM_REQUIRED',
    status            VARCHAR(32)  NOT NULL DEFAULT 'PENDING_CONFIRM',
    idempotency_key   VARCHAR(128),                   -- 确认请求 Idempotency-Key（同键重放返回原结果）
    expires_at        TIMESTAMPTZ  NOT NULL,
    confirmed_at      TIMESTAMPTZ,
    executed_at       TIMESTAMPTZ,
    result_ref        TEXT,                           -- 执行结果 JSON（幂等重放返回）
    error_code        VARCHAR(64),
    error_message     TEXT,
    version           BIGINT       NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ
);
CREATE INDEX idx_ai_action_user ON ai_action_draft (tenant_id, user_id, status);
CREATE INDEX idx_ai_action_expire ON ai_action_draft (status, expires_at);

-- ---------- §14.3 消息 Part ----------
CREATE TABLE ai_chat_message_part (
    id             BIGSERIAL   PRIMARY KEY,
    message_id     BIGINT      NOT NULL,
    part_type      VARCHAR(32) NOT NULL,              -- text/navigate/form/confirm/list/chart/link/error...
    schema_version INT         NOT NULL DEFAULT 1,
    payload_json   TEXT        NOT NULL,
    sequence_no    INT         NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_part_message ON ai_chat_message_part (message_id, sequence_no);

-- ---------- §14.4 工具调用审计（敏感参数不落全文：哈希+截断摘要） ----------
CREATE TABLE ai_tool_call (
    id                BIGSERIAL    PRIMARY KEY,
    tenant_id         VARCHAR(32)  NOT NULL DEFAULT 'default',
    user_id           BIGINT,
    session_id        BIGINT,
    message_id        BIGINT,
    tool_call_id      VARCHAR(64),
    tool_name         VARCHAR(64)  NOT NULL,
    risk_level        VARCHAR(32)  NOT NULL DEFAULT 'READ_ONLY',   -- 批A 占位；批B @AiToolDefinition 落真值
    arguments_hash    VARCHAR(64),
    arguments_summary VARCHAR(512),
    result_summary    VARCHAR(512),
    status            VARCHAR(16)  NOT NULL,           -- SUCCEEDED / FAILED
    duration_ms       BIGINT,
    request_id        VARCHAR(64),
    trace_id          VARCHAR(64),
    error_code        VARCHAR(64),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);
CREATE INDEX idx_ai_tool_call_session ON ai_tool_call (session_id, id);

-- ---------- §14.5 会话工作状态（批D 使用，先建表占位） ----------
CREATE TABLE ai_conversation_state (
    session_id BIGINT      PRIMARY KEY,
    tenant_id  VARCHAR(32) NOT NULL DEFAULT 'default',
    user_id    BIGINT      NOT NULL,
    state_json TEXT,
    version    BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ
);

-- ---------- §14.1 会话补列（status=IDLE|RUNNING 会话串行化；version 乐观锁；tenant 预留） ----------
ALTER TABLE ai_chat_session ADD COLUMN tenant_id        VARCHAR(32) NOT NULL DEFAULT 'default';
ALTER TABLE ai_chat_session ADD COLUMN status           VARCHAR(16) NOT NULL DEFAULT 'IDLE';
ALTER TABLE ai_chat_session ADD COLUMN model_profile_id VARCHAR(64);
ALTER TABLE ai_chat_session ADD COLUMN summary_version  INT         NOT NULL DEFAULT 0;
ALTER TABLE ai_chat_session ADD COLUMN last_message_seq BIGINT      NOT NULL DEFAULT 0;
ALTER TABLE ai_chat_session ADD COLUMN version          BIGINT      NOT NULL DEFAULT 0;
ALTER TABLE ai_chat_session ADD COLUMN deleted_at       TIMESTAMPTZ;

-- ---------- §14.2 消息补列 + §15.1 幂等唯一约束 ----------
ALTER TABLE ai_chat_message ADD COLUMN tenant_id         VARCHAR(32) NOT NULL DEFAULT 'default';
ALTER TABLE ai_chat_message ADD COLUMN user_id           BIGINT;
ALTER TABLE ai_chat_message ADD COLUMN client_message_id VARCHAR(64);
ALTER TABLE ai_chat_message ADD COLUMN sequence_no       BIGINT;
ALTER TABLE ai_chat_message ADD COLUMN status            VARCHAR(16) NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE ai_chat_message ADD COLUMN input_tokens      INT;
ALTER TABLE ai_chat_message ADD COLUMN output_tokens     INT;
ALTER TABLE ai_chat_message ADD COLUMN request_id        VARCHAR(64);
ALTER TABLE ai_chat_message ADD COLUMN trace_id          VARCHAR(64);
ALTER TABLE ai_chat_message ADD COLUMN completed_at      TIMESTAMPTZ;

-- 存量回填：user_id 取会话属主；sequence_no 按会话内 id 序；会话 last_message_seq 取最大
UPDATE ai_chat_message m SET user_id = s.user_id FROM ai_chat_session s WHERE m.session_id = s.id;
UPDATE ai_chat_message m SET sequence_no = sub.rn
FROM (SELECT id, row_number() OVER (PARTITION BY session_id ORDER BY id) AS rn FROM ai_chat_message) sub
WHERE m.id = sub.id;
UPDATE ai_chat_session s SET last_message_seq = COALESCE(
    (SELECT max(m.sequence_no) FROM ai_chat_message m WHERE m.session_id = s.id), 0);

-- §15.1 消息幂等：网络重试同 clientMessageId 返回原消息，不重复调模型
CREATE UNIQUE INDEX uq_ai_msg_client ON ai_chat_message (tenant_id, user_id, client_message_id)
    WHERE client_message_id IS NOT NULL;
