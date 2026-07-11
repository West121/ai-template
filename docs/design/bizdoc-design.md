# 单据管理(BizDoc)设计

> 主控裁定契约。用户已定:**打印=可视化套打设计器 · 存储=通用单据表 JSON · 审批流=可选绑定**。
> 参考智擎类平台"在线开发-单据":单据类型在线定义(绑表单 + 编号规则 + 打印模板 + 可选流程),
> 运行时自动获得 台账/录入/送审/打印,零代码上一张新单据。

## 1. 概念模型

- **单据定义(BizDocDef)**:一类单据(如请假单/报销单/入库单)。绑定:
  表单(复用既有 ONLINE 在线表单 / CODE 手写表单体系,formCode)、编号规则(复用公文
  `oa_doc_number_rule`/`DocNumberService`——它本就是通用 pattern/序号池/台账)、打印模板(可多个,
  默认一个)、审批流(可选 wf defCode)。
- **单据实例(BizDoc)**:一张具体单据。单号(占号幂等)、表单数据 JSON、状态机:
  `DRAFT 草稿 → (无流程) EFFECTIVE 生效 | (有流程) APPROVING 审批中 → EFFECTIVE / REJECTED;VOID 作废`。
- **打印模板(BizDocPrintTpl)**:可视化套打设计器产物(元素树 JSON),按纸张 mm 坐标渲染打印。

## 2. 数据模型(迁移 V{next},oa_bizdoc_*,归 oa-module-office)

- `oa_bizdoc_def`:id/code 唯一/name/category/icon?/form_type(ONLINE|CODE)/form_code/
  number_rule_id?(空=不占号)/wf_def_code?(空=纯台账)/list_config JSON(台账列+查询条件:
  `{columns:[{field,label,width?}], filters:[{field,label,type}]}`)/default_print_tpl_id?/
  status(DRAFT|PUBLISHED|DISABLED)/remark/created_*。权限码:`bizdoc:def:write`(定义管理)。
- `oa_bizdoc`:id/def_id/def_code 冗余/doc_no?(单号)/title(定义可配标题模板,缺省=定义名+创建人)/
  form_data JSON/status/process_instance_id?/creator_id/creator_name/dept_id/created_*/updated_*/
  version(乐观锁)。**数据权限**:JPA Specification 按 `dept_id`+`creator_id` 走既有 DataScope。
  权限码:`bizdoc:read` `bizdoc:write`。
- `oa_bizdoc_print_tpl`:id/def_id/name/paper(A4|A5)/landscape bool/content JSON(§4 元素树)/
  is_default/created_*。

## 3. 后端(磐石)

1. **定义管理 API** `/api/bizdoc/defs`:CRUD+publish/disable(发布校验:表单存在、编号规则存在、
   wf_def_code 已发布、list_config 字段属于表单清单——经 `/api/wf/forms/{key}/fields` 统一字段体系)。
2. **运行时 API** `/api/bizdoc/docs`:
   - 台账分页(defCode 必带;keyword+list_config filters 动态条件(JSONB 查询 `form_data->>field`);
     数据权限 Specification)。
   - 创建/保存草稿(校验必填按表单清单)/详情/更新(仅 DRAFT/REJECTED 可改)。
   - **提交**:无流程 → 占号(有规则时,幂等)+ EFFECTIVE;有流程 → 占号 + 起流程
     (businessKey=`BIZDOC:{id}`,`__wfRegister/__title` 一等实例,复用公文模式)+ APPROVING;
     流程办结/驳回经事件监听回写 EFFECTIVE/REJECTED(复用 WfEngineEventListener 挂点,按 businessKey 前缀)。
   - 作废(EFFECTIVE→VOID,`bizdoc:write`+本人或管理员;单号台账置 VOID 不回收,同公文口径)。
   - 打印数据:`GET /api/bizdoc/docs/{id}/print?tplId=` → `{tpl(content JSON), data(form_data+单号/
     标题/创建人/日期等系统字段), fields(字段清单 label 映射)}`——**渲染在前端**(套打设计器同一
     渲染器,保证所见即所得;与公文后端渲染不同,此处模板是结构化元素树,前端渲染更合理)。
