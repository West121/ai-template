-- ============================================================
-- OA Platform - V27 编排批4：版本历史（契约 orchestration-design.md §9.5）
--   orch_flow_version：发布快照（publish 即落一行），支持 列表/查看/回滚。
--   连接器节点（dingtalkBot/feishuBot/dbQuery）无新表。仅 orch_*。
-- ============================================================

CREATE TABLE orch_flow_version (
    id             BIGSERIAL    PRIMARY KEY,
    flow_id        BIGINT       NOT NULL,
    version        INTEGER      NOT NULL,
    name           VARCHAR(128),
    designer_json  TEXT,
    el_expr        TEXT,
    trigger_type   VARCHAR(16),
    trigger_config TEXT,
    remark         VARCHAR(255),
    created_by     BIGINT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uk_orch_flow_version UNIQUE (flow_id, version)
);
CREATE INDEX idx_orch_flow_version_flow ON orch_flow_version (flow_id, version DESC);
