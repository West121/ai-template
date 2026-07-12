-- ============================================================
-- OA Platform - V37 AI 报表：受控灵活维度（多维数据源 + 维度/时间粒度白名单）
--   背景：报表原为「一个 reportCode 一个写死维度」（BY_STATUS/BY_TYPE/BY_PROCESS…），
--         用户临时换维度（按月份/按部门）不行。
--   方案（不破 §11.1「禁止 stats_report 演变成隐形 SQL」红线）：
--     · 把审批量合并为一个多维数据源 APPROVAL_COUNT，声明 allowed_dimensions + allowed_time_grains；
--     · 维度名仅在服务端白名单内选择，映射到「预定义」JPA Specification / 参数化分组逻辑；
--       LLM 只挑维度名，绝不注入字段/SQL（详见 AiReportService）；
--     · 旧 3 个审批 reportCode 保留为「预设别名」（单维 allowed_dimensions，向后兼容原结果）。
-- ============================================================

ALTER TABLE ai_report_catalog ADD COLUMN data_source         VARCHAR(32);
ALTER TABLE ai_report_catalog ADD COLUMN default_dimension   VARCHAR(32);
ALTER TABLE ai_report_catalog ADD COLUMN allowed_time_grains VARCHAR(128);

-- 旧审批 reportCode → 预设别名（单维白名单：调用方若传其它 dimension 落白名单外 → 友好 400；缺省=该维）
UPDATE ai_report_catalog SET data_source='APPROVAL', default_dimension='status',  allowed_dimensions='status'
 WHERE report_code='APPROVAL_COUNT_BY_STATUS';
UPDATE ai_report_catalog SET data_source='APPROVAL', default_dimension='type',    allowed_dimensions='type'
 WHERE report_code='APPROVAL_COUNT_BY_TYPE';
UPDATE ai_report_catalog SET data_source='APPROVAL', default_dimension='process', allowed_dimensions='process'
 WHERE report_code='APPROVAL_COUNT_BY_PROCESS';
UPDATE ai_report_catalog SET data_source='DOCUMENT', default_dimension='docType', allowed_dimensions='docType'
 WHERE report_code='DOCUMENT_COUNT_BY_TYPE';
UPDATE ai_report_catalog SET data_source='ATTENDANCE'
 WHERE report_code='ATTENDANCE_RATE_BY_MONTH';

-- 新增多维数据源 APPROVAL_COUNT（受控灵活维度）：
--   dimension 由调用方在 allowed_dimensions 白名单内选择；timeGrain 仅 month 维生效。
--   required_authorities=NULL：个人可见范围内自助统计——数据权限仍由 SecuritySupport.dataScope 约束可见行
--   （员工只见本人范围；管理员见全部）。report_execute 工具面仍受工具级 authorities 门控，不额外放开。
INSERT INTO ai_report_catalog
    (report_code, name, description, parameter_schema, required_authorities,
     data_scope_strategy, allowed_dimensions, allowed_time_grains, default_dimension,
     chart_type, drill_param) VALUES
    ('APPROVAL_COUNT', '审批量统计',
     '审批量多维统计：维度可选 状态/类型/流程/月份/部门/发起人；时间维支持 日/周/月/季/年 粒度（数据权限照旧）',
     '{"dimension":{"type":"string","description":"统计维度，从 allowedDimensions 选：status/type/process/month/dept/initiator"},'
     || '"timeGrain":{"type":"string","description":"时间粒度（仅 month 维生效）：day/week/month/quarter/year，缺省 month"},'
     || '"rangeStart":{"type":"string","description":"可选，起始日期 yyyy-MM-dd（按创建时间过滤）"},'
     || '"rangeEnd":{"type":"string","description":"可选，结束日期 yyyy-MM-dd（按创建时间过滤）"},'
     || '"drillValue":{"type":"string","description":"下钻：按当前维度的某类目值过滤，返回审批明细"}}',
     NULL, 'OFFICE_SCOPE', 'status,type,process,month,dept,initiator',
     'day,week,month,quarter,year', 'status', 'bar', 'drillValue');
