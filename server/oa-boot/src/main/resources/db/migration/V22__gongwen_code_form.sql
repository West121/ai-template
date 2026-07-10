-- ============================================================
-- OA Platform - V22 公文 CODE(代码手写)表单字段清单登记 + 流程定义并入 CODE
--   契约：docs/design/code-form-field-identification.md（后端·磐石）。
--   1) 登记 gw_send/gw_recv 的 CODE 表单字段清单（wf_form_def.form_type=CODE + field_manifest），
--      令 GET /api/wf/forms/{key}/fields 返回字段（含 needCountersign 驱动会签网关条件）——不再 404。
--   2) 流程定义并入 CODE：wf_process_ext.form_type 'CUSTOM'→'CODE' + form_code=def_code（form_submit_path 保留）。
--      startable()/StartableItem 归一化 formType（DYNAMIC→ONLINE、CUSTOM→CODE），前端据 CODE+submitPath navigate。
--   仅 wf_*。ddl-auto=validate 不涉结构变更。
-- ============================================================

-- 1. CODE 表单字段清单（FieldDescriptor[]：key/label/type[/options]），status=PUBLISHED
INSERT INTO wf_form_def (code, name, version, schema_json, form_type, field_manifest, status, remark, created_by) VALUES
('gw_send', '发文办理单', 1, NULL, 'CODE',
'[{"key":"title","label":"标题","type":"input"},{"key":"docType","label":"文种","type":"select","options":[{"label":"决定","value":"决定"},{"label":"通知","value":"通知"},{"label":"通报","value":"通报"},{"label":"报告","value":"报告"},{"label":"请示","value":"请示"},{"label":"批复","value":"批复"},{"label":"意见","value":"意见"},{"label":"函","value":"函"},{"label":"纪要","value":"纪要"}]},{"key":"secret","label":"密级","type":"select","options":[{"label":"公开","value":"PUBLIC"},{"label":"内部","value":"INTERNAL"},{"label":"秘密","value":"SECRET"},{"label":"机密","value":"CONFIDENTIAL"}]},{"key":"urgency","label":"紧急程度","type":"select","options":[{"label":"普通","value":"NORMAL"},{"label":"加急","value":"URGENT"},{"label":"特急","value":"FLASH"}]},{"key":"mainRecipients","label":"主送机关","type":"input"},{"key":"ccRecipients","label":"抄送机关","type":"input"},{"key":"content","label":"正文","type":"textarea"},{"key":"attachments","label":"附件","type":"file"},{"key":"needCountersign","label":"是否会签","type":"boolean"},{"key":"numberRuleId","label":"文号规则","type":"select"}]',
'PUBLISHED', '公文发文办文单 CODE 表单', NULL),
('gw_recv', '收文办理单', 1, NULL, 'CODE',
'[{"key":"unit","label":"来文单位","type":"input"},{"key":"code","label":"来文字号","type":"input"},{"key":"title","label":"标题","type":"input"},{"key":"docType","label":"文种","type":"select","options":[{"label":"决定","value":"决定"},{"label":"通知","value":"通知"},{"label":"通报","value":"通报"},{"label":"报告","value":"报告"},{"label":"请示","value":"请示"},{"label":"批复","value":"批复"},{"label":"意见","value":"意见"},{"label":"函","value":"函"},{"label":"纪要","value":"纪要"}]},{"key":"secret","label":"密级","type":"select","options":[{"label":"公开","value":"PUBLIC"},{"label":"内部","value":"INTERNAL"},{"label":"秘密","value":"SECRET"},{"label":"机密","value":"CONFIDENTIAL"}]},{"key":"urgency","label":"紧急程度","type":"select","options":[{"label":"普通","value":"NORMAL"},{"label":"加急","value":"URGENT"},{"label":"特急","value":"FLASH"}]},{"key":"content","label":"正文","type":"textarea"},{"key":"attachments","label":"附件","type":"file"},{"key":"needCirculate","label":"是否传阅","type":"boolean"}]',
'PUBLISHED', '公文收文办文单 CODE 表单', NULL);

-- 2. 流程定义并入 CODE：form_type→CODE、form_code=def_code（form_submit_path 已在 V21 设好）
UPDATE wf_process_ext SET form_type = 'CODE', form_code = def_code
WHERE def_code IN ('gw_send', 'gw_recv');
