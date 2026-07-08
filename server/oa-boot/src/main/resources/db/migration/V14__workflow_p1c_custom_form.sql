-- ============================================================
-- OA Platform - V14 流程设计器 P1-C（字段扩展：流程配置 + 自定义表单）
--   wf_process_ext 增列：
--     form_type        表单类型 DYNAMIC(默认动态表单) / CUSTOM(自定义 React 路由表单)
--     form_submit_path CUSTOM 发起页 React 路由（如 /flow/leave/create）
--     form_view_path   CUSTOM 详情查看 React 路由（如 /flow/leave/view）
--     flow_config      流程级配置 JSON（流程操作开关/启动权限/时限/安全等，见 docs/flow-designer-v2.md）
--   节点级 nodeConfig(allowedOps/showApprovalRecord/handleOptions) 写入 BPMN extensionElements，
--   顶层 flowConfig 写 process extensionElements，均由转换器承接，不入表。
-- ============================================================

ALTER TABLE wf_process_ext ADD COLUMN form_type        VARCHAR(20) NOT NULL DEFAULT 'DYNAMIC';
ALTER TABLE wf_process_ext ADD COLUMN form_submit_path VARCHAR(255);
ALTER TABLE wf_process_ext ADD COLUMN form_view_path   VARCHAR(255);
ALTER TABLE wf_process_ext ADD COLUMN flow_config      TEXT;
