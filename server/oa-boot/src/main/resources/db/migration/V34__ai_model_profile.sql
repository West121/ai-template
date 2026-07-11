-- ============================================================
-- OA Platform - V34 AI 助手 V2 批B：模型档案（ai-assistant-design-v2.md §4.3）
--   ai_model_profile：modelProfileId（FAST/STANDARD/REASONING/VISION）→ orch_credential 映射。
--   用户/前端只见档案 code，真实凭据（baseUrl/apiKey）永不出 API；ChatModel 按档案构造并缓存。
--   种子：现有最新启用 LLM 凭据 → STANDARD/FAST（无凭据时 credential_id 为空 → available=false）。
-- ============================================================

CREATE TABLE ai_model_profile (
    id             BIGSERIAL    PRIMARY KEY,
    code           VARCHAR(32)  NOT NULL UNIQUE,   -- FAST / STANDARD / REASONING / VISION（可扩展）
    name           VARCHAR(64)  NOT NULL,
    description    VARCHAR(255),
    credential_id  BIGINT,                          -- → orch_credential(LLM)；空=档案未配置
    model_override VARCHAR(128),                    -- 空=用凭据 model
    enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
    sort_no        INT          NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ
);

INSERT INTO ai_model_profile (code, name, description, credential_id, sort_no)
VALUES ('FAST', '快速', '快速问答、标题、摘要',
        (SELECT id FROM orch_credential WHERE type = 'LLM' AND enabled AND base_url IS NOT NULL
         ORDER BY id DESC LIMIT 1), 1),
       ('STANDARD', '标准', '系统操作和一般工具调用',
        (SELECT id FROM orch_credential WHERE type = 'LLM' AND enabled AND base_url IS NOT NULL
         ORDER BY id DESC LIMIT 1), 2),
       ('REASONING', '深度推理', '深度分析和复杂报表解释（未配置凭据时不可用）', NULL, 3),
       ('VISION', '视觉', '图片理解（未配置凭据时不可用）', NULL, 4);
