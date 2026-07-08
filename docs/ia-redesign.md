# 流程中心信息架构重构（IA Redesign）

> 状态：方案已确认，**待 P2 前端完成后实施**（改动涉及 todo/done/mine/instance-detail/admin，与 P2 前端 agent 冲突，故错峰）。
> 用户确认的决策：① 审批中心整体退役并入流程中心（旧 oa_approval 后端保留不动，仅收前端入口）；② **我的审批 = 待办/待阅/已办/我发起/草稿/我的委托 六 Tab 合一**（暂存、代理委托、待阅一并并入合并页）；③ 流程监控 = 监控+治理合并一个模块。

## 目标菜单结构（流程中心，7→5 项）
```
流程中心
├─ 我的审批   /workflow/tasks     六 Tab（见下）  ← 徽标(待办数)打这
├─ 发起申请   /workflow/start      卡片墙选流程，动作入口保持独立
├─ 流程监控   /workflow/monitor    Tab：运行总览 | 实例管理(治理+交接)
├─ 流程定义   /workflow/defs
└─ 表单定义   /workflow/form-defs
```
**移除**：整个「审批中心」菜单(/approval/*)；流程中心的 todo/done/mine/cc/draft/delegate 六个独立菜单；「流程治理」/workflow/admin（并入 monitor）。

## 我的审批合并页 Tab（/workflow/tasks）
| Tab | 内容 | 数据源 |
|---|---|---|
| 待办 | 待我处理（含分组认领 claim） | `GET /tasks/todo` |
| 待阅 | 抄送/知会我，突出未读；打开记已读 | `GET /instances/cc`（read_flag 筛选） |
| 已办 | 我处理过的历史任务 | `GET /tasks/done` |
| 我发起 | 我发起的实例（撤销/查看/追踪） | `GET /instances/my` |
| 草稿 | 暂存待提交（继续编辑/提交/删除） | `GET /instances/drafts` |
| 我的委托 | 代理/委托规则设置（新建/删除/启停） | `GET/POST/DELETE /delegate-rules` |

- URL 同步 `?tab=todo|cc|done|mine|draft|delegate`。
- 待办徽标仅计 `todo`；待阅未读数可在 Tab 上加小红点。

## 实施清单（P2 完成后执行）
1. **menu.ts**：删审批中心一级节点；流程中心 children 重组为上述 7 项（icon：我的审批=Inbox、监控=Activity/Gauge）。
2. **新建 src/pages/workflow/tasks.tsx**：六 Tab 容器，复用现有 todo/done/mine/cc/draft/delegate 六页逻辑（抽为子组件 `<TodoList>/<CcList>/<DoneList>/<MineList>/<DraftList>/<DelegatePanel>` 或内联）；共享顶部搜索栏；URL 同步 `?tab=todo|cc|done|mine|draft|delegate`；待阅/待办 Tab 显未读小红点。原六个页面文件降为子组件或删除。
3. **改造 admin.tsx → monitor.tsx**（或新建）：
   - 运行总览 Tab：状态计数卡片(运行中/已通过/已驳回/已终止/超时) + 状态分布 + 节点瓶颈(各节点平均停留时长)。
   - 实例管理 Tab：全实例列表(GET /instances/admin，P2 已做) + 行进详情做治理操作 + 离职交接入口(POST /wf/handover)。
   - 非管理员：permission-banner 无权限提示。
4. **App.tsx 路由**：
   - 加 /workflow/tasks、/workflow/monitor。
   - /workflow/{todo,done,mine,cc} → `<Navigate to="/workflow/tasks?tab=...">` 重定向兜底（避免旧链接 404）。
   - /approval、/approval/* → `<Navigate to="/workflow/tasks">` 重定向；审批中心页面文件(approval/*.tsx)可保留(不再挂菜单)或删除。
   - 保留 /workflow/instances/:id。
5. **dashboard 工作台**：待办卡片/快捷入口指向 /workflow/tasks；待办数徽标源改为 /api/wf/tasks/todo 计数(P1 已有 pending-count 机制，切换数据源)。
6. **badge-store / app-layout**：待办徽标绑定「我的审批」路径。

## 需补的后端接口（IA 实施时，若 P2 未覆盖）
- `GET /api/wf/monitor/overview` → `{running,approved,rejected,terminated,timeout, byDef:[{defName,count}]}` 状态与流程维度计数。
- `GET /api/wf/monitor/bottleneck` → `[{defName,nodeName,avgDurationMs,count}]`（从 ACT_HI_ACTINST 聚合各节点平均停留）。
- 管理员实例列表 `GET /api/wf/instances/admin`（P2 已做，直接复用）。
- 旧 `oa_approval` 接口保留不动（不迁移、不删除，仅前端不再有入口）。

## 验收
- 菜单只剩「流程中心」一套审批入口，无「审批中心」；我的审批四 Tab 切换正常、徽标准确；监控总览统计+实例管理可用；旧路径重定向不 404；tsc+build 通过；浏览器截图巡检。
