# 自动化逻辑编排(Orchestration)设计

> 主控裁定契约 · 磐石(后端)/ 疾风(前端)共同遵循。用户已定:
> **定位=自动化逻辑编排(无人值守,类 n8n/宜搭集成自动化,与审批流互补) · 引擎=LiteFlow ·
> 触发器全套(手动/定时/流程公文事件/Webhook 入站) · 全套动作节点 + LLM(AI)节点。**

## 1. 总体

- 模块名「自动化编排」,前端路由 `/automation`,后端归 oa-module-workflow(编排是工作流族能力,
  且复用其 ScriptService/ExpressionService/事件桥;表前缀 `orch_*`,CLAUDE.md 迁移约定补一行)。
- **执行底座 LiteFlow**(2.16.0 已在栈内):设计器图 JSON(OrchModel)编译为 LiteFlow EL
  (THEN/WHEN/IF/SWITCH/ITERATOR)+ 动态组件;脚本节点复用既有 ScriptService 治理与审计。
- 一切执行留痕:流水级 + 节点级(输入/输出/耗时/错误),可查可重跑。

## 2. 图模型 OrchModel(前后端同一契约)

```jsonc
{
  "schemaVersion": 1,
  "key": "sync_users", "name": "同步用户到外部系统",
  "nodes": [ { "id": "n1", "type": "http", "name": "拉取列表", "position": {"x":0,"y":0}, "config": { /* 按类型 */ } } ],
  "edges": [ { "id": "e1", "source": "n1", "target": "n2", "condition": { /* 结构化条件,复用 BranchCondition */ }, "isDefault": false } ]
}
```

**节点类型与 config**(动作类节点通用字段:`retry {times, intervalMs}`、`onError "ABORT"|"CONTINUE"|"BRANCH"`):

| type | 说明 | config 要点 |
|---|---|---|
| `trigger` | 起点(每流仅一个) | `triggerType: MANUAL/CRON/EVENT/WEBHOOK` + `cron`(表达式) / `event {source: WF/GONGWEN, type: 事件名, defCode?}` / webhook 无配置(token 后端生成) |
| `http` | HTTP 调用 | method/url/headers/body(模板)、timeoutMs、`saveAs`(输出变量名) |
| `script` | 脚本(受信) | 复用 ScriptConfig{lang,code};ctx 注入 vars/payload/outputs/spring/log |
| `condition` | 排它分支 | 无 config;出边带条件(Aviator 表达式或结构化),一条 isDefault |
| `parallel` | 并行开叉/汇合 | `mode:"OPEN"/"JOIN"`(编译为 WHEN) |
| `loop` | 遍历集合 | `collection`(表达式,如 `{{n1.body.list}}`)、`itemVar`、`maxIterations`(护栏,默认 1000) |
| `delay` | 延时 | `ms`(上限 5min,超长延时不做——编排是短事务,长等待用审批流) |
| `notify` | 站内通知 | 收件人(OrgRef[])、标题/内容模板 |
| `startApproval` | 发起审批流 | `defCode`、`formData` 映射(模板)、`title` 模板 |
| `dataMap` | 数据映射/转换 | 赋值列表 `[{target:"varName", expr:"Aviator 表达式"}]` |
| `llm` | **AI 节点** | 见 §4 |
| `end` | 结束 | 可选 `output`(表达式,作为流水结果) |

**数据流**:上下文 = `payload`(触发载荷)+ `vars`(dataMap/脚本写入)+ `outputs[nodeId]`(各节点输出)。
模板插值统一 `{{expr}}`(Aviator 求值,如 `{{outputs.n1.body.total}}`/`{{payload.docId}}`);
条件/表达式裸写 Aviator。**前后端插值语法必须一致**,由后端 `OrchTemplate` 定义、前端只做提示不求值。

## 3. 后端(磐石)

1. **迁移 V{next}**:`orch_flow`(code 唯一/name/designer_json/el_expr 编译缓存/trigger_type/
   trigger_config/webhook_token/enabled/version/updated_*)、`orch_exec`(flow_id/trigger_kind/
   payload/status RUNNING|SUCCESS|FAILED|CANCELED/started_at/ended_at/error/result)、
   `orch_exec_node`(exec_id/node_id/node_name/status/input/output(截断 8KB)/error/cost_ms/started_at)。
   权限码 `orch:flow:read` `orch:flow:write`(受信:含脚本/HTTP/LLM 配置,语义同 wf:script:write 级)`orch:flow:run`。
2. **编译器 `OrchToElCompiler`**:OrchModel → LiteFlow EL + 组件实例(NodeComponent 按 type 分发到
   HttpNode/ScriptNode/…/LlmNode Bean;节点 config 经 meta 传入)。校验:单 trigger、无环(loop 节点
   除外)、条件分支有默认支。发布即编译缓存 el_expr,运行加载。
3. **执行服务 `OrchExecService`**:run(flowId, payload, triggerKind) → 建 exec → LiteFlow 执行(异步线程池,
   超时护栏整流 10min)→ 节点级留痕(LiteFlow 切面/组件内记录)→ 状态回写。重跑=同 payload 新 exec。
