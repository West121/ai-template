# AI 助手·受控管理操作框架

> 用户裁定(2026-07-12):AI 助手放开**常用增改**(新增/编辑,不含删除/改权限)+**确认卡二段式**+**严格权限继承**;覆盖组织人事/流程表单单据/办公,且**新业务自动纳入,不需逐个指定**。

## 0. 核心问题与红线

用户觉得 AI"限定太死"(只查询/发起审批,不能新增用户等管理操作)。放开管理写操作,但守红线:
- **权限继承**:操作声明 requiredAuthority,`⊆ 当前用户权限`才暴露给模型(没权限的用户 AI 里看不到该操作)。
- **确认卡二段式**:AI 不直接写,生成表单卡(填字段)→确认卡→复用批A 动作草稿状态机执行(TOCTOU/幂等/重新鉴权)。
- **不是通用 SQL/万能 API**:每个操作是**预注册**的,绑定具体业务 Service 方法 + 表单 schema;AI 只能填 schema 内字段,不能注入任意字段/表/SQL(延续 §11.1 报表红线的思路)。
- **首期不开**:删除、改权限、批量授权、重置密码(高危);风险级 PROHIBITED,不注册即可,后续单独评估。

## 1. 可扩展注册(关键:新业务自动纳入)

**`AiManagedAction` 描述符**(每个业务模块声明,类似 report_catalog/feature_catalog 白名单模式):
```
actionCode      唯一(如 system.user.create / workflow.def.create)
module          所属模块(system/workflow/office/bizdoc/…)
entityLabel     实体人话名("用户"/"部门"/"流程定义")
action          CREATE | UPDATE
label           "新增用户"/"编辑部门"
formSchema      表单 schema(复用现有 form-renderer widgets;或引用已有业务表单)
requiredAuthority  功能权限码(如 system:user:add)
risk            EXPLICIT_UI_SUBMIT(表单提交即授权)| CONFIRM_REQUIRED
handlerBean/method 绑定的业务 Service 方法(反射调用,走 @PreAuthorize/校验/事务)
updateLoader    UPDATE 时按 id 载入现值预填(可选)
```

**注册方式**(二选一,新业务零改 AI 核心):
- 注解 `@AiManaged(actionCode, entityLabel, action, authority, risk, formRef)` 标在业务 Service 方法上,启动扫描进注册表;
- 或各模块提供 `AiManagedActionProvider` bean 返回描述符列表。
- **新业务只要注册描述符 → AI 自动发现**(不改 ToolRegistry/AiChatService)。

## 2. 通用工具(3 个,替代给每个业务写工具)

- `manage_list_actions(keyword?, module?)`:返回**当前用户有权**的管理操作(按 requiredAuthority⊆权限过滤)。
- `manage_prepare(actionCode, knownValues?, targetId?)`:选定操作→服务端产**表单卡**(formSchema + 已知值预填,UPDATE 按 targetId 载现值);字段权限/校验来自业务表单引擎。
- 提交→`manage_submit` / 复用批A 动作草稿:表单卡提交→(CONFIRM_REQUIRED 再出确认卡)→`POST /api/ai/actions/{id}/confirm`→**AiManagedGateway 反射调 handlerBean.method**(当前用户 UserContext→业务 Service @PreAuthorize/数据权限/事务全走一遍,二次鉴权)。

AI 交互:"新增一个用户"→manage_list_actions 命中 system.user.create(有权限)→manage_prepare 出用户表单卡→填→确认→建用户。**"以后新业务"**:该业务注册 AiManagedAction 后,同样话术自动可用。

## 3. 首期注册的操作(批次)

- **批M1 框架 + 组织人事**:框架(注册表/3 工具/Gateway/确认链)+ system.user.create/update、dept.create/update、role.create/update、post.create/update(复用 SysXxxController 的 create/update + 现有表单字段;requiredAuthority=各自 system:xxx:add/edit)。
- **批M2 定义管理**:workflow.def(流程定义启停/创建入口)、form.def、bizdoc.def/tpl —— 多为"生成草稿→去设计器"(复用批E prepare_flow/template 思路)或启停开关。
- **批M3 办公**:announcement.create(发公告)、meeting.create(排会议)、schedule.create(建日程)——走确认卡。
- **新业务**:注册即纳入,无需新批次。

## 4. 前端

- 复用现有 form 卡(表单填写)+ confirm 卡(确认)+ 动作草稿链(批A);manage 操作产的表单卡/确认卡走同一渲染。
- 新增轻量:AI 提示"我可以帮你新增用户/部门…"(manage_list_actions 结果),点击唤起对应表单卡。
- 权限:后端已按 requiredAuthority 过滤,前端只渲染返回的操作(无权限的不出现)。

## 5. 安全论证(为何不破红线)

- 操作白名单(预注册),AI 只在名单内选;字段限 formSchema;handler 绑定具体 Service(过 @PreAuthorize/校验/事务)。
- 权限继承(requiredAuthority)+ 确认二段式(动作草稿 TOCTOU/幂等/重新鉴权)+ 不开删除/授权。
- 审计:manage 操作走 ai_tool_call + 动作草稿审计(谁/何操作/参数摘要/结果)。
