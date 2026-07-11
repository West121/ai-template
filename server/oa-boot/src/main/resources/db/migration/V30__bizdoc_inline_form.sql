-- ============================================================
-- OA Platform - V30 BizDoc 范式修正二（契约 bizdoc-design.md §10）：单据自带表单设计
--   oa_bizdoc_def 加 form_schema JSON（单据私有表单 schema，widgets 结构与在线表单同构，
--   不进 wf_form_def）；form_type 语义改 INLINE(内置设计，默认/主路径) | CODE(高级：手写表单)。
--   ONLINE 绑定选项移除；存量 ONLINE 定义保留原值，后端按外部表单引用兼容读。仅 oa_*。
-- ============================================================

ALTER TABLE oa_bizdoc_def ADD COLUMN form_schema TEXT;
ALTER TABLE oa_bizdoc_def ALTER COLUMN form_type SET DEFAULT 'INLINE';
