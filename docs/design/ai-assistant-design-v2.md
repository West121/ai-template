# AI 智能助手（对话式系统 Agent）设计 V2

> **技术基线**：Spring Boot 4 + Spring AI 2 + Spring Security / Spring Authorization Server + Flowable 8 + PostgreSQL + Redis + React  
> **文档状态**：实施设计稿  
> **适用范围**：企业级 OA 全局 AI 助手——功能介绍、系统导航、业务查询、对话式表单、审批发起、待办处理、统计分析、图表与表格、会话历史、上下文记忆。  
> **核心原则**：AI 负责理解与编排，业务系统负责授权、校验、事务和最终执行；Flowable 负责正式业务流程，Spring AI 不替代流程引擎。

---

## 1. 建设目标

### 1.1 核心能力

AI 助手应支持：

1. 介绍系统模块、菜单和具体功能，并提供受控导航入口。
2. 查询当前用户有权查看的待办、已办、我发起、公文、会议、考勤和统计数据。
3. 根据自然语言识别审批类型，生成对话内表单卡片并预填已知字段。
4. 对审批通过、驳回、转办、发布等写操作生成确认卡片，经用户确认后执行。
5. 生成受控的数据表格和统计图表，支持分页、筛选和跳转。
6. 支持会话管理、历史记录、短期上下文、任务状态和受控的长期偏好记忆。
7. 严格继承现有功能权限、租户权限、数据权限、字段权限和业务状态权限。
8. 对模型调用、工具调用、写操作、确认过程和业务结果进行全链路审计。

### 1.2 非目标

V2 不承担以下职责：

- 不让 LLM 直接连接数据库或生成可执行 SQL。
- 不开放任意 HTTP、Shell、脚本、文件系统或代码执行工具。
- 不使用 Spring AI 代替 Flowable 的流程状态、会签、或签、退回、超时和审批历史。
- 不允许模型直接生成可执行的 `actionId`、内部路由、权限表达式或任意 ECharts JavaScript。
- 不在首期开放删除、批量授权、强制结束流程、修改权限等高风险能力。
- 不在首期引入 AgentScope、LangGraph 或复杂多智能体主链路。

---

## 2. 核心架构裁定

### 2.1 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ React 全局 AI 助手                                           │
│ 会话 / Markdown / 表单卡 / 确认卡 / 表格 / 图表 / 状态事件     │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + SSE
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ AI Assistant API                                            │
│ Chat / Session / History / Confirm / Cancel / Attachment    │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ AiChatApplicationService                                    │
│                                                             │
│  SessionConcurrencyGuard                                    │
│  ContextAssembler                                           │
│  Spring AI ChatClient                                       │
│    ├─ SecurityContextAdvisor                                │
│    ├─ ConversationMemoryAdvisor                             │
│    ├─ RetrievalAugmentationAdvisor                          │
│    ├─ ToolCallingAdvisor                                    │
│    ├─ QuotaAdvisor                                          │
│    └─ AuditAdvisor                                          │
│  MessagePartAssembler                                       │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ AiToolGateway                                                │
│ 动态工具过滤 / 参数校验 / 风险分级 / 结果最小化 / 动作草稿       │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ OA Application Services                                     │
│ @PreAuthorize / 数据权限 / 事务 / Flowable / OperLog           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 职责边界

| 能力 | 责任组件 |
|---|---|
| 理解用户意图 | Spring AI 2 + LLM |
| 选择业务工具 | Spring AI Tool Calling |
| 工具动态过滤 | `AuthorizedToolResolver` |
| 参数与风险校验 | `AiToolGateway` |
| 功能权限 | Spring Security 方法权限 |
| 数据权限 | 现有数据权限组件 / Specification / SQL 拦截器 |
| 表单定义 | OA 表单引擎 |
| 审批流程 | Flowable 8 |
| 业务事务 | OA Application Service |
| 卡片生成 | 服务端 `MessagePartAssembler` |
| 会话事实记录 | PostgreSQL |
| 短期模型上下文 | Spring AI Chat Memory + 自定义上下文装配 |
| 长期偏好记忆 | 自定义 `ai_user_memory` |
| 图表渲染 | React + 受限图表协议 |
| 审计与链路 | Micrometer / OpenTelemetry + 业务审计表 |

---

## 3. 安全红线与信任边界

### 3.1 不可突破的安全原则

1. **工具以当前登录用户身份执行**，不得以系统管理员或服务账号代查业务数据。
2. **业务工具只能包装现有受保护的 Application Service/API**，禁止直接 Repository/Mapper/DB 操作。
3. **模型不能成为权限裁定者**；Prompt 中的权限说明仅用于改善交互，不构成安全边界。
4. **写操作必须经过风险分级和用户显式授权**。
5. **所有可执行卡片必须由服务端可信代码生成**，模型输出不能直接变成执行指令。
6. **确认执行必须重新鉴权、重新校验数据权限和业务状态**。
7. **工具结果、RAG 文档、附件、记忆和用户消息一律视为不可信数据**，不得改变系统策略或工具权限。
8. **所有 AI 数据按 `tenant_id + user_id` 强隔离**。
9. **敏感数据最小化进入模型、消息表和审计日志**。
10. **不提供万能工具**，例如 `execute_sql`、`call_any_api`、`run_script`、`invoke_service`。

