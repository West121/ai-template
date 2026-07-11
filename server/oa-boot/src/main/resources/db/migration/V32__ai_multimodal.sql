-- ============================================================
-- OA Platform - V32 AI 助手增强批（ai-assistant-design.md §11）
--   orch_credential.supports_vision：LLM 凭据视觉能力标记（带图请求能力检测）
--   ai_chat_message.attachments：消息附件 JSON [{fileId|dataUrl, kind:IMAGE|TEXT, name}]（回显）
-- ============================================================

ALTER TABLE orch_credential ADD COLUMN supports_vision BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai_chat_message ADD COLUMN attachments TEXT;
