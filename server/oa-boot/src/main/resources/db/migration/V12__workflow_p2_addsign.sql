-- ============================================================
-- OA Platform - V12 工作流 P2 加签串行链修正
--   加签链 wf_add_sign：把单个任务沿"加签链"依次流转（不复用节点多实例，避免 ANY 或签退化）
--   PRE  链 = [被加签人..., 原审批人]（B 先审→回到 A→A 审→下一节点）
--   POST 链 = [原审批人, 被加签人...]（A 先审→B 审→下一节点）
--   审批推进时：非末位=流转下一人(setAssignee，不 complete)；末位=真正 complete 推进节点
-- ============================================================

CREATE TABLE wf_add_sign (
    id             BIGSERIAL PRIMARY KEY,
    task_id        VARCHAR(64) NOT NULL,
    proc_inst_id   VARCHAR(64) NOT NULL,
    node_id        VARCHAR(64),
    origin_user_id BIGINT      NOT NULL,       -- 发起加签的原审批人
    mode           VARCHAR(8)  NOT NULL,       -- PRE / POST
    chain_json     TEXT        NOT NULL,       -- 有序用户 id 数组
    pos            INTEGER     NOT NULL DEFAULT 0,   -- 当前处理位
    status         VARCHAR(16) NOT NULL DEFAULT 'RUNNING', -- RUNNING / DONE
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wf_add_sign_task ON wf_add_sign (task_id, status);
