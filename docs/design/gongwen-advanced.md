# 中国式公文管理（发文 / 收文）高级化设计

> 主控裁定契约 · 三端（磐石后端 / 疾风前端 / 丹青版式）共同遵循。用户已定范围：
> **GB/T 9704 标准格式 + 完整办文流转 · 复用现有 Flowable 工作流引擎 · 四项高级能力全上**
> （文号自动生成+台账 / 红头+正文套版+用印 / 收文登记-拟办-批办-传阅-催办 / 密级·紧急·主送抄送+归档卷宗）。

现状：`oa_document` 单表 + 扁平 `status` 字段，无文号规则、无红头版式、无流转、无台账。本设计在其上做**加法演进**（不破坏既有列，新增列与新表），并把办文流程接到 Flowable。

---

## 1. 总体架构

- **办文流程走 Flowable**：新增两个内置流程定义（CODE 表单驱动，非在线设计）：
  - `gw_send`（发文办理单）：拟稿 → 核稿 → 会签(可选) → 签发 → 用印 → 分发/成文。
  - `gw_recv`（收文办理单）：签收登记 → 拟办 → 批办 → 承办 → 传阅(可选) → 办结归档。
  - 复用现有引擎的会签/加签/转办/委托能力（无需公文侧重造）。流程实例的 `businessKey = "GW:" + documentId`，公文与流程双向关联。
- **公文实体是主数据**：`oa_document` 承载公文全字段（GB/T 9704 版式项 + 流转态）；Flowable 只管"谁在哪一步办"。节点办理动作回写公文（意见、签发、用印、文号）。
- **文号在"签发通过"时才正式占号**（拟稿阶段是草稿号/占位），避免作废稿吃号。
- **前端**：发文/收文各一套"办文单"页面（拟稿单 / 登记单 + 办理时间线 + 红头正文预览），接 Flowable 待办；列表页升级为台账（文号台账 / 收文登记簿）。
- **降级**：所有页面遵循项目 offline/NetworkError 降级到 mock 的既有约定。

---

## 2. 数据模型（磐石）

### 2.1 `oa_document` 扩列（迁移 V20，`ALTER TABLE ADD COLUMN`，全部可空以兼容存量）

GB/T 9704 版式与流转字段：

| 列 | 类型 | 说明 |
|---|---|---|
| `copy_no` | varchar(16) | 份号（涉密公文用，如 `000123`） |
| `issuer` | varchar(64) | 签发人（GB/T：上行文标此项） |
| `issuing_org` | varchar(128) | 发文机关标志（红头文字，如"星辰科技有限公司文件"） |
| `doc_type` | varchar(16) | 文种：决定/通知/通报/报告/请示/批复/意见/函/纪要… |
| `main_recipients` | text | 主送机关（多个，`；`分隔或 JSON 数组） |
| `cc_recipients` | text | 抄送机关 |
| `attachments` | text | 附件说明/文件 id 列表（JSON） |
| `annotation` | varchar(255) | 附注（如"此件公开发布"） |
| `template_id` | bigint | 引用的红头/正文套版模板 id |
| `seal_status` | varchar(16) | 用印状态：NONE/PENDING/SEALED |
| `sealed_by` | varchar(64) / `sealed_at` | 用印人/时间 |
| `process_instance_id` | varchar(64) | 关联 Flowable 实例 id |
| `archived` | boolean / `archive_no` varchar(64) / `archived_at` | 归档标记/卷宗号/时间 |
| `secret_expire` | date | 密级期限（涉密解密日期） |

`status` 语义收敛（发文）：`DRAFT 拟稿 → REVIEWING 核稿/会签 → ISSUED 已签发 → SEALED 已用印 → PUBLISHED 已成文分发 → ARCHIVED 已归档`；作废 `VOIDED`。
（收文）：`REGISTERED 已登记 → ASSIGNING 拟办 → APPROVING 批办 → HANDLING 承办 → CIRCULATING 传阅 → FINISHED 办结 → ARCHIVED 归档`。

### 2.2 新表

