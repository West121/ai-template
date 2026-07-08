-- ============================================================
-- OA Platform - V13 工作流 P3（高级能力）
--   1) wf_instance_ext 增列：biz_time（穿越时空业务时间）/ resurrect_from（唤醒来源实例）
--   2) wf_operation 增列：biz_time（业务时间随操作带出，展示/报表用）
--   3) 子流程/定时/触发/AI 节点为纯 BPMN 转换，无新业务表；印章沿用 V7 的 wf_seal
--   ACT_* 引擎自管不进 Flyway
-- ============================================================

ALTER TABLE wf_instance_ext ADD COLUMN biz_time      TIMESTAMPTZ;
ALTER TABLE wf_instance_ext ADD COLUMN resurrect_from VARCHAR(64);

ALTER TABLE wf_operation ADD COLUMN biz_time TIMESTAMPTZ;
