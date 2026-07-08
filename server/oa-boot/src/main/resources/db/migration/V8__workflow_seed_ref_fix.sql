-- ============================================================
-- OA Platform - V8 工作流种子修正
--   1) 请假审批 designerJson 的 ORG/抄送 引用统一为 {kind,id}（对齐前端 OrgPicker 的 id 制，
--      避免 username-only 引用在设计器重存后丢失处理人）
--   2) 置回 DRAFT + 清空部署元数据，令 WorkflowInitializer 启动时用最新转换器重新部署
--      （重生成 bpmnXml：含 BPMNDI + id 制引用），幂等
-- ============================================================

UPDATE wf_process_ext
SET designer_json = '{"nodes":[{"id":"mgr","type":"approval","name":"部门经理审批","assigneeRules":[{"type":"LEADER","level":1}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"},{"id":"cond","type":"condition","name":"天数判断","branches":[{"id":"b_gt3","name":"天数大于3","logic":"AND","conditions":[{"field":"days","operator":">","value":3}],"steps":[{"id":"gm","type":"approval","name":"总经理审批","assigneeRules":[{"type":"ORG","refs":[{"kind":"USER","id":1}]}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"}]},{"id":"b_default","name":"默认","default":true,"steps":[]}]},{"id":"cc1","type":"cc","name":"抄送人事","users":[{"kind":"USER","id":3}]}]}',
    status = 'DRAFT',
    latest_deployment_id = NULL,
    process_definition_id = NULL,
    bpmn_xml = NULL
WHERE def_code = 'leave_approval';
