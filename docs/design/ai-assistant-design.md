# AI 智能助手(对话式系统 Agent)设计

> 主控裁定契约。目标:全局对话式助手——介绍功能、快速导航、以对话操作系统数据(CRUD)、
> 发起审批(对话内表单卡片)、查待办/筛选急事、出报表图表;**严格受当前用户功能权限与数据权限约束**;
> 有会话历史与上下文记忆。

## 0. 安全红线(压倒一切)

1. **工具以当前用户身份执行**:所有工具一律是**既有受保护 Service/API 的包装**,执行时携带当前
   用户 UserContext(JWT 会话内)→ `@PreAuthorize` 功能权限与 JPA Specification 数据权限**天然生效**。
   绝不直连 DB、绝不以系统身份代查。无权限时工具返回 403 语义,助手礼貌告知并解释缺什么权限。
2. **写操作必须确认**:增/删/改/发起审批等一切变更类工具,agent 只能产出**确认卡片**(展示将执行的
   操作与参数),用户点击「确认」后前端再调专门的 confirm 端点执行——LLM 无法直接落库,杜绝幻觉误操作。
3. **提示注入防护**:系统提示服务端锁定;工具结果以数据帧回填(标注 role=tool),不当指令解析;
   助手不执行"忽略以上规则"类指令。
4. **全程审计**:会话/消息全落库;写操作经既有 @OperLog;工具调用留痕(名称/参数/结果摘要/耗时)。
5. LLM 凭据复用 `orch_credential`(LLM 型);系统级配置一条默认凭据(`ai_assistant.credential_id`)。

## 1. 总体架构

```
前端 全局悬浮助手(所有页挂载) ──POST /api/ai/chat──▶ AiChatService(agent 循环)
  ▲ 渲染 text + cards                                   │ OpenAI function-calling
  │                                                     ▼
  └── 卡片动作(navigate/确认/表单提交) ◀── ToolRegistry(全部包装既有 Service,带 UserContext)
会话/消息/摘要: ai_chat_session / ai_chat_message(用户隔离)
```

- **MVP 非流式**:一次请求内后端跑完 agent 循环(maxSteps≤8)返回完整回复;前端 loading 打字指示。
  SSE 流式列 P1(协议预留:响应已是消息数组,后续改增量推送不破坏契约)。
- agent 循环基建(function-calling、步数护栏、工具留痕)与编排 §9.1 同源,抽公共 `LlmToolLoop` 复用。

## 2. 数据模型(V{next})

- `ai_chat_session`:id/user_id/title(首问摘要)/summary(滚动摘要,超窗压缩)/created_at/updated_at。
- `ai_chat_message`:id/session_id/role(USER|ASSISTANT|TOOL)/content(text)/cards(JSON)/
  tool_calls(JSON,审计)/created_at。索引 (session_id, id)。
- 权限:助手本身登录即用(无新权限码);工具沿用各自模块权限码。

## 3. 对话协议(前后端契约)

`POST /api/ai/chat` req:`{sessionId?, message}`(sessionId 空=新会话)
resp:`{sessionId, messages:[{role:"ASSISTANT", content:markdown, cards?:Card[]}]}`

**Card 类型**(前端渲染系统的核心):
| type | 载荷 | 前端行为 |
|---|---|---|
| `navigate` | `{path, title, desc?}` | 「打开」按钮 → navigate(path)(路径必须在用户可见菜单内,后端校验) |
| `confirm` | `{actionId, title, summary, params 展示}` | 确认/取消按钮 → `POST /api/ai/confirm {actionId}` 执行(actionId 服务端暂存待确认动作,10min 过期,绑定 session+user) |
| `form` | `{defCode, defName, formType, schema?(在线表单 widgets), submitPath?(CODE 表单)}` | 在线表单:卡片内嵌 FormRenderer,填写→提交起流程;CODE 表单:跳转按钮到其发起页 |
| `list` | `{title, columns:[{key,label}], rows, moreLink?}` | 结构化列表卡(待办/公文等),行可带 link |
| `chart` | `{chartType:"bar"|"line"|"pie", title, categories?, series:[{name,data}]}` | 图表卡(轻量 SVG 图表组件,不引重库;丹青出视觉) |
| `link` | `{items:[{title,path}]}` | 相关功能快捷入口 |

## 4. 工具目录(ToolRegistry,首批)

注册机制:`@AiTool(name, description, paramsSchema)` 注解声明,统一收集给 LLM;实现内全部调既有
Service(UserContext 生效)。**只读工具直接执行;变更工具一律产出 confirm 卡。**

**导航/功能知识**
- `list_functions()`:菜单树(过滤为该用户可见项)+ 每项一句话说明 → 介绍功能/推荐入口。
- `open_function(query)`:按名称/意图匹配菜单 → navigate 卡。

**查询(只读,数据权限天然生效)**
- `query_todo(keyword?, pageSize)`:我的待办(含 viewPath)。
- `query_my_instances(status?, keyword?)`:我发起。
- `query_documents(direction?, status?, keyword?)`:公文列表。
- `query_meetings(range?)` / `query_leave_balance()` / `query_attendance(month?)`:会议/假期/考勤。
- `query_urgent()`:急事筛选——聚合待办(超 48h 未办/加急标记/催办)+ 待阅未读 + 今日会议,
  由服务端规则打分排序,LLM 只做呈现与解释(不让 LLM 自己算优先级,保证一致性)。