4. **触发器**:
   - 手动:`POST /api/orch/flows/{id}/run`(body=payload,orch:flow:run)。
   - 定时:`OrchCronScheduler`(Spring TaskScheduler 动态注册,enabled 才调度;单实例部署够用,
     文档注明集群需换分布式调度的扩展点)。
   - 事件:桥接现有事件——`OrchEventBridge` 实现 WfEventHandler/监听流程完成、公文签发等,
     匹配订阅(trigger_config.event)的编排,payload=事件上下文。
   - Webhook:`POST /api/orch/hooks/{token}`(免登录、token 鉴权、限流基本护栏),body 即 payload。
5. **LLM 节点执行 `LlmNode`**:见 §4;凭据密文存 `orch_credential`(id/name/base_url/api_key 加密/
   model 默认)或系统配置表,节点 config 只引用凭据 id(**designer_json 不落明文 key**)。
6. **API**(`/api/orch/*`,envelope/分页遵约,api-contract.md 补):flows CRUD+enable/disable+publish
   (编译校验)、run、execs 分页(按 flow/status/时间)、exec 详情(含节点列表)、exec 重跑、
   credentials CRUD(orch:flow:write)、webhook token 重置。
7. smoke(**OA_SMOKE_KEEP=1**):建流(http+condition+dataMap+end)→ 手动 run → exec SUCCESS + 节点留痕;
   条件走支正确;脚本节点;webhook 触发;LLM 节点用可控假端点(本地 sink)验证请求/解析;失败重试与
   onError=CONTINUE;起审批流节点真实起 wf 实例。

## 4. LLM(AI)节点

- config:`credentialId`(引用凭据)、`model`(可覆盖默认)、`systemPrompt`/`userPrompt`(模板插值)、
  `temperature?`、`maxTokens?`、`timeoutMs`(默认 60s)、`outputMode:"TEXT"|"JSON"`(JSON 模式:提示词
  强约束 + 解析失败按节点失败走 retry/onError)、`saveAs`。
- 协议:**OpenAI-compatible HTTP**(`{baseUrl}/chat/completions`),不引 SDK——兼容 DeepSeek/Qwen/
  Ollama/OpenAI 等任何兼容端点。凭据加密存储(复用既有加密工具或 AES+应用密钥,磐石定)。
- 输出:TEXT→字符串;JSON→解析对象;均入 `outputs[nodeId]`,下游 `{{outputs.ai1.xxx}}` 引用。

## 5. 前端(疾风)

1. **编排设计器**(整页 `/automation/:code/design`,复用现有 react-flow 基建:画布/palette/连线校验/
   dagre 整理/ErrorBoundary/锁定交互模式,但**独立目录** `web/src/pages/automation/designer/`,
   OrchModel 独立契约,不与审批流 ProcessModel 混):
   - palette 分组:触发(trigger)/逻辑(condition/parallel/loop/delay)/动作(http/script/dataMap/
     notify/startApproval/end)/**AI(llm)**。节点卡片风格沿现有设计器(图标+名称+摘要)。
   - 节点配置面板:按类型表单;**变量选择器**(上游节点输出树 + payload/vars,点击插入 `{{...}}`);
     脚本节点复用 ScriptEditor(CodeMirror);http body/headers 用 CodeMirror JSON;llm prompt 用
     textarea+插变量;条件边复用结构化条件/公式编辑。
   - 顶部条:名称/触发器徽标/校验/整理/保存/发布(编译报错展示)/启停开关/**测试运行**(输入模拟
     payload → 跑真实 exec → 面板逐节点显示状态/输入输出,轮询 exec 详情)。
2. **列表页 `/automation`**:名称/触发器/启用开关/最近执行(状态点+时间)/操作(设计/执行记录/运行)。
3. **执行记录**:exec 分页(状态筛选)→ 详情(节点时间线:状态/耗时/输入输出 JSON 查看器/错误;
   失败重跑按钮)。可作为设计器内 Tab 或独立页,疾风定信息架构。
4. 凭据管理:简单表格(名称/baseUrl/默认模型;key 只写不回显)——放系统设置或 automation 下,疾风定。
5. 菜单/路由遵约;offline 降级 mock;权限 hasPerm 门控(orch:flow:*)。

## 6. 验收

- 后端:smoke 全绿(KEEP=1);编译器/模板插值单测。
- 前端:四门 + OrchModel 序列化往返用例;设计器建一条「webhook → http → condition → llm → notify」
  流可保存/发布/测试运行,节点级结果可见。
- 端到端(主控):手动 run 与 webhook 触发各一条真实流水,节点留痕正确;LLM 节点对本地假端点闭环。

## 7. 分工

- **磐石**:§3 全部 + §4(先行,API 契约冻结后疾风接)。
- **疾风**:§5(mock 先行可并行;API 形状按本文档,偏差找主控对账)。
- 主控:集成对账/端到端验证/提交。审批流侧后续可加事件动作「执行编排」(P1,本期不做)。
