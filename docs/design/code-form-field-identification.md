# CODE(自定义手写)表单 字段识别 —— 升为第一类表单

> 主控裁定契约 · 磐石(后端)/ 疾风(前端)共同遵循。补齐设计初期红线:
> **非在线设计的手写表单(react-hook-form),其字段必须能被流程设计器识别**——
> 用于分支条件、按字段取人(source=FORM_FIELD)、字段显隐/必填(formPerms)。

## 背景 / 现状缺口(已核实)

- 后端**已有**统一字段清单接口 `GET /api/wf/forms/{formKey}/fields → FormFieldManifest`
  (注释:ONLINE 从 schemaJson 派生 / CODE 取登记清单),`FormManifestService`/`FieldDescriptor` 就位。
- 但**前端设计器没用它**:`designer-page.tsx` 的 `resolveFormFields` 走的是只在线的老接口
  `/api/wf/form-defs/{code}/latest`;且 `formType==="CUSTOM"` 时直接给**空字段数组**。
- 结果:自定义表单在设计器里**拿不到任何字段**,条件/取人/字段权限都没得选。
- 且 gw_send 调 `/api/wf/forms/gw_send/fields` **404**(公文没登记字段清单)。
- 两套 FormType 分裂:`DYNAMIC|CUSTOM`(designer/ProcessDef) vs `ONLINE|CODE`(FormFieldManifest)。

## 目标模型:CODE 表单第一类

一个 CODE 表单由 **formKey** 标识(如 `leave`、`gw_send`、`gw_recv`),具备:
1. **字段清单(必备)**:后端登记 `FieldDescriptor[]`(key/label/type/options…),经
   `/api/wf/forms/{key}/fields` 返回(formType=CODE)。→ 设计器据此识别字段。
2. **自定义发起页(可选)**:复杂表单(如公文拟稿单)带 `formSubmitPath`(navigate 跳手写页,
   经业务 API 起流程);简单 CODE 表单可由前端 `registerForm` 的组件内嵌渲染。

**「CUSTOM(纯跳转、无字段)」并入 CODE**:凡自定义表单一律有 manifest(字段可识别),
formSubmitPath 变为 CODE 表单的可选属性。gongwen = CODE 表单 + formSubmitPath=/document/send?new=1。

流程定义的表单绑定收敛为两类:
- **ONLINE(在线表单)**:绑一个在线设计器表单 formCode,字段从 schemaJson 派生。
- **CODE(代码表单)**:绑一个已登记 CODE 表单 formKey,字段从登记清单取;可带 formSubmitPath。

## 后端(磐石)

1. **登记 CODE 表单字段清单**(`wf_form_def` 的 CODE 行带 `field_manifest`,或服务端 CODE 注册表):
   - `gw_send`(发文办理单)字段:`title`(标题,text)、`docType`(文种,select:决定/通知/通报/报告/请示/批复/意见/函/纪要)、`secret`(密级,select:公开/内部/秘密/机密)、`urgency`(紧急,select:普通/加急/特急)、`mainRecipients`(主送,text)、`ccRecipients`(抄送,text)、`content`(正文,richtext/textarea)、`attachments`(附件,file)、`needCountersign`(是否会签,boolean)、`numberRuleId`(文号规则,select/number)。
   - `gw_recv`(收文办理单)字段:来文单位、来文字号、标题、密级、紧急、正文、附件 等对应登记字段。
   - `leave` 现在返回 formType=ONLINE(有 schema);保持可用即可,不必强改(设计器统一接口对两者都工作)。
   - `/api/wf/forms/gw_send/fields` 不再 404,返回 formType=CODE + 上述 fields(带 type/options,供条件运算与取人)。
2. **列表接口**给绑定 UI 选:`GET /api/wf/forms/code`(或扩展现有)→ 返回已登记 CODE 表单
   `[{ formKey, name, fieldCount }]`,供流程定义绑定时下拉选择。
3. **流程定义绑定语义**:ProcessDef `form_type='CODE'` + `form_code=<CODE formKey>` +（可选)`form_submit_path`。
   - `startable`/详情:CODE 且有 form_submit_path → 前端 navigate 起单;无则内嵌 registerForm 组件。
   - gw_send/gw_recv 改为 `form_type='CODE'` + `form_code=gw_send/gw_recv` + `form_submit_path` 保留
     (现在是 CUSTOM,并入 CODE;发起页 start.tsx 对 CODE+有 submitPath 同样 navigate)。
   - 与 InstanceService.startable()/StartableItem 对齐:新增/复用 formType 值 CODE;前端据此判定。
4. smoke:`/api/wf/forms/gw_send/fields` 返回字段(含 needCountersign);流程定义绑定 CODE 后 startable 正确。

## 前端(疾风)

1. **designer `resolveFormFields` 改用统一接口** `/api/wf/forms/{formKey}/fields`(ONLINE+CODE 都工作);
   `formType` 为 CODE 时用 form_code(CODE formKey)拉字段,不再返回空数组。
   `widgetsToFields` 逻辑用 manifest 的 FieldDescriptor 映射为 `FormFieldOption`(key/label/isUser 等)。
2. **绑定 UI(defs.tsx 新建 + 编辑)**:表单类型收敛为 **在线表单 / 代码表单** 两类:
   - 代码表单:从 `GET /api/wf/forms/code` 下拉选一个已登记 CODE 表单(formKey);可选填 formSubmitPath。
   - 保留在线表单原逻辑。DYNAMIC→ONLINE、CUSTOM→CODE 的术语在前端 types 一并对齐(向后兼容旧值)。
3. **验证字段贯通**:绑定 CODE 表单(如 gw_send)后进设计器,分支条件字段下拉、按字段取人
   (source=FORM_FIELD)、字段权限(formPerms)都能列出 CODE 表单字段(如 needCountersign / days)。
4. start.tsx:CODE + formSubmitPath → navigate(现有 CUSTOM 分支扩为认 CODE);CODE 无 submitPath → 内嵌 registerForm 组件渲染(若该组件已登记)。

## 术语对齐(全仓)

`DYNAMIC → ONLINE`、`CUSTOM → CODE`(前端 designer/types.ts、types/workflow.ts 与后端 ProcessDef.form_type
统一为 `ONLINE | CODE`)。保留对旧值的兼容读取(旧 DYNAMIC 当 ONLINE、旧 CUSTOM 当 CODE)避免存量炸。

## 红线

- CODE 表单字段清单是**字段识别的唯一真源**,条件/取人/字段权限一律经统一接口拿字段。
- gongwen 拟稿单字段(尤其 `needCountersign`——驱动会签网关条件 `needCountersign == true`)必须在清单里,
  否则设计器改会签条件时选不到字段。
- 存量流程(leave 等)不得回归:统一接口对 ONLINE 表单同样返回字段。