- `stats_report(module, dimension, range)`:统计聚合(module=approval|document|attendance|meeting…;
  服务端预置聚合查询,带数据权限)→ 返回结构化数据集 → chart/list 卡。首批覆盖:
  审批量按状态/按流程、公文按文种/月份、考勤出勤率、会议室占用。

**变更(confirm 卡二段式)**
- `start_approval(defCode)`:返回 form 卡(在线表单 schema / CODE 表单跳转);表单提交走既有
  `/api/wf/instances`(前端直调,不经 LLM)。
- `approve_task(taskId, decision, comment?)` / `create_schedule(...)` / `create_meeting(...)` /
  `update_announcement_read(...)` 等:产出 confirm 卡 → /api/ai/confirm 执行既有 API。
- 删除类首批**不开放**(风险收益比差,后续白名单逐个放)。

## 5. 记忆与上下文

- **窗口**:每次调用带 系统提示 + session.summary + 近 20 条消息;超窗时后端异步用 LLM 压缩
  更早消息进 summary(滚动摘要)。
- **会话管理**:前端会话列表(近 30 天)、新建/切换/删除;标题=首问自动摘要。
- **用户画像记忆(P1)**:跨会话偏好(常用功能/称呼)存 user 级 kv,注入系统提示。

## 6. 前端(疾风)

- **全局入口**:右下悬浮球(所有页挂载于 AppLayout,登录后可见),点击展开**侧边抽屉对话面板**
  (亦可 ⌘K 集成入口 P1)。offline 降级:提示助手需后端。
- **对话面板**:消息流(markdown 渲染,复用 RichTextViewer 的 sanitize 思路或轻量 md 渲染)+
  六类卡片渲染 + 输入框(Enter 发送)+ 会话列表侧栏 + loading 打字态。
- **卡片组件库** `web/src/components/ai-chat/cards/`:navigate/confirm/form(内嵌 FormRenderer)/
  list/chart(轻量 SVG bar|line|pie)/link。
- 权限体验:403 类回复正常呈现(助手文案解释);表单卡提交后显示「已发起」并附实例链接。

## 7. 后端(磐石)

- `AiChatService`:会话装配(summary+近 N 条)→ LlmToolLoop(function-calling,maxSteps 8,
  单请求超时 60s)→ 工具经 ToolRegistry 执行(UserContext 从请求线程透传;**异步循环内须手动
  传播 UserContext**,这是易错点)→ 落消息 + 返回。
- `AiConfirmService`:待确认动作暂存(内存+过期;actionId=UUID,绑定 user+session,执行时二验权限)。
- `ToolRegistry`:@AiTool 扫描注册;工具 JSON-Schema 自动生成给 LLM;调用留痕。
- 首批工具按 §4 实现(全部包装既有 Service,不写新查询逻辑,除 query_urgent 打分与 stats_report
  聚合是新的薄服务)。
- 系统提示:角色设定(星辰 OA 智能助手)+ 能力边界 + 安全规则 + 当前用户上下文(姓名/部门/角色,
  便于称呼与权限解释)。

## 8. 验收(主控)

- 权限双验:zhangsan 问"看全公司请假统计"→ 数据权限内的结果(或无权提示);无 office:doc:send
  的用户让发公文 → 礼貌拒绝并说明。
- 变更二段式:「帮我把 xx 任务同意了」→ confirm 卡 → 确认后任务真办结;不确认不生效。
- 表单卡:「我要请假」→ 对话内出请假表单卡 → 填写提交 → 实例可在"我发起"看到。
- 急事:「我现在最该处理什么」→ 排序列表卡。
- 报表:「本月审批量按流程统计」→ chart 卡。
- 记忆:多轮指代(「再按部门分一下」)正确;新会话不串上下文;A 用户看不到 B 会话。
- smoke(KEEP=1):chat 基础问答/工具 403/confirm 流转/会话隔离。

## 9. 分工与批次

- **丹青**(先行):对话面板+六类卡片视觉规范(docs/design/ai-assistant-ui-spec.md)。
- **磐石**(编排批4后接):V{next} 迁移+AiChatService/LlmToolLoop/ToolRegistry/Confirm+首批工具+smoke。
- **疾风**(编排批4后接):全局悬浮+对话面板+卡片组件库+会话管理(mock 先行)。
- 主控:集成对账+§8 验收+提交。P1:SSE 流式、⌘K 集成、用户画像记忆、删除类工具白名单。

## 10. 契约补充(丹青 UI 规范 §7 对账,磐石实现时一并落)

- list 卡行支持 `link?`(行级跳转 path);form 卡补 `submitPath?`(CODE 表单)与提交成功返回 `instId`;
  confirm 卡补 `danger?: boolean`(危险操作红色语义);chart pie series 数据项支持 `percent` 展示。
- 前端 UI 规范见 `docs/design/ai-assistant-ui-spec.md`(桌面非模态抽屉/移动全屏、z 层、md 仅助手消息、
  卡片平铺不进气泡、纯 SVG 图表 --chart-1..5、confirm 状态机、.ai-form 单列覆盖)。