- **`oa_doc_number_rule`（文号规则）**：`id, code(唯一), name, org_code(机关代字如"星辰办"), doc_type(可空=通配), pattern(如 '{org}〔{year}〕{seq}号'), seq_scope(YEAR/MONTH/NONE), seq_width(如 3→001), enabled`。
- **`oa_doc_number_seq`（序号池）**：`rule_id, period(如 '2026'), current_seq`，唯一键 `(rule_id, period)`；**乐观锁或 `SELECT … FOR UPDATE` 占号防并发跳号**（复用项目已有乐观锁 version 思路）。
- **`oa_doc_number_ledger`（文号台账/登记簿）**：每次正式占号落一行：`doc_number(唯一), rule_id, document_id, doc_title, issued_at, issuer, status(占用/作废)`。作废公文文号置"作废"但**不回收**（合规：文号台账连续可查）。
- **`oa_doc_template`（红头/正文套版）**：`id, code, name, type(HEADER 红头 / BODY 正文 / FULL 整版), issuing_org, content(HTML/富文本，含占位符 {title}{docNumber}{mainRecipients}{body}{docDate}{seal}), seal_image_id(电子印章图片 file id), enabled`。
- **`oa_doc_circulation`（传阅单）**：`id, document_id, reader_id, reader_name, status(PENDING/READ), read_at, opinion`，收文传阅用；一份收文可传阅多人，已阅回执。
- **`oa_doc_opinion`（办文意见）**：`id, document_id, task_key(拟办/批办/核稿/签发/承办…), user_id, user_name, opinion, decision(同意/退回/转办), created_at` —— 办文单全过程意见留痕（GB/T 处理签的电子化）。

> 迁移文件：`server/oa-boot/src/main/resources/db/migration/V20__gongwen_advanced.sql`（下一个可用序号，改前先确认 `db/migration` 最大号）。仅 `oa_*`。`WorkflowInitializer` 或新 `GongwenInitializer` 部署 `gw_send`/`gw_recv` 两个流程 + 种子文号规则 + 一套示范红头模板。

---

## 3. 文号自动生成（磐石）

- 规则示例：机关代字 `星辰办`，pattern `{org}〔{year}〕{seq}号`，年度序号宽 3 → `星辰办〔2026〕001号`（注意用六角括号 `〔〕`，非方括号，符合党政公文规范）。
- 占号时机：**签发通过节点**调用 `DocNumberService.allocate(ruleId, ctx)` → 事务内对 `oa_doc_number_seq` 当前周期 `current_seq+1`（乐观锁/行锁）→ 组装文号 → 写 `oa_doc_number_ledger` → 回填 `oa_document.code`。
- 防重防跳：同一实例重复签发不再占号（幂等：若 document 已有正式文号则跳过）。作废走 `void(docNumber)` 只改台账状态。
- 提供预览：拟稿阶段可 `preview(ruleId)` 显示"下一个将是 …002号"（不占号）。

---

## 4. Flowable 集成（磐石）

- 两个 CODE 表单（`gw_send` / `gw_recv`），字段清单通过既有 `FormManifestService` / CODE 表单登记暴露给流程（拟办人、承办人取人规则可用）。
- 节点办理 → 事件/监听回写公文：
  - 发文"签发"节点 complete 时：占文号 + `status=ISSUED`；"用印"节点：`seal_status=SEALED`；"成文/分发"：`status=PUBLISHED`。
  - 收文"批办"落 `oa_doc_opinion`；"传阅"生成 `oa_doc_circulation` 记录并给传阅人建待办/通知；"办结"→ `FINISHED`。
- 催办：对超时未办的收文，复用现有待办/通知机制发催办提醒（xxl-job 或到期扫描；MVP 可手动"催办"按钮触发通知）。
- 归档：办结后"归档"动作写 `archive_no`（按 `{year}-{类别}-{流水}`）+ `archived=true`，进入归档卷宗（只读检索）。

---

## 5. API 契约（磐石，补 docs/api-contract.md）

前缀 `/api/office/doc`（沿用既有 DocumentController，扩子路由）：

