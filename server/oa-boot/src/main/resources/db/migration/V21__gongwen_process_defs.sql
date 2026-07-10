-- ============================================================
-- OA Platform - V21 公文办文流程注册为 wf 流程定义（GRAPH / designerJson）
--   主控裁定：gw_send/gw_recv 必须①出现在 GET /api/wf/process-defs；②可在 react-flow 设计器打开编辑；
--   ③真实 OA 取人规则（AssigneeResolver），而非一律「发起人本人」。
--
--   做法：以 designer_type=GRAPH + designer_json(ProcessModel) 种子入 wf_process_ext，status=DRAFT，
--   由既有 WorkflowInitializer（@Order 100）走 ProcessDefService.deploy → GraphToBpmnConverter 部署，
--   与用户流程同一条注册/部署路径。幂等：只 deploy DRAFT 行，成功即置 PUBLISHED，重启跳过、不堆叠版本。
--
--   稳定/锁定节点标识（回写 hook 绑定 taskDefinitionKey==节点 id，设计器改名不改 id；locked:true 供设计器锁定）：
--     发文 gw_send：review 核稿 / countersign 会签 / issue 签发(占号) / seal 用印(SEALED) / publish 成文(PUBLISHED)
--     收文 gw_recv：propose 拟办 / approve 批办(落 opinion) / handle 承办 / circulate 传阅(生成 circulation) / finish 办结
--   取人规则字段用前端 AssigneeRule 规范形状（kind + source + refs[{kind,id,name}]，见 designer/types.ts）：
--     review/handle/propose = 发起人部门主管(LEADER lv1)；countersign/issue/approve = 部门经理角色(单位领导)；
--     seal = 系统管理员角色(印章管理员)；publish/circulate/finish = 发起人本人(拟稿/收文员)。
--     emptyStrategy=TO_ADMIN（空审批人兜底转管理员，绝不静默跳过关键办文节点）。
--     后端 AssigneeResolver 走 kind→type 兜底解析，取人结果不变（签发→部门经理角色→王经理 id2）。
--   坐标层次清晰不重叠（节点约 208×64；列距 260/280、行距 140；网关分支上下错开），一载入即工整。
--   仅 wf_*。ddl-auto=validate 不涉本表结构变更。
-- ============================================================

-- form_type=CUSTOM + form_submit_path：发起页(start.tsx)对 CUSTOM 表单不弹动态表单，
-- 而是 navigate 到 form_submit_path（公文拟稿/登记单），经 /api/office/doc/* 正确建 oa_document + 占号。
-- startable() 映射 StartableItem.formSubmitPath <- 本表 form_submit_path 列。
INSERT INTO wf_process_ext (def_code, name, category, designer_type, designer_json, status, form_type, form_submit_path, created_at)
VALUES
('gw_send', '发文办理单', '公文', 'GRAPH',
'{"schemaVersion":1,"key":"gw_send","name":"发文办理单","nodes":[
{"id":"start","type":"startEvent","name":"拟稿","position":{"x":40,"y":200}},
{"id":"review","type":"userTask","locked":true,"name":"核稿","position":{"x":300,"y":200},"props":{"assigneeRules":[{"kind":"LEADER","level":1}],"emptyStrategy":"TO_ADMIN"}},
{"id":"gwCs","type":"exclusiveGateway","name":"是否会签","position":{"x":580,"y":212}},
{"id":"countersign","type":"userTask","locked":true,"name":"会签","position":{"x":820,"y":60},"props":{"assigneeRules":[{"kind":"ROLE","source":"FIXED","refs":[{"kind":"ROLE","id":2,"name":"部门经理"}]}],"emptyStrategy":"TO_ADMIN"}},
{"id":"issue","type":"userTask","locked":true,"name":"签发","position":{"x":820,"y":200},"props":{"assigneeRules":[{"kind":"ROLE","source":"FIXED","refs":[{"kind":"ROLE","id":2,"name":"部门经理"}]}],"emptyStrategy":"TO_ADMIN"}},
{"id":"seal","type":"userTask","locked":true,"name":"用印","position":{"x":1100,"y":200},"props":{"assigneeRules":[{"kind":"ROLE","source":"FIXED","refs":[{"kind":"ROLE","id":1,"name":"系统管理员"}]}],"emptyStrategy":"TO_ADMIN"}},
{"id":"publish","type":"userTask","locked":true,"name":"成文分发","position":{"x":1380,"y":200},"props":{"assigneeRules":[{"kind":"INITIATOR"}],"emptyStrategy":"TO_ADMIN"}},
{"id":"end","type":"endEvent","name":"成文归档","position":{"x":1660,"y":200}}
],"edges":[
{"id":"se1","source":"start","target":"review"},
{"id":"se2","source":"review","target":"gwCs"},
{"id":"se3","source":"gwCs","target":"countersign","name":"需会签","expression":"needCountersign == true"},
{"id":"se4","source":"gwCs","target":"issue","name":"免会签","isDefault":true},
{"id":"se5","source":"countersign","target":"issue"},
{"id":"se6","source":"issue","target":"seal"},
{"id":"se7","source":"seal","target":"publish"},
{"id":"se8","source":"publish","target":"end"}
]}',
'DRAFT', 'CUSTOM', '/document/send?new=1', now()),

('gw_recv', '收文办理单', '公文', 'GRAPH',
'{"schemaVersion":1,"key":"gw_recv","name":"收文办理单","nodes":[
{"id":"start","type":"startEvent","name":"签收登记","position":{"x":40,"y":200}},
{"id":"propose","type":"userTask","locked":true,"name":"拟办","position":{"x":300,"y":200},"props":{"assigneeRules":[{"kind":"LEADER","level":1}],"emptyStrategy":"TO_ADMIN"}},
{"id":"approve","type":"userTask","locked":true,"name":"批办","position":{"x":580,"y":200},"props":{"assigneeRules":[{"kind":"ROLE","source":"FIXED","refs":[{"kind":"ROLE","id":2,"name":"部门经理"}]}],"emptyStrategy":"TO_ADMIN"}},
{"id":"handle","type":"userTask","locked":true,"name":"承办","position":{"x":860,"y":200},"props":{"assigneeRules":[{"kind":"LEADER","level":1}],"emptyStrategy":"TO_ADMIN"}},
{"id":"gwCirc","type":"exclusiveGateway","name":"是否传阅","position":{"x":1140,"y":212}},
{"id":"circulate","type":"userTask","locked":true,"name":"传阅","position":{"x":1380,"y":60},"props":{"assigneeRules":[{"kind":"INITIATOR"}],"emptyStrategy":"TO_ADMIN"}},
{"id":"finish","type":"userTask","locked":true,"name":"办结归档","position":{"x":1380,"y":200},"props":{"assigneeRules":[{"kind":"INITIATOR"}],"emptyStrategy":"TO_ADMIN"}},
{"id":"end","type":"endEvent","name":"办结","position":{"x":1660,"y":200}}
],"edges":[
{"id":"re1","source":"start","target":"propose"},
{"id":"re2","source":"propose","target":"approve"},
{"id":"re3","source":"approve","target":"handle"},
{"id":"re4","source":"handle","target":"gwCirc"},
{"id":"re5","source":"gwCirc","target":"circulate","name":"需传阅","expression":"needCirculate == true"},
{"id":"re6","source":"gwCirc","target":"finish","name":"免传阅","isDefault":true},
{"id":"re7","source":"circulate","target":"finish"},
{"id":"re8","source":"finish","target":"end"}
]}',
'DRAFT', 'CUSTOM', '/document/receive?new=1', now());
