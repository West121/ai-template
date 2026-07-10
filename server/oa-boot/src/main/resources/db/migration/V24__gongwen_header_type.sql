-- ============================================================
-- OA Platform - V24 发文文头类型（红头 / 白头普通文件）
--   Document 增 header_type：RED=红头正式公文（现状，GB/T 红头三件套）/ PLAIN=白头普通文件。
--   可空，DEFAULT 'RED'（ADD COLUMN 即回填存量为 RED；渲染端 null 亦按 RED 处理）。仅 oa_*。
-- ============================================================

ALTER TABLE oa_document ADD COLUMN header_type VARCHAR(16) DEFAULT 'RED';
