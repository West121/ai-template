-- ============================================================
-- OA Platform - V11 工作流 P2 批次3（引擎增强）
--   票签投票记录表 wf_vote（权重表）：并行多实例 VOTE 节点每人一票 + 权重，
--   completionCondition wfVote.pass(execution) 据此判定赞成权重占比是否过阈值提前完成
-- ============================================================

CREATE TABLE wf_vote (
    id           BIGSERIAL PRIMARY KEY,
    proc_inst_id VARCHAR(64)   NOT NULL,
    node_id      VARCHAR(64)   NOT NULL,
    user_id      BIGINT        NOT NULL,
    weight       NUMERIC(10,2) NOT NULL DEFAULT 1,
    decision     VARCHAR(16)   NOT NULL,     -- APPROVE / REJECT
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uk_wf_vote UNIQUE (proc_inst_id, node_id, user_id)
);
CREATE INDEX idx_wf_vote_inst_node ON wf_vote (proc_inst_id, node_id);