### 3.2 信任层级

```text
SYSTEM_POLICY          服务端固定策略，最高信任
SERVER_CONTEXT         服务端生成的租户、用户、权限与页面上下文
USER_REQUEST           用户输入，不可信
RETRIEVED_DOCUMENT     RAG 文档，不可信
TOOL_DATA              工具返回数据，不可信
ATTACHMENT_CONTENT     上传文件内容，不可信
MEMORY                  历史和模型生成摘要，不可信
```

规则：低信任内容只能作为业务数据或参考材料，不得覆盖高信任策略，不得要求系统扩大权限或开放新工具。

---

## 4. Spring AI 2 编排设计

### 4.1 使用 Spring AI 原生能力

V2 使用 Spring AI 2 的原生 `ChatClient`、Advisor、Tool Calling、Chat Memory、RAG、Structured Output 和 Observation。不要重新手写完整的模型工具循环。

推荐编排结构：

```java
ChatClient chatClient = ChatClient.builder(chatModel)
        .defaultAdvisors(
                securityContextAdvisor,
                conversationMemoryAdvisor,
                retrievalAugmentationAdvisor,
                quotaAdvisor,
                auditAdvisor
        )
        .build();
```

工具通过每次请求动态解析：

```java
List<ToolCallback> tools = authorizedToolResolver.resolve(executionContext);

ChatClient.ChatClientRequestSpec request = chatClient.prompt()
        .system(systemPromptFactory.create(executionContext))
        .user(userPrompt)
        .toolCallbacks(tools);
```

> `ToolCallingAdvisor` 由 Spring AI 工具调用机制负责循环；自定义代码只负责权限过滤、业务风险控制、Tool 结果转换和审计。

### 4.2 Advisor 顺序建议

```text
1. RequestId / Trace Advisor
2. SecurityContextAdvisor
3. QuotaAdvisor
4. ConversationMemoryAdvisor
5. RetrievalAugmentationAdvisor
6. Tool Calling
7. AuditAdvisor
8. OutputSanitizationAdvisor
```

要求：

- Tool Calling 前必须完成身份上下文和配额校验。
- RAG 的检索过滤必须带租户、版本、模块和文档状态。
- Audit Advisor 不记录完整敏感内容，默认记录摘要、哈希、Token 和耗时。
- 一个调用链中只保留一套 Tool Calling 主循环。

### 4.3 模型路由

用户不直接选择真实凭据，前端仅选择 `modelProfileId`：

```text
FAST        快速问答、标题、摘要
STANDARD    系统操作和一般工具调用
REASONING   深度分析和复杂报表解释
VISION      支持图片理解
```

后端将模型档案映射到真实供应商凭据：

```text
modelProfileId
  → 模型策略
  → credentialId
  → provider/model/options
```

真实凭据、供应商信息和密钥不得返回普通用户。

---

## 5. 用户与执行上下文

### 5.1 服务端执行上下文

```java
public record AiExecutionContext(
        String tenantId,
        String userId,
        String username,
        String organizationId,
        String departmentId,
        Set<String> roles,
        Set<String> authorities,
        String sessionId,
        String requestId,
        String traceId,
        String clientType,
        Locale locale,
        ZoneId zoneId
) {
}
```

这些字段全部由服务端从登录态生成，禁止由模型、前端 Tool 参数或用户消息传入。

### 5.2 异步上下文传播

若使用异步执行、虚拟线程、线程池或 Reactor，必须显式传播：

- `SecurityContext`
- `TenantContext`
- `UserContext`
- `RequestId / TraceId`
- MDC

业务 Service 不能依赖“碰巧还在同一线程”的 ThreadLocal。

---

## 6. Tool Gateway 设计

### 6.1 工具分层

```text
模型 Tool 定义
    ↓
AuthorizedToolResolver
    ↓
AiToolGateway
    ├─ 权限校验
    ├─ 参数 Schema 校验
    ├─ 风险等级校验
    ├─ 业务对象状态预检
    ├─ Tool 调用审计
    ├─ 结果字段最小化
    └─ ToolResult → MessagePart
    ↓
OA Application Service
```

