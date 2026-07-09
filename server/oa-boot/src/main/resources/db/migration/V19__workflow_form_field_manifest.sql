-- ============================================================
-- OA Platform - V19 表单字段清单系统（N-B-03，设计文档第二部分 2.2/2.3）
--   wf_form_def 增 form_type：区分 ONLINE(在线设计器) / CODE(手写 react-hook-form 表单)
--   预留「仅存字段清单不存 schemaJson」能力：schema_json 放宽为可空 + 增 field_manifest 列
--   范围已锁定：仅 ONLINE + CODE（不做 EXTERNAL）
-- ============================================================

-- 表单来源类型，默认 ONLINE（现存表单全部为在线设计）
ALTER TABLE wf_form_def
    ADD COLUMN form_type VARCHAR(20) NOT NULL DEFAULT 'ONLINE';

-- CODE 表单仅登记字段清单、不存 widgets schema，故放宽 schema_json 非空约束
ALTER TABLE wf_form_def
    ALTER COLUMN schema_json DROP NOT NULL;

-- CODE 表单的字段清单存储（FieldDescriptor[] JSON）；ONLINE 表单为 NULL（清单由 schema_json 派生）
ALTER TABLE wf_form_def
    ADD COLUMN field_manifest TEXT;

COMMENT ON COLUMN wf_form_def.form_type IS 'ONLINE=在线设计器(存 schema_json) / CODE=手写表单(存 field_manifest)';
COMMENT ON COLUMN wf_form_def.field_manifest IS 'CODE 表单字段清单 JSON（FieldDescriptor[]）；ONLINE 为 NULL';