3. **打印模板 API**:def 下 CRUD + 设为默认。
4. smoke(KEEP=1):定义发布→创建→提交(无流程直接生效+占号格式)→台账过滤;绑流程的提交→审批
   通过→EFFECTIVE(事件回写);驳回→REJECTED 可改再提;打印数据接口;权限 403;数据权限(zhangsan
   看不到别部门单据)。

## 4. 可视化套打设计器(疾风,前端核心)

**模板 content JSON(契约)**:
```jsonc
{ "schemaVersion": 1, "paper": "A4", "landscape": false, "margin": [10,10,10,10],  // mm
  "elements": [
    { "id":"e1", "type":"label",  "x":80,"y":12,"w":50,"h":8, "text":"请假申请单",
      "style":{"fontSize":16,"bold":true,"align":"center"} },
    { "id":"e2", "type":"field",  "x":25,"y":30,"w":60,"h":7, "field":"leaveType",
      "label":"请假类型:", "style":{"fontSize":10.5} },          // label 前缀可选
    { "id":"e3", "type":"table",  "x":10,"y":60,"w":190, "field":"items",           // 子表/明细循环
      "columns":[{"field":"name","label":"事项","w":60},{"field":"amount","label":"金额","w":30}],
      "style":{"fontSize":9,"headerBold":true} },
    { "id":"e4", "type":"line",   "x":10,"y":55,"w":190,"h":0 },
    { "id":"e5", "type":"image",  "x":10,"y":8, "w":20,"h":20, "src":"(dataURL|fileId)" },
    { "id":"e6", "type":"qrcode", "x":180,"y":8,"w":20,"h":20, "value":"{{docNo}}" },
    { "id":"e7", "type":"sysfield","x":150,"y":30,"w":50,"h":7,"field":"docNo","label":"单号:" }
  ] }
```
元素:`label`(静态文本)/`field`(表单字段值)/`sysfield`(单号/标题/创建人/部门/日期)/
`table`(明细循环,子表字段)/`line`/`rect`/`image`(logo,存 dataURL 或 fileId)/`qrcode`
(值支持 `{{docNo}}` 等插值;用轻量无依赖 QR 生成——找 ~10KB 级实现或内置算法,不引重库)。

**设计器交互**:左=元素面板(拖入)+ 字段树(表单字段/系统字段拖到画布即成 field 元素);
中=**mm 标尺画布**(A4 210×297 缩放显示,网格吸附 1mm,拖拽/缩放/多选/对齐分布/方向键微调,
复用现有拖拽经验但这是自由画布非 react-flow——用原生 DnD+受控坐标);右=属性面板(位置尺寸/
字体字号/对齐/边框/加粗);顶部=纸张切换/预览(样例数据)/保存。**打印渲染器**与设计器共用
(绝对定位 mm 单位 + `@page` 边距,参考公文 gongwen.css 的物理单位方案),浏览器打印/PDF。

## 5. 运行时前端(疾风)

- `/bizdoc/defs`:定义管理(列表+编辑抽屉:基本信息/绑表单(下拉复用 ONLINE 列表+CODE 列表)/
  编号规则(下拉复用公文规则)/绑流程(下拉 wf defs)/台账列与筛选配置/打印模板管理入口+设计器整页)。
- `/bizdoc/run/:defCode`:**运行时台账**(动态列=list_config;serverPagination+filters;新建/编辑
  抽屉=FormRenderer(ONLINE)|跳转(CODE);提交/作废;行操作:详情/打印(选模板→渲染→window.print)/
  流程单据显示审批状态与实例链接)。
- 菜单:「单据管理」(定义,管理员)+「单据中心」(运行时:列出已发布定义的入口卡片→各自台账);
  P1:发布的单据定义自动挂菜单。
- offline mock 降级;`bizdoc:*` 权限门控;四门+模板 JSON 往返用例。

## 6. 验收(主控)

- 零代码闭环:新建"报销单"定义(绑在线表单+编号规则+打印模板+绑审批流)→ 发布 → 运行时新建
  填单 → 提交起流程 → 审批通过后状态 EFFECTIVE、单号符合规则 → 打印按模板出 A4 版式。
