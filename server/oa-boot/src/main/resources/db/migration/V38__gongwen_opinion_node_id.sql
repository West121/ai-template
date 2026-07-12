-- ============================================================
-- OA Platform - V38 办文意见补 node_id（公文统一详情基座重构后端前置）
--   背景：公文办文单迁到复用审批的统一流程图组件 WorkflowFlowTrack，需按节点 id 逐节点回填办理信息
--         （谁在哪个节点办的/状态/意见）。审批靠 wf_operation.node_id（= Flowable 当前任务 taskDefinitionKey
--         = 钉钉/BPMN 节点 activity id）做到；公文办文意见 oa_doc_opinion 此前无 node_id，故补齐同口径。
--
--   node_id 取值口径（与审批一致）：办理时取当前 Flowable 任务的 taskDefinitionKey；
--     发文 gw_send：review/countersign/issue/seal/publish（起始 start）
--     收文 gw_recv：propose/approve/handle/circulate/finish（起始 start）
--   拟稿/收文登记发生在起始事件，映射到起始节点 id = 'start'（与 highlight 的 start 对齐）。
--   催办(urge) 记录被催办的当前节点 id（decision=URGE，前端不计入办理人）。
--
--   存量回填：历史行的 task_key 对办理节点即等于 activity id（review/issue/…），直接沿用；
--     拟稿/登记(draft/register)映射到 start；其余非流程节点(urge 等)留空——公文流程图对空 node_id
--     的老数据只高亮当前节点、不逐节点回填、不崩。仅 oa_* 表；ddl-auto=validate。
-- ============================================================

ALTER TABLE oa_doc_opinion ADD COLUMN node_id VARCHAR(64);

-- 办理节点：task_key 即 activity id，直接沿用
UPDATE oa_doc_opinion
   SET node_id = task_key
 WHERE node_id IS NULL
   AND task_key IN ('review', 'countersign', 'issue', 'seal', 'publish',
                    'propose', 'approve', 'handle', 'circulate', 'finish');

-- 拟稿 / 收文登记：起始事件 → start 节点
UPDATE oa_doc_opinion
   SET node_id = 'start'
 WHERE node_id IS NULL
   AND task_key IN ('draft', 'register');
