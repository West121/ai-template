-- ============================================================
-- OA Platform - V53 i18n · AI 批量翻译权限码（docs/design/i18n.md 拍板④）
--   POST /api/ai/translate 门控 system:i18n:translate（仅 ADMIN——dev-time 批量翻译/管理员操作，
--   非全员运行时能力）；端点无副作用、可重试。
-- ============================================================

INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'system:i18n:translate', 'AI 批量翻译', 'BUTTON');
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code = 'system:i18n:translate';