### 6.2 工具声明

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AiToolDefinition {
    String name();
    String description();
    String[] authorities() default {};
    AiToolRisk risk() default AiToolRisk.READ_ONLY;
    int timeoutSeconds() default 15;
}
```

```java
public enum AiToolRisk {
    READ_ONLY,
    EXPLICIT_UI_SUBMIT,
    CONFIRM_REQUIRED,
    PROHIBITED
}
```

### 6.3 动态工具过滤

工具不能全部暴露给所有用户。每次模型调用前按以下维度过滤：

- 租户是否启用该能力；
- 用户功能权限；
- 当前模块和页面上下文；
- 工具风险级别；
- 模型是否支持对应能力；
- 系统开关和灰度策略；
- 单次最多暴露的工具数量。

```java
public interface AuthorizedToolResolver {
    List<ToolCallback> resolve(AiExecutionContext context);
}
```

权限过滤后仍须在 Tool 执行入口和业务 Application Service 再次校验。

### 6.4 首批工具目录

#### 功能知识与导航

```text
feature.search(query)
feature.describe(featureCode)
feature.get_user_capabilities()
navigation.open(featureCode, routeParams?)
```

#### 工作流与任务

```text
workflow.search_definitions(keyword?)
workflow.prepare_start(definitionCode, knownValues?)
workflow.validate_draft(draftId, values)
workflow.submit_draft(draftId)              EXPLICIT_UI_SUBMIT

task.query_my_tasks(status?, keyword?, page)
task.get_detail(taskId)
task.prepare_approve(taskId, decision, comment?)  CONFIRM_REQUIRED
task.prepare_transfer(taskId, targetUserId)       CONFIRM_REQUIRED
```

#### OA 查询

```text
document.query_mine(...)
meeting.query(...)
attendance.query_month(month?)
leave.query_balance()
urgent.query_mine()
```

#### 报表

```text
report.search(query)
report.describe(reportCode)
report.execute(reportCode, parameters)
report.get_dataset(datasetId, page)
```

禁止通用 `stats_report(module, dimension, range)` 逐渐演变成隐形 SQL 工具。

### 6.5 Tool 返回值

Tool 返回强类型业务结果，不直接返回前端卡片 JSON：

```java
public sealed interface AiToolResult
        permits FeatureResult, FormDraftResult, TaskResult,
                DatasetResult, ActionDraftResult, ErrorResult {
}
```

卡片由服务端组装：

```text
AiToolResult
    ↓
MessagePartAssembler
    ↓
可信 Card Payload
```

模型只能生成解释文本，不能生成：

- `actionId`
- 内部业务 URL
- 任意 `path`
- 权限码
- 可执行脚本
- 数据集访问令牌

---

## 7. 写操作：Prepare → Confirm → Execute

### 7.1 风险等级

| 风险等级 | 示例 | 规则 |
|---|---|---|
| `READ_ONLY` | 查询待办、功能介绍、报表 | 可由 Agent 自动调用 |
| `EXPLICIT_UI_SUBMIT` | 用户填写表单并点击“提交审批” | UI 提交即视为明确授权 |
| `CONFIRM_REQUIRED` | 审批通过、驳回、转办、发布公告 | 必须生成确认卡 |
| `PROHIBITED` | 删除、批量授权、强制结束流程 | 不向 AI 开放 |

### 7.2 持久化动作草稿

禁止内存暂存。使用 PostgreSQL 保存：

```text
ai_action_draft
---------------
id
tenant_id
user_id
session_id
source_message_id
tool_name
action_type
payload_json
payload_hash
target_type
target_id
target_version
expected_status
risk_level
status
idempotency_key
expires_at
confirmed_at
executed_at
result_ref
error_code
error_message
version
created_at
updated_at
```

状态机：

```text
PENDING_CONFIRM
    ├─ CANCELLED
    ├─ EXPIRED
    └─ CONFIRMED
          └─ EXECUTING
                ├─ SUCCEEDED
                └─ FAILED
```

### 7.3 确认接口

```http
POST /api/ai/actions/{actionId}/confirm
Idempotency-Key: <client-generated-key>
```

请求体不得重新提交原始业务参数：

```json
{}
```

执行时必须重新校验：

1. `tenant_id + user_id + session_id` 归属；
2. 动作仍为 `PENDING_CONFIRM`；
3. 未过期、未使用；
4. 当前用户仍有功能权限；
5. 当前数据权限仍允许访问目标对象；
6. 业务对象版本与预览时一致；
7. 业务状态仍允许操作；
8. 参数哈希未变化；
9. 幂等键未执行过。

### 7.4 TOCTOU 与乐观锁

生成确认卡时保存：

```text
targetId
targetVersion
expectedStatus
payloadHash
```

确认执行时出现状态变化，应返回：

```json
{
  "code": "AI_ACTION_STALE",
  "message": "该任务状态已经变化，请重新查询后再操作。"
}
```

不得静默按照旧状态继续执行。

---

## 8. 审批表单卡片

### 8.1 表单来源

正式字段、规则和校验必须来自现有 OA 表单引擎，LLM 只能：

- 识别审批定义；
- 提取用户已提供的信息；
- 预填字段；
- 询问缺失字段；
- 对用户输入做自然语言解释。

LLM 不得：

- 新建正式表单字段；
- 修改校验规则；
- 决定审批人；
- 修改流程路由；
- 绕过字段权限。

### 8.2 表单草稿流程

```text
用户表达申请意图
    ↓
workflow.search_definitions
    ↓
