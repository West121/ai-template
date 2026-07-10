-- ============================================================
-- OA Platform - V23 公文流程 form_view_path 模板（待办「去处理」跳办文单而非通用 wf 实例详情）
--   根因：公文实例经 office RuntimeService 起、无 wf_instance_ext 行，通用实例详情查不到 → 404「实例不存在」。
--   解法：给 gw_send/gw_recv 配 form_view_path 模板（{id} 占位=businessKey 末段=公文 documentId），
--   WfTaskService.toItem 生成 TaskItem.viewPath（如 /document/send/67）；前端待办跳 viewPath 优先。
--   通用做法：任何配了 form_view_path 的流程都能生成 viewPath，不写死公文。仅 wf_*。
-- ============================================================

UPDATE wf_process_ext SET form_view_path = '/document/send/{id}'    WHERE def_code = 'gw_send';
UPDATE wf_process_ext SET form_view_path = '/document/receive/{id}' WHERE def_code = 'gw_recv';
