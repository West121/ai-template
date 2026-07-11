-- ============================================================
-- OA Platform - V31 单据模板独立化（bizdoc-design.md §11.1）
--   oa_bizdoc_print_tpl 从「定义附属」升级为独立文档模板：
--   可绑定 BIZDOC(def_id) / FLOW(wf defCode) / FORM(formCode)，在流程实例上打印。
--   存量回填：bind_type=BIZDOC、code=tpl_{id}、status=PUBLISHED、version=1（零回归）。
-- ============================================================

ALTER TABLE oa_bizdoc_print_tpl ALTER COLUMN def_id DROP NOT NULL;

ALTER TABLE oa_bizdoc_print_tpl
    ADD COLUMN bind_type   VARCHAR(16)  NOT NULL DEFAULT 'BIZDOC',  -- BIZDOC / FLOW / FORM
    ADD COLUMN bind_code   VARCHAR(64),                             -- FLOW=wf defCode / FORM=formCode；BIZDOC 空(用 def_id)
    ADD COLUMN code        VARCHAR(64),                             -- 模板编码（唯一）
    ADD COLUMN category    VARCHAR(64),
    ADD COLUMN description VARCHAR(255),
    ADD COLUMN status      VARCHAR(16)  NOT NULL DEFAULT 'PUBLISHED', -- DRAFT / PUBLISHED（存量回填 PUBLISHED）
    ADD COLUMN version     INTEGER      NOT NULL DEFAULT 1,           -- 发布自增
    ADD COLUMN updated_at  TIMESTAMPTZ;

UPDATE oa_bizdoc_print_tpl SET code = 'tpl_' || id WHERE code IS NULL;
ALTER TABLE oa_bizdoc_print_tpl ALTER COLUMN code SET NOT NULL;
ALTER TABLE oa_bizdoc_print_tpl ADD CONSTRAINT uk_bizdoc_tpl_code UNIQUE (code);
CREATE INDEX idx_bizdoc_tpl_bind ON oa_bizdoc_print_tpl (bind_type, bind_code);