workflow.prepare_start
    ↓
服务端创建 form_draft
    ↓
返回 FormCard
    ↓
用户填写并提交
    ↓
FormService 完整校验 + 字段权限校验
    ↓
Flowable 创建流程实例
    ↓
返回 ApprovalInstanceCard
```

### 8.3 字段权限

FormCard 只返回用户有权查看和编辑的字段：

```json
{
  "visibleFields": ["leaveType", "startTime", "endTime", "reason"],
  "editableFields": ["leaveType", "startTime", "endTime", "reason"],
  "maskedFields": []
}
```

---

## 9. 对话与消息协议

### 9.1 REST 接口

```text
POST   /api/ai/chat/messages
GET    /api/ai/sessions
POST   /api/ai/sessions
GET    /api/ai/sessions/{id}/messages
DELETE /api/ai/sessions/{id}
POST   /api/ai/actions/{actionId}/confirm
POST   /api/ai/actions/{actionId}/cancel
POST   /api/ai/attachments
GET    /api/ai/model-profiles
```

发送消息：

```json
{
  "sessionId": "ses_xxx",
  "clientMessageId": "01J...",
  "message": "帮我发起采购审批，预算 12 万",
  "modelProfileId": "STANDARD",
  "attachmentIds": [],
  "pageContext": {
    "featureCode": "WF_MY_TODO",
    "entityType": null,
    "entityId": null
  }
}
```

### 9.2 SSE 事件

V2 将 SSE 纳入 MVP，不使用最长 60 秒的纯阻塞请求作为正式方案。

```text
message.started
message.text.delta
tool.started
tool.completed
tool.failed
message.part.created
action.status.changed
message.completed
message.failed
```

事件格式：

```json
{
  "sessionId": "ses_xxx",
  "messageId": "msg_xxx",
  "sequence": 8,
  "type": "tool.started",
  "timestamp": "2026-07-11T13:30:00Z",
  "payload": {
    "toolCallId": "tc_xxx",
    "displayName": "正在查询我的待办"
  }
}
```

不得向前端输出模型私有思维过程，只输出可理解的执行状态。

### 9.3 消息 Part 协议

```java
public sealed interface MessagePart
        permits TextPart, NavigatePart, FormPart, ConfirmPart,
                ListPart, ChartPart, ApprovalPart, ErrorPart {
}
```

每个 Part 必须包含：

```text
partId
partType
schemaVersion
payload
sequenceNo
```

---

## 10. 卡片协议

### 10.1 卡片类型

| 类型 | 用途 |
|---|---|
| `navigate` | 打开受控功能页面 |
| `form` | 对话内表单 |
| `confirm` | 高风险动作确认 |
| `list` | 待办、公文、会议等列表 |
| `chart` | 受限图表 |
| `approval` | 流程实例结果 |
| `status` | 工具或动作状态 |
| `error` | 可恢复的错误反馈 |

### 10.2 受控导航

禁止由模型提供任意路径，使用：

```json
{
  "type": "navigate",
  "payload": {
    "featureCode": "WF_TASK_DETAIL",
    "routeParams": {
      "taskId": "task_xxx"
    },
    "title": "查看待办详情"
  }
}
```

前端通过 `FeatureRouteRegistry` 映射路由，后端校验 `featureCode` 和参数 Schema。

### 10.3 确认卡

```json
{
  "type": "confirm",
  "schemaVersion": 1,
  "payload": {
    "actionId": "act_xxx",
    "title": "确认通过采购审批",
    "summary": "将通过“研发部笔记本采购申请”",
    "displayParams": [
      {"label": "申请人", "value": "张三"},
      {"label": "金额", "value": "¥120,000"},
      {"label": "审批意见", "value": "同意"}
    ],
    "riskLevel": "CONFIRM_REQUIRED",
    "expiresAt": "2026-07-11T14:00:00Z"
  }
}
```

`displayParams` 仅用于展示，执行参数从服务端 `ai_action_draft` 获取。

### 10.4 表格卡

```json
{
  "type": "list",
  "payload": {
    "title": "我的紧急待办",
    "columns": [
      {"key": "title", "label": "事项"},
      {"key": "priority", "label": "优先级"},
      {"key": "arrivedAt", "label": "到达时间"}
    ],
    "rows": [],
    "page": {"current": 1, "size": 20, "total": 0},
    "moreFeatureCode": "WF_MY_TODO"
  }
}
```

默认最多内嵌 20 行；更多数据使用分页或数据集接口。

### 10.5 图表卡

```json
{
  "type": "chart",
  "payload": {
    "title": "本月审批量按流程统计",
    "datasetId": "ds_xxx",
    "spec": {
      "chartType": "bar",
      "categoryField": "processName",
      "series": [
        {"field": "count", "name": "审批量"}
      ]
    }
  }
}
```

限制：

- `chartType` 仅允许 `bar|line|pie`；
- 字段必须存在于数据集；
- 禁止任意 JavaScript formatter；
- 禁止任意 URL 和事件脚本；
- 类目数量默认不超过 50；
- 敏感字段不得进入数据集。

---

## 11. 报表与数据集

### 11.1 报表目录

采用固定 `reportCode`，每个报表明确：

```text
report_code
name
description
parameter_schema
required_authorities
data_scope_strategy
allowed_dimensions
allowed_metrics
max_date_range
max_rows
supports_chart
supports_export
status
version
```

示例：

```text
APPROVAL_COUNT_BY_PROCESS
APPROVAL_DURATION_BY_DEPARTMENT
DOCUMENT_COUNT_BY_TYPE
ATTENDANCE_RATE_BY_DEPARTMENT
MEETING_ROOM_USAGE
```

### 11.2 数据集

大于卡片容量的数据不直接写入聊天消息：

```text
ai_dataset
----------
id
tenant_id
user_id
session_id
report_code
query_hash
schema_json
row_count
storage_ref
expires_at
created_at
```

数据集访问必须再次校验用户和租户，默认短期过期。

### 11.3 急事排序

急事优先级由服务端确定性规则产生，LLM 只负责解释：

```text
加急标记
催办次数
超时程度
截止时间
事项类型权重
是否今日会议
是否未读待阅
```

排序规则应版本化并可测试：

```text
urgent_rule_version = v1
```

---

## 12. 功能知识与 RAG

### 12.1 Feature Catalog

菜单树不能替代完整功能知识。建设结构化功能目录：

```text
ai_feature_catalog
------------------
feature_code
module_code
name
description
route_code
required_authorities
supported_actions
related_form_codes
related_process_codes
keywords
system_version
status
updated_at
```

职责：

- 回答系统“有什么功能”；
- 判断用户是否可进入；
- 生成受控导航卡；
- 关联可执行 Tool。

### 12.2 RAG 文档

用于：

- 用户手册；
- 制度说明；
- 流程规则；
- 字段解释；
- 常见问题；
- 版本更新说明。

检索必须带元数据过滤：

```text
tenantId
systemVersion
moduleCode
featureCode
documentStatus
visibility
```

RAG 内容必须明确包裹为“参考资料”，不得作为系统指令执行。

### 12.3 引用

功能解释应尽可能返回引用：

```json
{
  "sourceType": "FEATURE_CATALOG|DOCUMENT",
  "sourceId": "doc_xxx",
  "title": "采购审批操作说明",
  "version": "2026.07"
}
```

---

## 13. 会话、历史与记忆

### 13.1 概念分离

| 类型 | 作用 | 是否完整进入模型 |
|---|---|---|
| 会话历史 | 用户查看与审计 | 否 |
| 短期上下文 | 当前对话理解 | 按 Token 预算 |
| 结构化摘要 | 压缩早期上下文 | 是 |
| 工作状态 | 当前表单、报表、筛选条件 | 按需 |
| 长期偏好 | 常用模块、显示偏好 | 相关时检索 |
| 业务事实 | 待办、余额、流程状态 | 必须实时 Tool 查询 |

### 13.2 上下文装配

```text
固定系统策略
+ 当前用户能力摘要
+ 页面上下文
+ 当前工作状态
+ 结构化会话摘要
+ 最近消息（按 Token 预算）
+ 本轮 RAG 资料
+ 相关长期偏好
```

不能使用固定“最近 20 条”作为唯一规则，应按 Token 预算裁剪。

### 13.3 结构化摘要

```json
{
  "userGoal": "分析本月审批情况",
  "activeEntities": {
    "departmentId": "D001",
    "dateRange": "2026-07"
  },
  "resolvedReferences": {
    "再按部门分一下": "沿用上一轮审批统计条件"
  },
  "openQuestions": [],
  "completedActions": []
}
```

摘要表保存：

```text
summary_version
summarized_until_message_id
source_message_count
created_at
```

### 13.4 长期记忆

```text
ai_user_memory
--------------
id
tenant_id
user_id
memory_type        EXPLICIT|INFERRED|SYSTEM_PREF
memory_key
memory_value
source_message_id
confidence
expires_at
status
created_at
updated_at
```

要求：

- 用户可查看和删除；
- 推断记忆可关闭；
- 不保存密码、Token、身份证号、工资、处分、医疗、人事敏感数据；
- 不把所有记忆无条件注入系统 Prompt；
- 业务实时状态不得从记忆回答。

---

## 14. 数据模型

### 14.1 会话

```text
ai_chat_session
---------------
id
tenant_id
user_id
title
status
model_profile_id
summary_version
last_message_seq
version
created_at
updated_at
last_message_at
deleted_at
```

### 14.2 消息

```text
ai_chat_message
---------------
id
tenant_id
user_id
session_id
client_message_id
sequence_no
role                USER|ASSISTANT
status              PENDING|STREAMING|COMPLETED|FAILED|CANCELLED
content_text
model_profile_id
input_tokens
output_tokens
request_id
trace_id
created_at
completed_at
```

### 14.3 消息 Part

```text
ai_chat_message_part
--------------------
id
message_id
part_type
schema_version
payload_json
sequence_no
created_at
```

### 14.4 Tool 调用

```text
ai_tool_call
------------
id
tenant_id
user_id
session_id
message_id
tool_call_id
tool_name
risk_level
arguments_hash
arguments_summary
result_summary
status
duration_ms
request_id
trace_id
error_code
created_at
completed_at
```

敏感参数和完整业务结果默认不落库；确有审计要求时采用字段脱敏、加密和独立保留策略。

### 14.5 会话状态

```text
ai_conversation_state
---------------------
session_id
tenant_id
user_id
state_json
version
updated_at
```

---

## 15. 会话并发与幂等

### 15.1 消息幂等

前端每条消息生成 `clientMessageId`。数据库建立唯一约束：

```text
unique(tenant_id, user_id, client_message_id)
```

网络重试时返回原消息状态，不重复触发模型调用。

### 15.2 会话串行化

同一会话默认同一时刻仅允许一个活跃 Agent 请求：

```text
IDLE → RUNNING → IDLE
```

后续消息可：

- 排队；
- 明确取消当前请求后执行；
- 创建新会话。

不能让两个并发 Agent 同时读取旧上下文后交叉写入。

### 15.3 乐观锁

`ai_chat_session.version` 和 `last_message_seq` 用于保证消息顺序与摘要一致性。

---

## 16. 前端设计

### 16.1 全局入口

- 全局悬浮入口挂载于 `AppLayout`；
- 桌面端使用非模态侧边面板；
- 移动端使用全屏面板；
- 宽度支持拖拽并本地保存；
- 支持会话列表、新建、切换和删除；
- 支持显示当前页面上下文。

### 16.2 组件结构

```text
web/src/features/ai-assistant/
├── api/
├── components/
│   ├── AssistantPanel.tsx
│   ├── MessageList.tsx
│   ├── Composer.tsx
│   ├── ToolStatus.tsx
│   └── cards/
│       ├── NavigateCard.tsx
│       ├── FormCard.tsx
│       ├── ConfirmCard.tsx
│       ├── ListCard.tsx
│       ├── ChartCard.tsx
│       ├── ApprovalCard.tsx
│       └── ErrorCard.tsx
├── hooks/
├── store/
├── protocol/
└── route-registry/
```

### 16.3 安全渲染

- Markdown 必须 sanitize；
- 禁止执行 HTML 脚本；
- 卡片按白名单 `partType` 渲染；
- 未知 `schemaVersion` 使用降级组件；
- 路由使用 `featureCode` 映射，不执行任意 URL；
- 图表仅接受受限 Spec；
- 所有写操作按钮显示明确对象、参数和风险语义。

---

## 17. 附件与多模态

### 17.1 上传流程

```text
前端上传
→ 文件服务鉴权
→ MIME/扩展名/大小校验
→ 病毒扫描和解码检查
→ 返回 fileId
→ 聊天消息仅传 attachmentIds
```

禁止将大图 Base64 `dataUrl` 直接存入消息表。

### 17.2 首批支持

```text
图片：png / jpg / webp，单文件 ≤ 5MB
文本：txt / md / csv / json / log，单文件 ≤ 1MB
```

还应限制：

- 图片最大像素；
- 文本最大解析字符数；
- 单消息附件数量；
- 文件保留期；
- 租户隔离；
- 模型数据驻留策略。

### 17.3 防护

- 不允许模型访问用户提供的任意远程 URL；
- 防止 SSRF；
- 附件内容视为不可信数据；
- 附件中的“系统指令”不能触发写操作；
- 敏感文件按企业 DLP 规则限制发送到外部模型。

---

## 18. 配额、限流与成本治理

### 18.1 使用权限

建议增加：

```text
ai:assistant:use
```

并支持租户级功能开关和灰度发布。

### 18.2 限制项

```text
每用户并发请求数
每分钟请求数
每日输入/输出 Token
每租户月度预算
单请求最大 Tool 步数
单请求最大模型调用次数
单 Tool 最大耗时
单 Tool 最大返回大小
单报表最大日期范围和行数
单消息最大附件数
```

### 18.3 降级策略

- 高级模型不可用时降级到标准模型；
- Tool 查询失败时返回可恢复错误卡；
- 模型不可用不影响用户通过正常 OA 页面操作；
- 不对写操作进行不透明的自动重试；
- 查询类 Tool 重试必须有次数和超时上限。

---

## 19. 可观测性与审计

### 19.1 统一关联标识

```text
requestId
traceId
sessionId
messageId
toolCallId
actionId
businessId
processInstanceId
```

### 19.2 指标

```text
AI 请求数量 / 成功率 / P50 P95 P99
模型首字耗时 / 完整响应耗时
Tool 调用次数 / 成功率 / 耗时
确认卡创建 / 确认 / 取消 / 过期数量
Token 与模型成本
RAG 命中率和引用率
403 / 数据权限拒绝率
用户取消率
消息重试率
```

### 19.3 审计最小化

默认记录：

- 工具名称；
- 参数哈希与脱敏摘要；
- 结果摘要；
- 当前权限快照摘要；
- 数据权限策略编号；
- 执行耗时和结果；
- 业务对象 ID；
- 用户是否确认。

禁止默认记录完整敏感表单、附件全文或大规模数据集。

---

## 20. 数据保留与隐私

### 20.1 删除语义

区分：

```text
用户删除       从用户界面隐藏或软删除
合规清理       按保留策略物理清理
审计记录       独立保留，正文最小化
```

### 20.2 建议保留策略

具体期限由企业制度配置，至少分别管理：

- 普通会话正文；
- Tool 审计；
- 写操作审计；
- 附件；
- 数据集；
- 用户长期记忆。

管理员是否可查看员工对话、查看范围和审批流程必须有明确制度和审计记录。

---

## 21. 后端模块划分

```text
ai-assistant
├── ai-api
│   ├── chat
│   ├── session
│   ├── action
│   └── attachment
├── ai-application
│   ├── AiChatApplicationService
│   ├── AiActionApplicationService
│   └── AiSessionApplicationService
├── ai-orchestration
│   ├── ChatClientConfiguration
│   ├── advisor
│   ├── context
│   └── model-routing
├── ai-tool
│   ├── registry
│   ├── permission
│   ├── gateway
│   ├── result
│   └── tools
├── ai-message
│   ├── protocol
│   ├── assembler
│   └── persistence
├── ai-memory
│   ├── chat-memory
│   ├── summary
│   ├── state
│   └── user-memory
├── ai-knowledge
│   ├── feature-catalog
│   ├── rag
│   └── document-index
├── ai-security
│   ├── execution-context
│   ├── prompt-boundary
│   └── data-minimization
├── ai-observability
│   ├── metrics
│   ├── tracing
│   └── audit
└── ai-infrastructure
    ├── persistence
    ├── vector-store
    ├── redis
    └── file-service
