-- ============================================================
-- V44 人员生命周期治理 · DP2a：离职 offboarding + 交接
--   sys_user 加在职状态/离职日期（默认 ACTIVE，向后兼容）；交接单 sys_handover / sys_handover_item。
--   仅新增列/表 + 默认值；现有用户 status=ACTIVE，行为不变。
-- ============================================================

-- 在职状态：ACTIVE / RESIGNED（离职→禁登录 + token 失效）
ALTER TABLE sys_user
    ADD COLUMN status      VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN resign_date DATE;
CREATE INDEX idx_sys_user_status ON sys_user (status);

-- 交接单
CREATE TABLE sys_handover (
    id           BIGSERIAL PRIMARY KEY,
    from_user_id BIGINT      NOT NULL,       -- 交出方（离职/转出）
    to_user_id   BIGINT,                     -- 继任者（默认，item 可覆盖）
    type         VARCHAR(16) NOT NULL,       -- RESIGN | TRANSFER
    reason       VARCHAR(512),
    status       VARCHAR(16) NOT NULL DEFAULT 'DRAFT', -- DRAFT | RUNNING | DONE
    operator_id  BIGINT,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
CREATE INDEX idx_sys_handover_from ON sys_handover (from_user_id);

-- 交接项（逐项可重试幂等）
CREATE TABLE sys_handover_item (
    id           BIGSERIAL PRIMARY KEY,
    handover_id  BIGINT      NOT NULL,
    item_type    VARCHAR(32) NOT NULL,       -- WF_TASK | WF_NODE_ASSIGNEE | DEPT_LEADER | KB_SPACE_OWNER | DATA_OWNER …
    ref_type     VARCHAR(32),               -- TASK | DEPT | …
    ref_id       VARCHAR(64),               -- 被交接对象 id（字符串，兼容 Flowable taskId）
    old_value    TEXT,                       -- 交接前状态 JSON（留痕）
    new_value    TEXT,                       -- 交接后 JSON（留痕）
    status       VARCHAR(16) NOT NULL DEFAULT 'PENDING', -- PENDING | DONE | SKIPPED
    successor_id BIGINT,                     -- item 级继任者覆盖（可空→用交接单 to_user_id）
    note         VARCHAR(512)
);
CREATE INDEX idx_sys_handover_item_handover ON sys_handover_item (handover_id);