- `POST /send/draft` 拟稿创建发文办文单（起 `gw_send` 实例）；`POST /recv/register` 收文登记（起 `gw_recv`）。
- `GET /{id}` 公文详情（含版式字段 + 办理时间线 opinions + 传阅回执 + 当前 Flowable 环节）。
- `POST /{id}/opinion` 提交办文意见并办理当前节点（同意/退回/转办，透传给引擎）。
- `POST /{id}/circulate` 发起传阅（指定读者列表）；`POST /circulation/{cid}/read` 已阅回执。
- `POST /{id}/seal` 用印；`POST /{id}/archive` 归档。
- 文号：`GET /number/rules`、`POST /number/preview`、（占号在流程内部，不单独开放）。
- 模板：`GET /templates`、`GET /templates/{id}`、`POST /{id}/render`（用公文数据渲染红头正文，返回 HTML 供预览/打印/PDF）。
- 台账：`GET /ledger`（文号台账，分页+按年度/机关筛）、`GET /archive`（归档卷宗检索）。
- 列表：发文/收文列表加筛选（密级/紧急/文种/状态/日期区间/文号）。
- 权限码（新增，`@PreAuthorize`）：`office:doc:send`（拟稿）、`office:doc:review`（核稿）、`office:doc:issue`（签发）、`office:doc:seal`（用印）、`office:doc:recv`（收文登记）、`office:doc:assign`（拟办批办）、`office:doc:archive`（归档）、`office:doc:number`（文号规则管理）。envelope/分页遵循项目约定。

---

## 6. 前端（疾风）

- **发文办文单页 `src/pages/document/send-form.tsx`**（或整合进 send.tsx 的抽屉/详情）：拟稿单（文种/密级/紧急/主送抄送/正文富文本/附件）→ 提交起流程；详情页含**办理时间线**（各环节意见、签发、用印）+ **右侧 GB/T 9704 红头正文预览**（调 `/templates/{id}/render`）+ 打印/导出 PDF。接 Flowable 待办办理（同意/退回/转办 复用审批交互）。
- **收文办文单页**：登记簿录入 → 拟办/批办/承办/传阅时间线；传阅单（勾选传阅人、已阅状态）；催办按钮。
- **台账页**：文号台账（登记簿样式，连续文号、作废标灰）；归档卷宗检索（按年度/类别）。
- 富文本正文编辑器：优先复用仓库既有富文本方案；无则用轻量 contenteditable + 受控（不引重依赖，先确认现状）。红头预览用模板 render 返回的 HTML + 打印样式（@media print）。
- 遵循 `api()` 信封拆包、`hasPerm` 门控、offline 降级、路由=path 约定（菜单在 config/menu.ts）。

## 7. UI / 版式（丹青）

产出 `docs/design/gongwen-format-spec.md`：GB/T 9704《党政机关公文格式》要点落地——版心、红头（发文机关标志居中红色）、发文字号（居左/居右规则）、签发人（上行文右上）、标题（2 号小标宋居中）、主送机关（左顶格）、正文（3 号仿宋，字间/行距）、成文日期（右空四字）、印章（压成文日期，电子印章位）、抄送、印发机关和日期（版记）。给出**红头正文预览组件的视觉规范 + 打印/PDF 版式**（A4、页边距、字体字号），及份号/密级/紧急程度顶部标注位。电子印章渲染（半透明红章压日期）方案。深浅色仅影响编辑 UI，**预览/打印固定白底正规版式**。

---

## 8. 分工与批次

1. **丹青**（可即刻并行，与后端无冲突）：GB/T 9704 版式 spec + 红头/正文/用印预览视觉规范。
2. **磐石**（通讯录修完后接手）：迁移 V20 + 新表 + `DocNumberService`（占号防跳）+ 台账 + 两个 Flowable 流程部署 + API + 权限码 + smoke 断言。**不 commit**。
3. **疾风**（契约既定即可并行，后端未就绪时按 offline mock 顶）：发文/收文办文单页 + 时间线 + 红头预览 + 传阅单 + 台账页 + 菜单/路由。**不 commit**。
4. **主控**：审查 + 集成对账（文号格式六角括号、状态机与流程节点回写、权限码闭环）+ 验证（smoke + tsc/build）+ 提交 push 触发 CI。

> 契约红线：文号用六角括号 `〔〕`；文号占号在签发节点且幂等；作废不回收号；台账连续可查；办文全过程意见留痕；预览遵循 GB/T 9704。