```

---

## 22. 错误码

```text
AI_SESSION_NOT_FOUND
AI_SESSION_BUSY
AI_MESSAGE_DUPLICATE
AI_MODEL_UNAVAILABLE
AI_MODEL_NOT_ALLOWED
AI_QUOTA_EXCEEDED
AI_TOOL_NOT_ALLOWED
AI_TOOL_TIMEOUT
AI_TOOL_INVALID_ARGUMENT
AI_DATA_SCOPE_DENIED
AI_ACTION_NOT_FOUND
AI_ACTION_EXPIRED
AI_ACTION_ALREADY_EXECUTED
AI_ACTION_STALE
AI_ACTION_CONFIRM_REQUIRED
AI_ATTACHMENT_NOT_SUPPORTED
AI_ATTACHMENT_TOO_LARGE
AI_RAG_NO_RESULT
```

错误返回应区分：

- 用户可修复；
- 需要重新查询；
- 权限不足；
- 系统暂时不可用；
- 已成功但响应丢失，可查询结果。

---

## 23. 测试与验收

### 23.1 单元测试

- Tool 权限过滤；
- 风险分级；
- 参数 Schema 校验；
- 数据脱敏；
- Action 状态机；
- 幂等执行；
- 乐观锁和过期；
- 卡片 Schema；
- 报表参数白名单；
- 摘要游标。

### 23.2 集成测试

1. 无权限工具不会暴露给模型。
2. 强行构造 Tool 名称仍被 Gateway 拒绝。
3. 数据权限仅返回当前范围数据。
4. 异步执行下用户和租户上下文不丢失。
5. 写动作不确认绝不执行。
6. 双击确认只执行一次。
7. 目标业务状态变化后返回 `AI_ACTION_STALE`。
8. A 用户无法读取 B 用户会话、动作、附件和数据集。
9. 同一 `clientMessageId` 重试不重复调用模型。
10. 同一会话并发消息不会交叉写入。

### 23.3 提示注入测试

覆盖：

- 用户要求忽略系统规则；
- RAG 文档含恶意指令；
- Tool 数据字段含恶意指令；
- TXT/Markdown 附件要求调用写工具；
- 诱导泄露系统 Prompt、权限码或其他租户数据；
- 诱导模型生成管理员路由；
- 诱导模型扩大报表范围。

验收标准：所有攻击均不能突破 Tool 白名单、功能权限、数据权限和写操作确认。

### 23.4 核心业务验收

- “我能使用哪些功能”只展示当前用户可用能力。
- “我要请假”返回真实表单定义并正确预填。
- “同意这个任务”生成确认卡，不确认不执行。
- 用户确认后 Flowable 任务仅完成一次。
- “本月审批量按流程统计”返回固定报表和图表卡。
- “再按部门分一下”正确沿用上一轮上下文。
- 新会话不串联上一会话临时状态。
- “看全公司请假统计”严格按数据权限返回或拒绝。

---

## 24. 实施批次

### P0：安全可用基础

- AI 数据表和租户隔离；
- Spring AI 2 `ChatClient` 与 Advisor 链；
- SSE 消息协议；
- 会话管理和消息幂等；
- Tool Registry、动态权限过滤和 Gateway；
- 查询待办、我发起、功能介绍；
- Feature Catalog；
- Action Draft 持久化状态机；
- 确认卡、列表卡、导航卡；
- 全链路审计和配额。

### P1：审批与报表

- 流程定义识别；
- 对话内 FormCard；
- Flowable 发起流程；
- 任务通过、驳回和转办；
- 报表目录、数据集和 ChartCard；
- 急事排序服务；
- RAG 用户手册。

### P2：记忆与多模态

- Token 预算上下文；
- 结构化滚动摘要；
- 工作状态；
- 可管理的长期偏好；
- 图片和文本附件；
- 模型档案切换。

### P3：高级能力

仅在出现明确需求后评估：

- 复杂公文生成；
- 深度经营分析；
- 多 Agent 协作；
- 独立 AgentScope 服务；
- MCP 企业工具中心。

不得为了“看起来更 Agent”而在核心 OA 操作链路叠加第二套编排、记忆和状态系统。

---

## 25. 核心决策总结

```text
主 AI 框架          Spring AI 2
正式业务流程        Flowable 8
权限                Spring Security + 现有数据权限
AI 编排              ChatClient + Advisor + Tool Calling
Tool 策略            动态过滤 + Gateway + 业务 Service 二次校验
写操作               Prepare / Confirm / Execute
确认状态             PostgreSQL 持久化，不使用内存
卡片来源             服务端可信 Assembler
导航                 featureCode，不接受任意 path
图表                 reportCode + datasetId + 受限 spec
会话                 PostgreSQL 完整历史
模型上下文           Token 预算 + 结构化摘要
长期记忆             可查看、可删除、按需检索
传输                 REST + SSE
模型选择             modelProfileId，不暴露 credentialId
AgentScope           不进入首期主链路
```

---

## 26. Spring AI 2 官方参考

- Spring AI Reference：`https://docs.spring.io/spring-ai/reference/`
- Chat Client API：`https://docs.spring.io/spring-ai/reference/api/chatclient.html`
- Advisors API：`https://docs.spring.io/spring-ai/reference/api/advisors.html`
- Tool Calling：`https://docs.spring.io/spring-ai/reference/2.0-SNAPSHOT/api/tools.html`
- Recursive Advisors：`https://docs.spring.io/spring-ai/reference/2.0-SNAPSHOT/api/advisors-recursive.html`
- Chat Memory：`https://docs.spring.io/spring-ai/reference/api/chat-memory.html`
- Retrieval Augmented Generation：`https://docs.spring.io/spring-ai/reference/api/retrieval-augmented-generation.html`
- Structured Output：`https://docs.spring.io/spring-ai/reference/2.0-SNAPSHOT/api/structured-output.html`
- Observability：`https://docs.spring.io/spring-ai/reference/observability/index.html`


