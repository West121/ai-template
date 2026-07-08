-- ============================================================
-- OA Platform - V10 工作流 P2 批次2（协作与治理）
--   已阅记录表 wf_task_read（打开任务详情即记，同任务同人去重）
--   草稿复用 wf_instance_ext（biz_status=DRAFT，proc_inst_id 用 DRAFT- 前缀占位）
-- ============================================================

CREATE TABLE wf_task_read (
    id           BIGSERIAL PRIMARY KEY,
    task_id      VARCHAR(64) NOT NULL,
    proc_inst_id VARCHAR(64),
    user_id      BIGINT      NOT NULL,
    read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uk_wf_task_read UNIQUE (task_id, user_id)
);
CREATE INDEX idx_wf_task_read_inst ON wf_task_read (proc_inst_id, user_id);
