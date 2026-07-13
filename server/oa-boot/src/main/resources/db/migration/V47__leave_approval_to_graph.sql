-- ============================================================
-- V47 请假审批(leave_approval)正式转 GRAPH 设计器
--   V7 种子(DINGTALK)校验和不可改，故用新迁移把 leave_approval 归一为 GRAPH：
--   置 designer_type=GRAPH + designer_json=GRAPH 归一模型(nodes/edges) + status=DRAFT + 清 bpmn_xml，
--   由 WorkflowInitializer(启动兜底) 经 GraphToBpmnConverter 重新直译部署为 GRAPH。
--   新装也默认 leave=GRAPH（种子行被本迁移改为 GRAPH DRAFT → 启动即部署）。
--   前提：InstanceService.predict 已补 GRAPH 静态预测（钉钉/图形设计器平权）。
-- ============================================================
UPDATE wf_process_ext
SET designer_type = 'GRAPH',
    designer_json = '{"schemaVersion":1,"key":"leave_approval","name":"请假审批","nodes":[{"id":"start","name":"开始","position":{"x":100,"y":20},"type":"startEvent"},{"id":"mgr","name":"部门经理审批","position":{"x":20,"y":140},"props":{"assigneeRules":[{"kind":"LEADER","level":1}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"},"type":"userTask"},{"id":"cond_split","name":"天数判断","position":{"x":100,"y":300},"type":"exclusiveGateway"},{"id":"cond_join","name":"天数判断·汇聚","position":{"x":100,"y":560},"type":"exclusiveGateway"},{"id":"gm","name":"总经理审批","position":{"x":100,"y":420},"props":{"assigneeRules":[{"kind":"ACCOUNT","source":"FIXED","refs":[{"type":"USER","id":1,"name":"系统管理员"}]}],"multiMode":"ANY","emptyStrategy":"TO_ADMIN"},"type":"userTask"},{"id":"cc1","name":"抄送人事","position":{"x":20,"y":700},"props":{"ccUsers":[{"type":"USER","id":3,"name":"张三"}]},"type":"cc"},{"id":"end","name":"结束","position":{"x":100,"y":840},"type":"endEvent"}],"edges":[{"id":"edge_0","source":"cond_split","target":"gm","condition":{"logic":"AND","items":[{"field":"days","operator":"gt","value":"3"}]}},{"id":"edge_1","source":"gm","target":"cond_join"},{"id":"edge_2","source":"cond_split","target":"cond_join","isDefault":true},{"id":"edge_3","source":"mgr","target":"cond_split"},{"id":"edge_4","source":"cond_join","target":"cc1"},{"id":"edge_5","source":"start","target":"mgr"},{"id":"edge_6","source":"cc1","target":"end"}],"formKey":"leave:1","flowConfig":{"operations":{"terminate":true,"retrieve":false,"urge":false,"cancel":true},"start":{"scope":[],"taskTitle":""},"variables":[]}}',
    bpmn_xml = NULL,
    status = 'DRAFT'
WHERE def_code = 'leave_approval';