---

## 附:主控裁定(2026-07-11,用户已确认)

1. **节奏=渐进式 4 批,每批行为兼容可用**:
   - **批A(安全与协议核心)**:ai_action_draft 持久化状态机(替换内存 confirm,TOCTOU/幂等键)、
     消息幂等(clientMessageId 唯一)、会话串行化(AI_SESSION_BUSY)、消息 Part 化
     (ai_chat_message_part)、ai_tool_call 审计表、**SSE**(message.started/tool.*/part.created/
     completed)、错误码表(§22)。前端 SSE 消费+Part 渲染。
   - **批B(Spring AI 2 接入)**:ChatClient+Advisor 链(Security/Memory/Quota/Audit)替换助手侧
     LlmToolLoop;工具迁 @AiToolDefinition(authorities/risk/timeout)+AuthorizedToolResolver+
     AiToolGateway 风险分级;模型档案 model_profile(映射 orch_credential,不暴露凭据)。
   - **批C(知识与报表)**:ai_feature_catalog(种子自 menu 生成+校验)、featureCode 受控导航
     (FeatureRouteRegistry)、报表目录 report_catalog+ai_dataset(替换 stats_report)、pageContext。
   - **批D(记忆与附件)**:Token 预算上下文+结构化摘要(游标)、ai_user_memory 长期记忆(可查删)、
     ai_conversation_state 工作状态、附件 fileId 化(清洗存量 dataURL)、RAG(pgvector,P1 末)。
2. **Spring AI 2 仅用于助手**(GA 已核验:2.0.0,SB4 基线);编排 llm/agent 节点保持 LlmToolLoop。
3. **tenant_id 预留列**(常量 'default'),不做全局多租户;Spring Authorization Server **不引入**;
   OTel 列 P3(先业务审计表+指标);报表目录直接改造现有 4 统计;Feature Catalog 种子自 menu.ts
   生成 + 校验脚本防漂移;向量库选 pgvector(批D)。