- 纯台账:不绑流程的定义,保存提交即生效。
- 数据权限:部门隔离;定义管理仅 bizdoc:def:write。
- 套打:字段/明细表/二维码/图片按 mm 坐标打印,预览=打印一致。

## 7. 分工

- **丹青**(先行):套打设计器 + 单据台账/定义管理 UI 规范(docs/design/bizdoc-ui-spec.md)。
- **磐石**:§2 迁移 + §3 API/状态机/事件回写 + smoke(接在 AI 助手后端批之后)。
- **疾风**:§4 套打设计器 + §5 运行时(量大,允许两批:批A=定义管理+运行时台账+HTML 级简版打印;
  批B=可视化套打设计器完整版)(接在 AI 助手前端批之后)。
- 主控:契约对账/§6 验收/提交。P1:条码/多页表头重复/发布定义自动挂菜单/AI 助手 query_bizdoc 工具。

## 8. 丹青 UI 规范开放项裁定(主控)

- style 扩展字段采纳:`lineWidth`(线宽 mm)/`imageFit: contain|cover|fill`/`qrEcLevel`(默认 M)/
  `fontFamily`(宋体/黑体/仿宋/楷体 + 回退链,同公文口径)。
- 坐标口径:元素 x/y 相对**纸张原点**(mm),margin 仅画参考线不参与坐标(按契约 §4 示例)。
- 撤销重做:MVP 至少 undo 20 步(单栈),redo 尽力而为,不作为验收阻断项。
- table 跨页表头重复:P1。编号样例:前端本地拼(也可调 number/preview)。
- **VOID 单据打印带 45°「作废」水印:确认要**(合规,防作废件流通)。
- UI 规范全文见 docs/design/bizdoc-ui-spec.md(渲染器三态同源=硬指标)。

## 9. 范式变更(用户以参考截图裁定):套打设计器改为文档流式模板设计器 v2

用户参考智擎单据设计器实图,**主范式从自由 mm 坐标画布改为文档流式(块级堆叠)**——像 Word 模板:
块从上到下排列、自动高度、天然分页;字段以 `{{字段名}}` token 蓝色 chip 内联绑定。自由定位画布降为 P1 不做。

### 9.1 模板 JSON v2(块级契约,替代 §4)
```jsonc
{ "schemaVersion": 2,
  "page": { "size": "A4|A5|Letter", "landscape": false, "margin": [20,20,20,20],   // mm
            "fontFamily": "宋体|黑体|仿宋|楷体",
            "pageNumber": { "show": true, "position": "footer", "align": "center",
                            "format": "第 {page} 页 / 共 {total} 页", "fontSize": 10 } },
  "blocks": [
    { "id":"b1", "type":"title",      "text":"车辆申请", "style":{"fontSize":18,"bold":true,"align":"center"} },
    { "id":"b2", "type":"docInfo",    "items":[{"label":"单据编号","value":"{{docNo}}"},
                                               {"label":"日期","value":"{{createdAt}}"}] },  // 右对齐信息行
    { "id":"b3", "type":"infoTable",  "columnsPerRow":2, "cells":[                            // 智能表格:label/value 网格
        {"label":"申请单号","value":"{{docNo}}"},{"label":"申请类型","value":"{{type}}"},
        {"label":"用车人","value":"{{applicant}}"},{"label":"用车部门","value":"{{dept}}"} ],
      "style":{"fontSize":10.5,"labelWidth":28} },                                            // labelWidth mm
    { "id":"b4", "type":"labelField", "label":"用车事由", "value":"{{reason}}" },             // 单行标签字段
    { "id":"b5", "type":"text",       "content":"经办说明:{{note}}" },                        // 智能文本(插值)
    { "id":"b6", "type":"detailTable","field":"items",                                        // 明细表格(子表循环)
      "columns":[{"field":"name","label":"事项","w":40},{"field":"amount","label":"金额","w":25}] },
    { "id":"b7", "type":"approvalTable", "steps":[                                            // 审批区(见 9.3)
        {"label":"审批人","value":"{{_approvals.0.assigneeName}}"},
        {"label":"办理人","value":"{{_approvals.1.assigneeName}}"} ] },
    { "id":"b8", "type":"row", "children":[ /* 分栏:各栏是 blocks 子数组 */ ] },
    { "id":"b9", "type":"signature", "label":"签章", "align":"right" },                       // 签章占位框
    { "id":"b10","type":"qrcode",  "value":"{{docNo}}", "size":20, "align":"right" },         // size mm
    { "id":"b11","type":"barcode", "value":"{{docNo}}", "align":"left" },                     // P1 可后补
    { "id":"b12","type":"image",   "src":"(dataURL|fileId)", "w":30, "align":"left" },
    { "id":"b13","type":"divider" }, { "id":"b14","type":"spacer", "h":6 } ] }
```
插值统一 `{{expr}}`:表单字段 key / 系统字段(docNo/title/creatorName/deptName/createdAt/status)
/ **审批数据 `_approvals[i].{nodeName,assigneeName,opinion,time}`**。批A的 v1(自由定位)渲染器保留
兼容读取(schemaVersion 判别),新建默认 v2。

### 9.2 设计器(对齐参考图)
左=元素库(布局容器:行容器 / 表头区域:文档页眉·文档标题·单据信息 / 信息区域:信息行·标签字段·
智能表格·智能文本 / 表格区域:明细表格 / 其他:签章·二维码·条形码(P1)·图片·分割线·空白间距),
拖入画布按文档流插入;中=纸面画布(块 hover 出 拖拽排序/复制/删除,块内 label 行内编辑,字段绑定
弹字段选择器插 `{{}}` token 蓝 chip);右=属性面板(未选中=页面设置:大小/方向/字体/页码;选中=
该块属性)。顶部:撤销/重做/预览(样例+审批样例)/JSON 源码查看/导入导出/保存。
打印:文档流渲染 + `@page`(size/方向/margin)+ 页码页脚;预览=打印同渲染器(三态同源红线不变)。

### 9.3 后端增量(磐石)
打印数据接口 `GET /docs/{id}/print` 的 `data` 增 **`_approvals` 数组**:绑流程单据从其流程实例取
办理记录(nodeName/assigneeName/opinion/time,按办理顺序);无流程或未办为 []。其余接口不变
(模板 content 存 v2 JSON 对后端透明)。

## 10. 范式修正二(用户裁定):单据自带表单设计,与表单管理解耦

单据的字段与录入界面是**单据模块自己的一套在线设计**(自包含),不依赖 wf 表单管理:

- `oa_bizdoc_def` 加 **`form_schema` JSON**(单据私有表单 schema,widgets 结构与在线表单同构——
  这样 FormRenderer/表单设计器组件可直接复用,但数据**只存在单据定义里**,不进 wf_form_def)。
- `form_type` 语义:**`INLINE`(内置设计,默认/主路径)** | `CODE`(高级:绑手写表单,submitPath 场景保留)。
  ONLINE 绑定选项**移除**(被内置设计替代);存量 ONLINE 定义兼容读(当外部引用渲染)。
- **定义编辑**:②区改为「单据字段设计」——打开**表单设计器**(复用现有 designer/form 设计器组件,
  产物存 def.form_schema);台账列/筛选配置、打印模板字段树、录入 FormRenderer **全部改从私有
  schema 派生字段**,不再调 /api/wf/forms/{key}/fields(CODE 定义仍走统一清单)。
- **与流程的字段识别联动**(单据绑审批流时,流程设计器的条件/取人要能选单据字段):
  FormManifestService 增 bizdoc 分支——`formKey = "bizdoc:{defCode}"` 从 def.form_schema 派生
  FieldDescriptor 清单;bizdoc 定义发布时该 key 即可用,流程定义绑定该 key 或直接在编排/流程中
  引用。发布校验相应改(INLINE 校验 schema 非空且字段 key 唯一)。
- 打印数据/状态机/占号/事件回写不变(form_data JSON 与表单来源无关)。
