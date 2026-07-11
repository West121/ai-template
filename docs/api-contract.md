# OA 平台 API 契约（前后端开发共同遵守）

> 最后更新：2026-07-10（工作流事件监听器增强：events 增 `blocking?:boolean` 阻断办理 + `action:DELEGATE` 自定义监听器 `WfEventHandler` SPI；同批订正 events 契约含 SCRIPT/API action。见「工作流域→节点级 nodeConfig→events」。前次含 B-17：文件下载业务放行 SPI—电子章/审批附件；B-10：首节点 webhook 时序修复）。变更历史见 `CHANGELOG.md`。

- 基址：前端经 Vite 代理 `/api` → `http://localhost:8081`
- 统一响应：`R<T> = { code: 0成功|其他失败, message, data }`；分页 `PageResult<T> = { list, total, pageNum, pageSize }`
- 认证：除 `/api/auth/login` 外均需 `Authorization: Bearer <jwt>`；401=未登录，403=无功能权限
- 时间格式：日期 `yyyy-MM-dd`，时间戳 ISO（`2026-07-07T09:00:00`）
- 数据权限：标注【DS】的列表接口按当前激活身份的数据范围过滤（dept_id ∈ 可见部门 OR 本人数据）
- 功能权限：标注【P:code】的接口用 `@PreAuthorize("hasAuthority('code')")` 保护

## 认证（已实现，勿改契约）
- POST `/api/auth/login` {username,password} → {token,user:{id,username,name},assignments:[AssignmentInfo],activeAssignmentId,permissions[]}
- POST `/api/auth/switch` {assignmentId:"ALL"|"<id>"} → 同上
- GET `/api/auth/me` → 同上（无 token 字段）
- AssignmentInfo = {id,deptId,deptName,postName,roleNames[],primary}

## 审批中心（oa-module-office）
Approval 响应 = {id,title,type,applicant,applicantId,deptId,deptName,status,reason,startDate?,endDate?,createdAt}
status: PENDING/APPROVED/REJECTED/WITHDRAWN；type: LEAVE/EXPENSE/TRIP/OVERTIME/SEAL/PURCHASE/CONTRACT/OTHER
- GET `/api/office/approvals?status=&pageNum=&pageSize=`【DS】待办等通用查询（已实现）
- GET `/api/office/approvals/pending-count`【DS】→ Long（已实现）
- POST `/api/office/approvals` {title,type,reason,startDate?,endDate?,ccUserIds?:number[]} 自动填 applicant/dept（已实现，需扩展 ccUserIds/日期）
- GET `/api/office/approvals/my?status=&pageNum=`【P:office:approval:list】我发起的（不走 DS，applicant_id=me）
- GET `/api/office/approvals/done?pageNum=`【P:office:approval:list】我处理过的（依据操作日志）响应加 {myAction:APPROVE|REJECT, actedAt}
- GET `/api/office/approvals/cc?pageNum=`【P:office:approval:list】抄送我的，响应加 {readFlag:boolean}
- POST `/api/office/approvals/cc/{approvalId}/read`【P:office:approval:list】标记已读；POST `/api/office/approvals/cc/read-all`【P:office:approval:list】
- POST `/api/office/approvals/{id}/approve` {comment?}【P:office:approval:approve】（已实现，补日志）
- POST `/api/office/approvals/{id}/reject` {reason}【P:office:approval:approve】（已实现，补日志）
- POST `/api/office/approvals/{id}/withdraw`【P:office:approval:create】仅本人且 PENDING → WITHDRAWN
- GET `/api/office/approvals/{id}/logs`【P:office:approval:list】→ [{action:CREATE|APPROVE|REJECT|WITHDRAW, actorName, comment?, createdAt}]
  归属校验（B-05）：仅发起人 / 审批人（曾操作过该单，或数据权限范围覆盖该单）/ 抄送人可读，无关用户 → 403

## 公文（oa-module-office）
Document = {id,direction:RECEIVE|SEND,code,title,unit(来文/主送单位),secret:PUBLIC|INTERNAL|SECRET,urgency:NORMAL|URGENT|EXTRA,status,drafter?,signer?,docDate,deptId,deptName,createdAt}
RECEIVE status: TO_SIGN(待签收)/PROCESSING(办理中)/FINISHED(已办结)；SEND status: DRAFT(拟稿)/REVIEWING(核稿中)/ISSUED(已签发)/PUBLISHED(已发布)
- GET `/api/office/documents?direction=&status=&keyword=&pageNum=`【DS】
- POST `/api/office/documents` {direction:SEND,title,unit,secret,urgency,content?} → code 自动 `星发〔2026〕N号`，status=DRAFT
- POST `/api/office/documents/{id}/sign` 待签收→办理中；POST `/{id}/finish` 办理中→已办结
- POST `/api/office/documents/{id}/review` DRAFT→REVIEWING；POST `/{id}/issue` REVIEWING→ISSUED（signer=当前人）
- DELETE `/api/office/documents/{id}`【P:office:document:edit】

## 中国式公文高级化（oa-module-office，前缀 `/api/office/doc`，V20 + V21）
> 复用平台 Flowable 引擎：发文 `gw_send`（拟稿→核稿→会签(可选)→签发→用印→成文/分发）、收文 `gw_recv`（登记→拟办→批办→承办→传阅(可选)→办结归档）。businessKey=`GW:{documentId}`。文号用**六角括号〔〕**，签发节点占号且幂等，作废不回收（台账连续）。红头正文渲染输出 `.gw-*` class 片段（见 `docs/design/gongwen-format-spec.md`）。
>
> **流程注册（V21）**：两流程以 `designer_type=GRAPH` + `designer_json(ProcessModel)` 种子入 `wf_process_ext`（status=DRAFT），由既有 `WorkflowInitializer` 走 `GraphToBpmnConverter` 部署——① 出现在 `GET /api/wf/process-defs`；② 可在 react-flow 设计器打开编辑（defCode 稳定，幂等不堆叠版本）；③ 办理人走真实 OA 取人规则（`AssigneeResolver`：核稿/拟办/承办=部门主管 LEADER lv1；会签/签发/批办=部门经理角色；用印=系统管理员角色；成文/传阅/办结=发起人本人；emptyStrategy=TO_ADMIN）。office 起实例时注入 `initiatorId`/`initiatorDeptId` 供取人求值。
> **锁定节点 key（回写 hook 绑定 taskDefinitionKey==节点 id，设计器改名不改 id）**：发文 `review/countersign/issue/seal/publish`、收文 `propose/approve/handle/circulate/finish`。改流程结构时须保留这些 id。
>
> Document 扩字段：copyNo(份号)/issuer(签发人,上行文)/issuingOrg(红头文字)/docType(文种)/mainRecipients/ccRecipients/attachments/annotation(附注)/templateId/sealStatus(NONE|PENDING|SEALED)/sealedBy/sealedAt/processInstanceId/archived/archiveNo/archivedAt/secretExpire。
> 发文 status：DRAFT→REVIEWING→ISSUED→SEALED→PUBLISHED→ARCHIVED（作废 VOIDED）；收文 status：REGISTERED→ASSIGNING→APPROVING→HANDLING→CIRCULATING→FINISHED→ARCHIVED。
> Decision（办理）：APPROVE 同意 / REJECT 退回（删实例、状态回 DRAFT/REGISTERED） / TRANSFER 转办（换 assignee，须 targetUserId）。

- POST `/send/draft` 【P:office:doc:send】{title*,docType?,issuingOrg?,mainRecipients?,ccRecipients?,secret?,urgency?,copyNo?,issuer?,annotation?,content?,attachments?(JSON:文件id/名列表),templateId?,numberRuleId?,needCountersign?} → 起 gw_send，status=REVIEWING，返回详情
- POST `/recv/register` 【P:office:doc:recv】{title*,code?(来文字号),unit?(来文单位),docType?,secret?,urgency?,content?,needCirculate?} → 起 gw_recv，status=ASSIGNING
- GET `/{id}` 详情：版式字段 + currentTask{taskId,taskKey,taskName,assignee} + timeline[办文意见] + circulations[传阅回执]
- POST `/{id}/opinion` {opinion?,decision?,targetUserId?} 办理当前节点（核稿/会签/签发/拟办/批办/承办/成文）；签发节点占号回写 code+ISSUED；节点权限服务层按环节校验（review→office:doc:review、issue/publish→office:doc:issue、拟办批办承办→office:doc:assign）
- POST `/{id}/seal` 【P:office:doc:seal】{opinion?} 完成用印节点 → sealStatus=SEALED,status=SEALED
- POST `/{id}/circulate` 【P:office:doc:assign】{readers:[{id,name}]} 完成传阅节点，生成传阅单，status=CIRCULATING
- POST `/circulation/{cid}/read` {opinion?} 已阅回执 → status=READ,readAt
- POST `/{id}/archive` 【P:office:doc:archive】{category?} 仅 FINISHED/PUBLISHED 可归档 → archived=true,archiveNo=`{year}-{类别}-{id4位}`,status=ARCHIVED
- POST `/{id}/urge` 催办：对当前承办环节承办人发催办提醒（best-effort 写 wf_notify + 留痕 urge 意见）
- GET `/list?direction=&status=&docType=&secret=&urgency=&keyword=&from=&to=&pageNum=&pageSize=`【DS】 发文/收文台账列表（多筛）
- GET `/ledger?year=&keyword=&status=&pageNum=` 文号台账（连续，按 id 升序；作废=VOID 不回收号）
- GET `/archive?direction=&year=&keyword=&pageNum=`【DS】 归档卷宗检索（year=按 archived_at 归档年度过滤（卷宗号前缀兜底），direction=类别）
- GET `/number/rules` 【P:office:doc:number】文号规则列表（含 nextPreview）
- POST `/number/preview` {ruleId?,docType?} → {number}（不占号）
- GET `/templates`、GET `/templates/{id}` 红头/正文套版模板
- POST `/{id}/render` → {documentId,templateId,upward,html} 渲染 `.gw-typearea` 内部 HTML（六角括号、上行文签发人居右、印章仅 SEALED）
- 新权限码：office:doc:send/review/issue/seal/recv/assign/archive/number；授权 ADMIN=全部，DEPT_MANAGER=send/review/issue/recv/assign/archive

## 会议（oa-module-office）
- GET `/api/office/meeting-rooms?date=2026-07-07` → [{id,name,floor,capacity,devices:string[],status:FREE|BUSY|MAINTAIN, bookings:[{startHour,endHour,subject,booker}]}]（bookings 为该日）
- POST `/api/office/meetings` {roomId,subject,date,startHour,endHour} 时段冲突 → BusinessException(409,"该时段已被预订")
- GET `/api/office/meetings/my?pageNum=` → {id,subject,roomName,organizer,organizerId,date,startHour,endHour,status:UPCOMING|ONGOING|FINISHED|CANCELED,role:HOST|ATTENDEE}
- POST `/api/office/meetings/{id}/cancel` 仅 HOST 且未开始

## 考勤（oa-module-office，均为"我的"数据）
- GET `/api/office/attendance/records?month=2026-07` → {summary:{days,late,early,absent,overtimeHours}, list:[{date,week,checkIn?,checkOut?,hours?,status:NORMAL|LATE|EARLY|ABSENT|REST}]}
- POST `/api/office/attendance/check` {} → 当日打卡（无记录=签到，有签到无签退=签退）返回当日记录
- GET `/api/office/leaves?pageNum=`【DS】→ {id,type:ANNUAL|PERSONAL|SICK|COMP,startDate,endDate,days,reason,status:PENDING|APPROVED|REJECTED|WITHDRAWN,applicant,deptName,createdAt}
- GET `/api/office/leaves/quotas` → [{type,total,used}]（ANNUAL 10/5、COMP 4/2、SICK 15/1 种子）
- POST `/api/office/leaves` {type,startDate,endDate,days,reason}；POST `/{id}/withdraw`
- GET `/api/office/trips?pageNum=`【DS】→ {id,destination,startDate,endDate,transport:TRAIN|FLIGHT|CAR,budget,reason,status同上,applicant,deptName}
- POST `/api/office/trips` {...}；POST `/{id}/withdraw`

## 公告（oa-module-office，全员可见）
- GET `/api/office/announcements?category=&pageNum=` → {id,category:NOTICE|RULE|NEWS,title,content,publisher,deptName,top,reads,publishAt,readFlag}
- GET `/api/office/announcements/unread-count` → Long
- POST `/api/office/announcements` {category,title,content,top}【P:office:announcement:publish】
- POST `/api/office/announcements/{id}/read`（幂等，reads+1 仅首次）

## 日程（oa-module-office，我的数据）
- GET `/api/office/schedules?month=2026-07` → [{id,title,date,startTime:"14:00",endTime,place,type:MEETING|REVIEW|TRIP|TRAINING|OTHER}]
- POST `/api/office/schedules` {...}；DELETE `/api/office/schedules/{id}`

## 工作台聚合（oa-module-office）
- GET `/api/office/dashboard` → {pendingCount【DS】, todayMeetings, monthAttendanceDays, unreadAnnouncements, todayCheckIn?:"09:02", pendingList:前5条【DS】, announcements:前4条, todaySchedules:[...], weekApprovalStats:[{day:"周一",count}] }

## 系统管理（oa-module-system）
- GET `/api/system/depts/tree` → [{id,name,parentId,sort,code,leaderId,leaderName,enabled,createdAt,userCount,children[]}]（userCount = 该部门自身 + 全部子孙部门的**去重用户数**（子树聚合，一人在子树内多任职/兼任只计一次；故父节点 userCount 可能小于各叶子直属之和，为多岗位模型的正常现象。前端「全公司」= 各顶层节点 userCount 之和）；leaderName 由后端按 leaderId 一次 findAllById 组装，无 N+1）
- POST `/api/system/depts` {name,parentId,sort,code?,leaderId?,enabled?}（code 全局唯一 uk_sys_dept_code，重复→400"部门编码已存在"；leaderId 须存在→否则 400"负责人不存在"；enabled 缺省 true）【P:system:dept:edit】
- PUT `/api/system/depts/{id}` 部分更新：仅覆盖请求中非 null 字段 {name?,sort?,code?,leaderId?,enabled?,parentId?}；leaderId=0 表示清空负责人，code 传空串表示清空编码；可单发 {enabled} 即时切换状态、{sort} 调整排序【P:system:dept:edit】
- DELETE `/api/system/depts/{id}`（有子部门或任职→BusinessException）【P:system:dept:edit】
- GET `/api/system/posts?keyword=&pageNum=` → {id,code,name,sort,userCount}
- POST/PUT/DELETE `/api/system/posts...`【P:system:post:edit】
- GET `/api/system/users?keyword=&deptId=&enabled=&pageNum=` → {id,username,name,empNo,phone,email,gender:MALE|FEMALE|UNKNOWN,birthday,hireDate,officeLocation,leaderId,leaderName,avatar,remark,enabled,createdAt,primaryDeptName,primaryPostName,roleNames[]}；keyword 匹配 name/username/empNo/phone；deptId 按**部门子树**过滤（含该部门 + 全部后代部门的用户，去重；复用 DEPT_AND_CHILD 的 ancestors 子树逻辑，点击父/公司部门可见其所有下级人员）；leaderName 由后端按 leaderId 一次 findAllById 组装（无 N+1）；GET `/{id}` 返回同样全字段
- POST `/api/system/users` {username,name,phone,password,deptId,postId,roleIds[],empNo?,email?,gender?,birthday?,hireDate?,officeLocation?,leaderId?,avatar?,remark?}（建主任职；empNo 缺省自动生成 XC+4 位递增，传入则查重、唯一约束 uk_sys_user_emp_no）【P:system:user:edit】
- PUT `/api/system/users/{id}` {name,phone,email?,gender?,birthday?,hireDate?,officeLocation?,leaderId?,avatar?,remark?}（工号不可改；leaderId 不能为本人、须存在）；PUT `/{id}/enabled` {enabled}；POST `/{id}/reset-password`（B-12：重置为一次性随机初始密码，响应 `R<String>` data=新明文密码，供管理员转交用户；不再固定 admin123）；DELETE `/{id}`【P:system:user:edit】
- GET `/api/system/users/{id}/assignments` → AssignmentInfo[]；POST `/api/system/users/{id}/assignments` {deptId,postId,roleIds[],primary:false} 添加兼任；DELETE `/api/system/assignments/{aid}`（主任职不可删）【P:system:user:edit】
- GET `/api/system/roles?pageNum=` → {id,code,name,dataScope,enabled,userCount,remark?}
- POST/PUT/DELETE `/api/system/roles...` {code,name,dataScope,remark}【P:system:role:edit】
- GET `/api/system/roles/{id}/permissions` → number[]；PUT `/api/system/roles/{id}/permissions` {permissionIds:number[]}【P:system:role:edit】
- GET `/api/system/permissions/tree` → [{id,code,name,type:MENU|BUTTON,children[]}]

## 新增权限码与角色授权（V3 种子，B1 负责写入）
新权限码：office:document:list/edit、office:announcement:publish、system:dept:edit、system:post:edit、system:user:edit、system:role:edit
授权：ADMIN=全部；DEPT_MANAGER 增加 office:document:list/edit、office:announcement:publish；EMPLOYEE/FINANCE 增加 office:document:list。
其余列表接口只要求登录（不加 @PreAuthorize），保证演示不 403 满屏。

V20 中国式公文权限码：office:doc:send/review/issue/seal/recv/assign/archive/number（详见「中国式公文高级化」节）。授权 ADMIN=全部；DEPT_MANAGER=send/review/issue/recv/assign/archive（不含 seal/number）。

## 前端离线兜底约定
所有接真实数据的页面：捕获 NetworkError（`@/lib/api`）→ 显示"后端未启动"卡片 + 重试按钮（参考 `src/pages/approval/pending.tsx`），不得白屏。

## 基础设施域（oa-module-infra：文件 / 字典 / 日志）
依赖方向调整：common ← infra ← system ← office ← boot（system 可用 infra 的登录日志仓库）

### 文件管理（存储可切换 local | minio | s3）
FileRecord = {id,originalName,ext,size,contentType,storageType:LOCAL|MINIO|S3,objectKey,uploaderId,uploaderName,createdAt}
- GET `/api/infra/files?keyword=&pageNum=&pageSize=` 分页（keyword 匹配 originalName）
  归属过滤（B-04）：持有 system:file:list 或数据权限 ALL → 全量；否则仅返回本人上传的文件
- POST `/api/infra/files/upload` multipart(file) → FileRecord（小文件直传）
- GET `/api/infra/files/{id}/download` → 文件流（attachment；MINIO/S3 也统一走后端流式转发）
  归属校验（B-04 IDOR 修复）：仅上传者本人 / 持有 system:file:list / 数据权限 ALL 可下载，其余 → 403
  业务放行（B-17）：在上述判定之后，追加「文件被当前用户可合法查看的业务对象引用」兜底放行（infra `FileAccessGrant` SPI，业务模块实现，端点/URL 不变）。当前 workflow 覆盖：① 电子章图片（被任一 wf_seal 引用→放行任意登录用户，印章为组织级登录可见资产）；② 审批操作附件（approve/reject 的 attachments，被当前用户可见实例——其发起/办理/抄送——的操作引用时放行）。**未覆盖(TODO)**：表单上传控件产生、存于 form_data 的文件（需写入时建 file↔实例关联表）。
- DELETE `/api/infra/files/{id}`【P:system:file:edit】（同时删存储对象）
- 分片上传/断点续传/秒传：
  - POST `/api/infra/files/chunk/init` {fileName,size,contentType,chunkSize,fileHash} → {uploadId,uploaded:number[],instant:boolean,file?:FileRecord}
    （fileHash 命中已有完整文件 → instant=true 秒传返回 file；否则返回已上传分片序号供续传）
  - POST `/api/infra/files/chunk` multipart(uploadId,index,chunk) → {uploaded:number[]}
  - POST `/api/infra/files/chunk/merge` {uploadId} → FileRecord（分片本地暂存合并后推目标存储）
- 配置 application.yml：`oa.storage.type=local|minio|s3`；local: base-path；minio/s3 统一 S3 协议字段 endpoint/access-key/secret-key/bucket（MinIO SDK 同时适配二者）

### 字典管理（字典项支持树形）
DictType = {id,code,name,remark,enabled,itemCount}；DictItem = {id,typeId,parentId,label,value,sort,enabled,remark,children[]}
- GET `/api/infra/dict/types?keyword=&pageNum=`；POST/PUT `/{id}`/DELETE `/{id}`（code 唯一；删除有字典项→400）【P:system:dict:edit】
- GET `/api/infra/dict/types/{typeId}/items` → 树形数组
- POST `/api/infra/dict/items` {typeId,parentId?,label,value,sort}；PUT `/{id}`；DELETE `/{id}`（有子项→400）【P:system:dict:edit】
- GET `/api/infra/dict/{code}/options` → 树形（业务侧取字典用，登录即可）
- 种子：leave_type 请假类型（平铺）、education 学历（平铺）、region 行政区划（树形：广东省>广州/深圳>区，浙江省>杭州>区 两省示例）

### 日志管理
B-06：三个日志接口均需【P:system:log:list】，且返回 Response DTO（LoginLogResponse/OperLogResponse），不直接返回 JPA 实体。
- 登录日志 LoginLog={id,username,ip,location,userAgent,success,message,createdAt}：GET `/api/infra/logs/login?keyword=&pageNum=`【P:system:log:list】；登录成功/失败由 AuthService 自动落库；location=IP 归属地（ip2region v2 离线库：内网 IP→"内网"，国内→"省份城市" 如 "广东省广州市"，国外→"国家 城市"，解析失败→"未知"）
- 操作日志 OperLog={id,username,module,action,method,params,status:SUCCESS|FAIL,errorMsg,costMs,ip,createdAt}：GET `/api/infra/logs/oper?keyword=&module=&pageNum=`【P:system:log:list】
  记录机制：`@OperLog(module,action)` 注解（放 oa-common）+ infra 内 AOP 切面；在关键写接口标注（审批同意/驳回/撤回、用户/部门/角色/字典增删改、公告发布、文件上传删除等）
- 运行日志：GET `/api/infra/logs/runtime?lines=200`【P:system:log:list】→ {file,lines:string[]}（tail 应用日志文件；boot 配置 logging.file.name=./logs/oa-platform.log）
新权限码（V6 种子）：system:file:edit、system:dict:edit、system:log:list（超管代码级全量自动拥有）
新权限码（V15 种子，B-04）：system:file:list（文件查询：查看/下载全部文件；超管代码级自动拥有，其余角色默认不授权）

## 工作流域（oa-module-workflow / Flowable 8）
前缀 `/api/wf`；认证复用现有 JWT/Security（CurrentUserHolder）。运行时接口（发起/待办/审批/通知）登录即可；定义管理接口需【P:wf:def:edit】。
ACT_* 引擎表由引擎自建（不进 Flyway）；业务扩展表 wf_form_def/wf_process_ext/wf_instance_ext/wf_operation/wf_cc/wf_notify（V7）。

### 表单定义（版本化：code+version 唯一，PUBLISHED 不可改，改=同 code 新版本 DRAFT）
FormDef = {id,code,name,version,schemaJson,status:DRAFT|PUBLISHED|DISABLED,remark,createdAt}（schemaJson 为前端表单设计器 widgets JSON，原样存取）
- GET `/api/wf/form-defs?keyword=&pageNum=&pageSize=`
- GET `/api/wf/form-defs/{id}`；GET `/api/wf/form-defs/{code}/latest`；GET `/api/wf/form-defs/{code}/versions` → [FormDef]
- POST `/api/wf/form-defs` {code,name,schemaJson,remark?}【P:wf:def:edit】 同 code 已存在则版本+1 建 DRAFT
- PUT `/api/wf/form-defs/{id}` {code,name,schemaJson,remark?}【P:wf:def:edit】 仅 DRAFT 可改
- POST `/api/wf/form-defs/{id}/publish`【P:wf:def:edit】 → PUBLISHED
- GET `/api/wf/form-defs/{defCode}/records?keyword=&pageNum=&pageSize=`【登录】 → PageResult<FormRecord>
  - relation 控件（数据源 type=form）的可选项：查以该表单为 form_code、已提交（非 DRAFT）的流程实例；keyword 匹配标题；未被任何流程使用则空页
  - FormRecord = {id, procInstId, title, label, value, summary}；value=procInstId（存储唯一值），label=实例标题或首个文本字段（展示），summary=表单标量字段摘要

### 表单字段清单（N-B-03，设计文档《next-gen-workflow-and-formula》第二部分 2.2/2.3；范围锁定 ONLINE+CODE）
统一「字段清单契约」：所有表单向流程暴露机器可读字段清单，设计时「节点字段权限编辑器」按 formKey 拉本清单渲染 visible/editable/required 矩阵，写入节点 `WfNodeProps.formPerms`（已有字段，不新增模型）；运行时任务领取回传该节点 formPerms（详情 `nodeFormPerms`，已有，本切片不改），前端 FormRenderer/HostedForm 据此显隐/只读/必填。
- FormFieldManifest = {formKey, formType:ONLINE|CODE, fields:[FieldDescriptor]}
- FieldDescriptor = {key, label, type, group?, options?:[{label,value}], dataSource?}（type 原样取自控件类型 input/textarea/number/select/date/user/subform/...；group 来自分组容器(group)标题或子表单标题，顶层字段无 group；options 仅选项型控件 radio/checkbox/select，归一化 {label,value}；dataSource 原样透传 widget.dataSource，如 {type:"dict",dictCode} / {type:"form",defCode,...}）
- GET `/api/wf/forms/{formKey}/fields`【登录即可，与表单查看一致】→ R<FormFieldManifest>
  - formKey = wf_form_def.code，取该 code 最新版本表单；表单不存在 → 404
  - **ONLINE**（form_type 缺省 ONLINE）：解析该表单 schemaJson 递归提取扁平 fields —— 容器（grid/group/tabs/collapse）透明下钻、布局控件（divider/note/html）跳过；**子表单**整体是一个 `type:subform` 字段，其列字段以 `子表单key.列key` 前缀展开、group=子表单标题（与前端 `form-runtime.ts` 的 `collectDataWidgets` 同源，差异仅在本端把子表单列独立展开）
  - **CODE**：`wf_form_def` 增 `form_type`（V19，默认 ONLINE）+ 预留「仅存字段清单不存 schemaJson」（schema_json 放宽可空、增 `field_manifest` TEXT 列存 FieldDescriptor[]）；若登记了 CODE 型清单则返回，否则 404 —— **CODE 表单字段清单以前端 registry 为准，本端点主要服务 ONLINE**

### 流程定义（wf_process_ext 一条/def_code；引擎负责流程版本）
ProcessDef = {id,defCode,name,category,icon,formCode,formVersion,designerType:DINGTALK|BPMN,designerJson,bpmnXml,status,processDefinitionId,remark,createdAt,formType:DYNAMIC|CUSTOM,formSubmitPath,formViewPath,flowConfig}
  （P1-C 扩展：formType 缺省 DYNAMIC=动态表单；CUSTOM=自定义 React 路由表单，formSubmitPath 发起页路由、formViewPath 详情查看路由；flowConfig=流程级配置 JSON，见下）
- GET `/api/wf/process-defs?keyword=&pageNum=&pageSize=`
- GET `/api/wf/process-defs/{id}`；GET `/api/wf/process-defs/{code}/latest`；GET `/api/wf/process-defs/{code}/diagram` → bpmnXml(String)
- POST `/api/wf/process-defs` {defCode,name,category?,icon?,formCode?,formVersion?,designerType,designerJson|bpmnXml,remark?,formType?,formSubmitPath?,formViewPath?,flowConfig?}【P:wf:def:edit】
  - **defCode 须为 BPMN 合法 id（字母数字下划线，首字符非数字）**；含 `-` 等特殊字符会被转换器 sanitize 成下划线，导致 startProcessInstanceByKey 找不到 key。
- PUT `/api/wf/process-defs/{id}` 同上【P:wf:def:edit】
- POST `/api/wf/process-defs/{id}/publish`【P:wf:def:edit】 发布=DINGTALK JSON→BPMN 转换 / BPMN 校验 → repositoryService 部署（引擎 parse 失败即回滚报错）

### 图直译模型部署（N-B-01 切片 2a，新 react-flow 设计器专用；与旧 process-defs 路径并存）
前缀 `/api/wf/models`；走 `GraphToBpmnConverter` 图直译（前端归一化 `ProcessModel` JSON → BpmnModel → 同一 Flowable 部署与 wf_process_ext 落库）。`designerType=GRAPH` 存 `designer_json`。
- POST `/api/wf/models/graph/deploy` {key,name,category?,icon?,formCode?,formVersion?,model:ProcessModel}【P:wf:def:edit】 一步完成 upsert(by key=defCode) + 转换 + 部署 + 回填
  → GraphDeployResponse {id, processDefinitionId, processDefinitionKey(==key), version, deploymentId, status(=PUBLISHED)}
  - **key 须为 BPMN 合法 id**（字母数字下划线、首字符非数字）；顶层 key/name 归一化写回 model.key/name，保证 BPMN process id==def_code（否则 startProcessInstanceByKey 找不到 key）
  - **ProcessModel 结构**（`ProcessModel = {schemaVersion:1,key,name,version?,formKey?,flowConfig?,nodes:FlowNode[],edges:SequenceFlow[]}`，显式图非嵌套树，详见 `docs/design/next-gen-workflow-and-formula.md` 附录 A/B）：
    - FlowNode = `{id,type,name,position:{x,y},size?:{w,h},props?:WfNodeProps,terminate?,formKey?}`
    - 切片 2a 已支持 type：`startEvent` / `endEvent`（terminate:true 加终止事件）/ `userTask`（props=WfNodeProps）/ `exclusiveGateway` / `parallelGateway`（单网关直译，fork/join 前端显式成对，出边无条件）/ `inclusiveGateway`（默认分支同 exclusive）
    - 其余（serviceTask/callActivity/subProcess/timerCatch/timerBoundary/cc/ai/webhook）切片 2 后续补齐，遇到抛 400「暂不支持」
    - SequenceFlow = `{id,source,target,name?,waypoints?:[{x,y}],isDefault?,condition?:BranchCondition,expression?}`；condition 结构化经 `ConditionCompiler`→UEL（跨端字节兼容红线不变），expression 高级公式原样下发，二者互斥；isDefault 设网关 default

#### .bpmn 导入导出（N-B-02，附录 B「.bpmn 往返」；与 GraphToBpmnConverter 往返自洽）
- GET `/api/wf/models/{id}/bpmn`【登录即可，与现有 `process-defs/{code}/diagram` 定义查看一致】→ `R<String>`：返回该流程定义存档的 `bpmn_xml`（text 包在 R 里）。若 GRAPH 老数据仅存 `designer_json`（归一化 ProcessModel）而无 xml，则现转（designerJson→BpmnModel→`BpmnXMLConverter` 出 XML，只读不落库）；DINGTALK 老数据无 xml 时经 `JsonToBpmnConverter` 现转；无 xml 且无可转 designerJson → 400
- POST `/api/wf/models/import`【P:wf:def:edit】请求体=原始 `.bpmn` XML（`Content-Type: application/xml | text/xml | text/plain`）→ Flowable `BpmnXMLConverter.convertToBpmnModel` → **`BpmnToGraphConverter`（BpmnModel→ProcessModel，GraphToBpmnConverter 的逆）** → `R<BpmnImportResult>`
  - BpmnImportResult = `{model:ProcessModel, warnings:string[]}`；**仅还原供前端 react-flow（fromProcessModel）载入编辑，不落库、不部署**（前端编辑后再走 `/graph/deploy`）
  - **import 覆盖类型**（往返自洽核心）：startEvent / endEvent（含 terminate）/ userTask（读 `oa:` 扩展回 props：assigneeRules/emptyStrategy/multiMode/voteConfig/allowedOps/handleOptions/timeout/formPerms/auditMenu/commentRequired/events + formKey）/ exclusive·parallel·inclusiveGateway / serviceTask（按 delegateExpression 反查：`wfAutoDecide`→autoApprove·autoReject、`wfTriggerDelegate`→trigger、`wfScriptDelegate`→script、其余→delegate；`wfCcDelegate`→cc、`wfAiApprovalDelegate`→ai、`wfWebhookDelegate`→webhook 一等节点）/ callActivity / 嵌入式 subProcess（递归 children）/ timerCatch / timerBoundary
  - **条件逆向**：`oa:condition` 扩展存在 → 回结构化 `condition`（正向「供回编辑」存的原始 BranchCondition，operator 名形 eq/ne/gt… 无损保留，**不反解 UEL 符号**）；`${exprEval.evalBoolean(...)}` 包裹 → 解包回 `expression`；其余手写原始 UEL → 原样进 `expression`；网关 default 出边 → `isDefault`
  - **坐标从 DI 还原**：BPMNShape→position/size、BPMNEdge→waypoints；某节点无 DI → 兜底坐标 + warnings 标注「需前端自动布局(elk/dagre)」。未建模的其它 BPMN 元素类型 → 记 warning 跳过，不中断整体导入
- DINGTALK designerJson 结构：`{"nodes":[StepNode...]}`，StepNode：
    - approval：`{id,type:"approval",name,assigneeRules:[{kind:...,...}],multiMode:ANY|ALL|SEQUENCE|VOTE,emptyStrategy:AUTO_PASS|TO_ADMIN|BLOCK}`
      - **emptyStrategy 语义**：`AUTO_PASS`=审批人空则节点自动通过；`TO_ADMIN`=空则静默转管理员(admin)；`BLOCK`=**真阻塞**，审批人空即抛业务异常中断流转(发起/流转失败)，与 TO_ADMIN 明确区分
      （refs:[{kind:USER|DEPT|ROLE|POST,id}]，**前端 OrgPicker 统一用 id 制**（引擎亦兼容 username 回退，但设计器产出请用 id））
      - **办理人类型（精简后，按我们的组织模型）**：`kind:ACCOUNT|ROLE|POST|DEPT|LEADER|FORM_FIELD|INITIATOR|FORMULA`（兼容旧 `type`；旧 `FIND_LEADER` 并入 `LEADER`）：
        - `ACCOUNT`（指定人员）→ refs 按 id/username 取用户；`ROLE`（角色）→ 角色全员；`POST`（岗位）→ **优先读 `postName`(岗位名或编码)查 sys_post→展开该岗位任职用户**，再叠加 refs 里的 POST 引用；`DEPT`（部门）→ 部门全员（refs.kind 缺省按规则类型推断，ref 自带 kind 优先）；
        - `LEADER.level:N` → 沿申请人部门 ancestors 上溯第 N 级主管；`FORM_FIELD.field` → 表单人员字段；`INITIATOR` → 发起人本人；
        - `FORMULA.formula:"<表达式>"` → **自定义公式**（受限求值引擎）：取人函数 `USER(id...) / ROLE("名称") / DEPT(id) / POST("名称") / DEPT_LEADER(level) / INITIATOR()`、逻辑 `IF(cond,a,b) / AND / OR / NOT`（亦支持中缀 `&& || !`）、比较 `> < >= <= == !=`，操作数含表单字段标识符/数字/字符串/true·false。示例 `IF(days>3, ROLE("总经理"), DEPT_LEADER(1))`。**另可调用后端可扩展的 `@FormulaFunction` 函数**（`workDays/deptLeader/dictLabel` 及业务自定义，与计算/条件公式共享同一批），如 `IF(workDays(startDate,endDate) > 3, ROLE("总经理"), DEPT_LEADER(1))`；见「Tier 1 公式引擎」。求值失败降级空集 + 日志。
        - **已下线**：`GROUP / UNIT / SERVICE_API / ROLE_POST`——收到时按空/退化处理不报错（refs 自带 kind 仍可展开），前端不再产出。
        - **来源** `source:RELATED_TO_APPLICANT` + `sourceValue:APPLICANT|APPLICANT_DEPT|APPLICANT_DEPT_LEADER|APPLICANT_DEPT_LEADER_2...` 仍兼容，置 source 后优先于 kind/refs
      - **多人模式统一**：以基础属性 `multiMode`(ANY 或签/ALL 会签/SEQUENCE 依次/VOTE 票签) 为准；旧高级「办理选项签署模式」`handleOptions.signMode` 已删，后端不再读取
    - condition：`{id,type:"condition",name,branches:[{id,name,logic:"AND"|"OR",conditions:[{field,operator,value}],steps:[StepNode...]}|{default:true,steps:[...]}]}`
      operator 白名单：== != > >= < <=；`logic` 缺省 AND（→ `&&`），OR → `||`，多条件按 logic 连接编译为 UEL（如 `${amount > 1000 || urgent == true}`，禁用户手写 UEL）；每个 condition 节点须含且仅含一个 `default:true` 默认分支
    - cc：`{id,type:"cc",name,users:[{kind:"USER",id}]}`（同用 id 制，兼容 username 回退）
    - **P1-C 节点级 nodeConfig（approval 节点，写入 BPMN extensionElements）**：`allowedOps:[approve|reject|transfer|delegate|addSign|counterSign|reduceSign|assist|retrieve|print...]`（按钮操作白名单，运行时详情 allowedOps 据此覆盖默认全集；**服务端强制**：approve/reject/transfer/delegate/addSign/counterSign/reduceSign/assist 等操作若不在白名单内直接 403，不再仅约束 UI；无 allowedOps=全放行）、`handleOptions:{candidate?,historyFirst?,autoSkip?}`（办理选项，P1 存储 P2 落地）
    - **P2/P3 节点级 nodeConfig（approval 节点扩展，写入 BPMN extensionElements + 运行时生效）**：
      - `handleOptions` 精简为 `{candidate,historyFirst,autoSkip}`（引擎生效）+ `{accountChecked,accountDisabled}`（纯前端办理页勾选态，随详情透传）：
        **candidate**=true → 任务入公共池待认领（等价 groupMode:CLAIM）；**historyFirst**=true → 节点再次进入改用该节点历史办理人；**autoSkip**=true → 申请人本人不审自己 + 本实例已办过者去重，符合则集合空→节点自动通过。
        （**已下线空壳**：accountSort/limitRange/includeSelf/includeConcurrent/completeLimit/warnLimit——前端不再产出，后端不再作为契约）
      - `auditMenu`：简化为 `{allowJump:bool,allowReturn:bool}`（是否允许跳转/退回），随详情 `auditMenu` 透传，前端据此展示按钮（复用 P2 jump/reject 能力）。（旧 `special` 的 JUMP_WAIT_*/RETURN 细分已下线）
      - `commentRequired:bool`：审批意见必填，approve 无 comment → 400
      - `events:[{trigger,action:NOTIFY|WEBHOOK|SCRIPT|API|DELEGATE,blocking?:boolean,notify:{to:[OrgRef],template},webhookUrl,script:{lang,code},api:{method,url,headers?,body?},delegate:{bean}}]`：**6 种真触发**节点事件（trigger=ACTIVITY_CONFIRM_PARTICIPANTS/TASK_AFTER_CREATED/TASK_BEFORE_COMPLETE/TASK_AFTER_COMPLETE/TASK_BEFORE_UNDO/TASK_AFTER_UNDO；其余 FORM_*/SUSPEND/RESUME/TIMEOUT 等已下线）。
        转换器按 trigger 挂 taskListener（create/complete/delete）+ 整条 events blob 随 `oa:events` 落库（`BpmnToGraph` 对称读回），运行时由 `wfEventDelegate` 统一分发：**NOTIFY**=站内通知目标人（template 为内容）、**WEBHOOK**=异步 POST 外部 URL、**SCRIPT**=交 `ScriptService` 执行（lang∈groovy|js|python，注入 vars/form/execution，vars 增改回写流程变量；同 `wf:script:write` 治理）、**API**=完整 HTTP（headers 每行 `Name: Value`）、**DELEGATE**=自定义监听器（按 `delegate.bean` 取实现 `WfEventHandler` 的 Spring bean 调 `handle(ctx)`；bean 不存在/类型不符→清晰 400；同 `wf:script:write` 治理，前端配置入口 gate 该权限）。
      - **阻断办理 `blocking?:boolean`（默认 false）**：**仅在前置触发点生效**——`TASK_BEFORE_COMPLETE`/`TASK_BEFORE_UNDO`（及流程 `PROCESS_START`）；AFTER 类触发点 blocking 无意义（动作已发生）被忽略。`blocking=true` 不走 safeDispatch，异常上抛 → completeTask 事务回滚 → **approve/reject 端点返回 400「办理被拦截：…」、任务仍在**。映射：**SCRIPT** 脚本返回 `Boolean false` 或抛异常 → 400「办理被拦截：…」；**API** 响应非 2xx（或调用失败）→ 400；**DELEGATE** handler 抛异常 → 原样上抛（其 BusinessException code/msg 直达前端）。`blocking=false`=现状（safeDispatch 吞异常、记 `wf_script_exec_log`/日志，不打断办理）。内置示例监听器 bean `demoBudgetGuard`（预算超限 `budget>10000` 抛异常拦截，可 `delegate.limit` 覆盖上限）。
      - `formPerms:{field:HIDDEN|READ|EDIT}`（P3 节点表单字段权限，详情 nodeFormPerms 返回）、`timeout:{hours|seconds,action:REMIND|AUTO_PASS|AUTO_REJECT,remindEvery}`（P2 超时基建；**TRANSFER action 已下线**，扫描器未实现，落到 REMIND 默认）
  - **P1-C/P3 顶层 flowConfig（designerJson.flowConfig，写入 process extensionElements oa:flowConfig；亦可经请求体 flowConfig 存 wf_process_ext.flow_config 列）**：
    `{operations:{terminate,retrieve,urge,cancel},start:{scope:[OrgRef],taskTitle},variables:[{name,type,defaultValue}]}`
    - **operations 开关（已落地强制）**：`cancel/terminate/urge/retrieve` 布尔，缺省=允许，显式 `false` 关闭对应操作——详情 `canCancel` 随 cancel 开关，撤销/终止/催办/拿回端点关闭时返回 **403**
    - **start.scope 发起权限（已落地强制）**：`scope:[OrgRef{kind:USER|DEPT|ROLE,id}]` 展开为允许发起的用户集合；**空/缺省=不限（人人可发起）**。`GET /api/wf/startable` 仅返回当前用户在 scope 内的流程；`POST /api/wf/instances` 校验发起人在 scope 内，否则 **403**
    - **P3 落地**：`variables` 发起时注入流程变量（number/boolean/string 按 type 转换，不覆盖表单同名字段，供条件网关路由）；`start.taskTitle` fx 模板发起时插值生成实例标题（未显式传 title 时；占位 `${field}` 与 `{field}`，内置 `initiatorName`/别名 `申请人`）
    - **已下线的 flowConfig 空壳**：`operations.cancelOptions/track`、`security(secretLevel/formSecurity)`、`misc(completeLimit/warnLimit/level/modelCategory)`、`signals`、`messages`、`start.taskSummary/mobileStart` 等（前端不再产出，后端不再作为契约）

### 发起
- GET `/api/wf/startable` → [StartableItem{defCode,name,category,icon,formCode,formVersion,formSchema,formType,formSubmitPath,formViewPath}]（已发布流程卡片墙；formType=CUSTOM 时前端卡片点击跳转 formSubmitPath 而非弹动态表单）
- POST `/api/wf/instances` {defCode,formData:{...},title?} → InstanceDetail（title 默认「{发起人}的{流程名}」；formData 快照进 wf_instance_ext 并扁平化为流程变量供条件判断；CUSTOM 表单的 formData 由自定义页面提交，后端照存不做动态 schema 校验）

### 实例
InstanceListItem = {id,procInstId,defCode,defName,title,bizStatus:RUNNING|APPROVED|REJECTED|CANCELED|TERMINATED,initiatorId,initiatorName,createdAt,endedAt}
InstanceDetail = {id,procInstId,defCode,defName,title,bizStatus:RUNNING|APPROVED|REJECTED|CANCELED|TERMINATED|DRAFT,initiatorId,initiatorName,createdAt,endedAt,formSchema,formData,
  currentNodes:[{nodeId,nodeName,assignees:[{userId,name,status}]}],
  timeline:[{nodeId,nodeName,actorName,action,comment,createdAt}],
  highlight:{completed:[activityId],active:[activityId]}, bpmnXml, canCancel, myTaskId,
  allowedOps:[string], isAdmin, jumpTargets:[{nodeId,name}], comments:[{taskId,fromName,content,createdAt}], readByMe,
  currentHandlers:[{userId,name,taskId}],
  subInstances:[{nodeId,subInstanceId,title,bizStatus}], predictable, resurrectable, seals:[{nodeName,sealImageUrl,userName,time}], bizTime, nodeFormPerms:{field:"HIDDEN"|"READ"|"EDIT"},
  formType:DYNAMIC|CUSTOM, formViewPath,
  nodeHandleOptions:{candidate?,historyFirst?,autoSkip?,accountChecked?,accountDisabled?}, auditMenu:{allowJump?,allowReturn?}}
  （P1-C 扩展：formType=CUSTOM 时前端详情表单区改用 formViewPath 路由/内嵌 + formData 只读展示；DYNAMIC 走表单快照）
  （P2 扩展：allowedOps=我当前任务可用操作(节点白名单∩权限)；isAdmin=我有 wf:instance:admin；jumpTargets=可跳转/驳回办理节点；comments=沟通线程；readByMe=我是否已阅；currentHandlers=我所在节点除我以外的活动处理人，供减签勾选）
  （P3 扩展：subInstances=CallActivity 子流程入口(活动+历史)；predictable=运行中可预测；resurrectable=已结束可唤醒；seals=已用电子章；bizTime=穿越时空业务时间(本地时区)；nodeFormPerms=当前节点表单字段权限，前端 FormRenderer 按此显隐/只读）
  （P2/P3 透传：nodeHandleOptions=当前节点办理选项(候选/历史优先/自动跳过/账户勾选/限制范围等)，前端渲染开关态；auditMenu=当前节点审核菜单声明的 JUMP/RETURN 动作，前端据此展示跳转/退回按钮）
  健壮性：转办/委派/加签/协办/追加节点等选人操作若传入不存在的 userId → 400 业务错误（不静默创建幽灵任务）
- GET `/api/wf/instances/my?pageNum=&pageSize=` → PageResult<InstanceListItem>（发起人=me）
- GET `/api/wf/instances/{id}` → InstanceDetail（打开即记抄送已读）
- POST `/api/wf/instances/{id}/cancel` → InstanceDetail（仅发起人且无节点通过 → CANCELED）
- POST `/api/wf/instances/{id}/resubmit` {formData?} → InstanceDetail（仅被退回 REJECTED 的实例；可改表单后重新发起，复用同一实例行）
- GET `/api/wf/instances/cc?pageNum=&pageSize=` → PageResult<CcItem{id,procInstId,title,defName,initiatorName,bizStatus,readFlag,createdAt}>

### 任务
TaskItem = {taskId,procInstId,instanceTitle,defName,nodeName,initiatorName,createdAt,groupClaim,delegated}
（groupClaim=待认领的公共池任务；delegated=委派受托中）
- GET `/api/wf/tasks/todo?pageNum=&pageSize=` → PageResult<TaskItem>（assignee=me 或 我为候选/代理 的活动任务；已转办/委派出去的不再出现）
- GET `/api/wf/tasks/done?pageNum=&pageSize=` → PageResult<TaskItem>（me 已完成的历史任务）
- POST `/api/wf/tasks/{id}/approve` {comment?,attachments?:number[],formData?} → addComment + wf_operation(APPROVE) + complete（formData 可改表单/影响后续条件；委派受托人 approve = resolveTask 回委派人；票签节点自动记赞成票）
- POST `/api/wf/tasks/{id}/reject` {comment,target:"PREV"|"START"|"NODE",targetNodeId?,resumeStrategy?:"CONTINUE"|"BACK"} → wf_operation(REJECT)；START=退回发起人（实例 REJECTED 可重提）；PREV=退回上一步；NODE=任意指定节点（ChangeActivityState.moveActivityIdsToSingleActivityId）；resumeStrategy CONTINUE=被驳节点重审后跳回驳回点续走 / BACK=重走中间路径(默认)
  仅任务当前办理人（或候选/代理人）可操作，否则 403

### 任务操作（P2 中国式全家桶，前缀 /api/wf/tasks/{id}）
所有选人入参统一 OrgRef `{kind:"USER"|"DEPT"|"ROLE", id:<number>}`；均写 wf_operation 审计 + 通知。
- POST `add-sign` {mode:"PRE"|"POST",users:[OrgRef],comment?} → 加签（**串行链**，wf_add_sign）：把当前任务沿链依次流转，不复用节点多实例（避免 ANY 或签退化）。**PRE**=被加签人先审→回到原审批人→原审批人审→下一节点（顺序 B→A→next）；**POST**=原审批人先审→被加签人审→下一节点（顺序 A→B→next）。链上每步照写 wf_operation + 通知；末位审批才真正推进节点
- POST `counter-sign` {users:[OrgRef],comment?} → 并签：追加平行审批人
- POST `reduce-sign` {removeUserIds:[number]} → 减签：移除本节点未办理的其他审批人（deleteMultiInstanceExecution，剩余≥1）
- POST `transfer` {user:OrgRef,comment?} → 转办：setOwner(我)+setAssignee(对方)，责任转移
- POST `delegate` {user:OrgRef,comment?} → 委派：delegateTask，对方 approve 后 resolve 回我，我再提交
- POST `retrieve` {comment?} → 拿回：我已办任务在下一节点无人处理前取回重办（{id}=我的历史任务 id）
- POST `assist` {users:[OrgRef],comment} → 协办/征求意见：建独立 ad-hoc 意见任务，不参与主流程完成条件
- POST `complete-adhoc` {comment?} → 办理协办/追加节点的 ad-hoc 任务（意见汇入时间线）
- POST `communicate` {toUserIds:[number],content} → 沟通留言（不影响流转，通知对方，入详情 comments 线程）
- POST `read` → 已阅标记（wf_task_read）
- POST `claim` / POST `unclaim` → 认领 / 退回公共池（分组 CLAIM 节点候选任务）

### 流转控制 + 治理（前缀 /api/wf）
- POST `/api/wf/instances/{id}/jump` {targetNodeId,comment?}【P:wf:instance:admin】→ 管理员跳转到任意办理节点
- POST `/api/wf/instances/{id}/terminate` {comment?}【P:wf:instance:admin】→ 终止实例（biz_status=TERMINATED）
- POST `/api/wf/instances/{id}/urge` {comment?} → 催办当前处理人（通知+记录，可重复）
- POST `/api/wf/instances/{id}/append-node` {afterNodeId?,name,assignees:[OrgRef],multiMode?} → 追加节点：实例级动态加处理人（ad-hoc，不改定义）
- GET `/api/wf/instances/admin?status=&keyword=&pageNum=&pageSize=`【P:wf:instance:admin】→ PageResult<InstanceListItem> 管理员全实例检索
- POST `/api/wf/handover` {fromUserId,toUserId,comment?}【P:wf:instance:admin】→ Integer 离职交接：批量转办某人全部在途任务，返回转交条数

### 流程监控（管理员视角，供「流程监控」页）
- GET `/api/wf/monitor/overview`【P:wf:instance:admin】→ 运行态总览（wf_instance_ext 聚合）
  `{total,running,approved,rejected,canceled,terminated,timeout,byDef:[{defCode,defName,count}]}`
  （total=非草稿实例总数；timeout=当前有超时活动任务的实例数，按超时扫描器口径读节点 oa:timeout 配置，无则 0；byDef=按流程定义维度实例数）
- GET `/api/wf/monitor/bottleneck`【P:wf:instance:admin】→ 节点瓶颈分析（ACT_HI_ACTINST 聚合 userTask 已完成活动）
  `[{defCode,defName,nodeId,nodeName,avgDurationMs,count}]`（各 userTask 节点平均停留时长 avg(duration_) + 样本数，按 avgDurationMs 降序找最慢节点）

### 暂存草稿（P2-C，biz_status=DRAFT，不启动引擎）
- POST `/api/wf/instances/draft` {defCode,formData,title?} → InstanceListItem（proc_inst_id 用 DRAFT- 占位）
- PUT `/api/wf/instances/{id}/draft` {formData?,title?} → InstanceListItem（仅 DRAFT + 本人）
- POST `/api/wf/instances/{id}/submit` {formData?} → InstanceDetail（激活：启动引擎，DRAFT→RUNNING）
- GET `/api/wf/instances/drafts?pageNum=&pageSize=` → PageResult<InstanceListItem>（我的草稿）

### 委托规则（P2-D 代理预设）
DelegateRuleItem = {id,ownerId,delegateToId,delegateToName,defCode,startDate,endDate,enabled,createdAt}
- GET `/api/wf/delegate-rules` → [DelegateRuleItem]（owner=me）
- POST `/api/wf/delegate-rules` {delegateToId,defCode?(null=全部),startDate?,endDate?,enabled?} → 命中时任务创建自动给受托人挂 candidate，双方可见可办，任一办结即结束
- DELETE `/api/wf/delegate-rules/{id}`

### 定义侧引擎增强（P2-E，DINGTALK 节点属性，转换器生成，无新增运行时 API）
- 票签 VOTE：approval 节点 `multiMode:"VOTE"` + `voteConfig:{threshold:0.5,weights?:{userId:weight}}` → 并行多实例 + completionCondition `wfVote.pass(execution)`（投票记录 wf_vote，过阈值提前完成、剩余票收敛）：
  - **无 weights → 按比例**（每人等权）：赞成人数 / 总办理人数(多实例 nrOfInstances) > threshold 才通过（非旧的「一票即通过」）；
  - **有 weights → 按权重**：赞成权重和 > threshold × 总权重
- 包容分支：`type:"inclusive"` 或 condition 节点 `gatewayType:"INCLUSIVE"`（缺省 EXCLUSIVE）→ inclusiveGateway，满足的多分支都走并汇聚，全不满足走 default
- 并行分支：`{id,type:"parallel",name,branches:[{steps:[StepNode...]}...]}` → parallelGateway fork（无条件全激活各分支）→ parallelGateway join 汇聚（全部到达才继续）
- 自动通过：`{id,type:"autoApprove",name}` → serviceTask `${wfAutoDecide}`，到达即记 wf_operation.action=AUTO_APPROVE 并放行后续节点
- 自动拒绝：`{id,type:"autoReject",name}` → serviceTask `${wfAutoDecide}` 记 action=AUTO_REJECT 并把实例置 REJECTED，随后 terminateEndEvent 终止整实例（其后节点不可达；发起即终止的边界由 InstanceService 依 AUTO_REJECT 操作修正落库状态）
- 分组策略：approval 节点 `groupMode:"CLAIM"` → candidateUsers 运行时求值，任务入池待 claim；缺省(或 ALL)=展开成员进多实例
- 超时：approval 节点 `timeout:{hours|seconds,action:"REMIND"|"AUTO_PASS"|"AUTO_REJECT",remindEvery?(秒)}` → 服务层扫描器(WfTimeoutScheduler，等价 timer)驱动，REMIND 按 remindEvery 重复提醒
- 操作白名单：approval 节点 `allowedOps:[...]` → 详情 allowedOps 据此约束（缺省全集）；**服务端强制**：白名单外的 approve/reject/transfer/delegate/addSign/counterSign/reduceSign/assist 操作直接 403
- WEBHOOK 事件：`webhook` 节点 `{type:"webhook",name,url}` → serviceTask delegateExpression `wfWebhookDelegate`，异步 POST 实例上下文 JSON({event,procInstId,nodeId,defCode,title,bizStatus})，失败重试+日志，不阻塞流转
- 通知渠道 SPI：NotifyChannel（内置 STATION 站内 wf_notify + LOG 日志；短信/邮件/微信/钉钉实现接口注册 bean 即自动纳入 NotifyDispatcher 分发）

### 通知（站内收件箱 wf_notify，type=TODO 待办到达 / RESULT 结果 / URGE 催办 / CC 抄送）
NotifyItem = {id,type,title,content,procInstId,readFlag,createdAt}
- GET `/api/wf/notifies?pageNum=&pageSize=` → PageResult<NotifyItem>
- GET `/api/wf/notifies/unread-count` → Long
- POST `/api/wf/notifies/{id}/read`；POST `/api/wf/notifies/read-all`

### P3 高级能力（前缀 /api/wf）
运行时端点：
- POST `/api/wf/instances/{id}/predict` → `{path:[{nodeId,nodeName,type,assignees:[{name}]}], note?}` 流程预测：按当前表单值/流程变量静态 DFS 走 designerJson，条件分支离线求值（结构化条件，白名单操作符），输出后续未完成节点 + 预计审批人（离线试算 ORG/LEADER/FORM_FIELD/INITIATOR），不落库；BPMN 专业模式返回空 path + note
- POST `/api/wf/instances/{id}/resurrect` {nodeId,comment?}【P:wf:instance:admin】（B-11：唤醒为治理操作，复用流程管理员权限，非管理员 403）→ InstanceDetail 唤醒：仅已结束实例(APPROVED/REJECTED/TERMINATED/CANCELED)按快照(form_data)重建新实例并 ChangeActivityState 定位到 nodeId 重审，复用同一 ext 行(proc_inst_id 更新)，ext.resurrect_from 记原实例，通知发起人
- POST `/api/wf/instances`（增强）可选 `bizTime`(ISO 日期 yyyy-MM-dd 或带时区日期时间) → 穿越时空：ext.biz_time + 首个 SUBMIT 操作 biz_time 记录；详情 bizTime 按服务器本地时区展示，引擎真实时间不动
- POST `/api/wf/instances/{id}/adhoc-task` {name,assignees:[OrgRef]} → 动态构建 ad-hoc 任务（taskService.newTask，不体现在流程图、不参与主流程完成条件，服务层管理；办理走 tasks/{id}/complete-adhoc）

电子章管理（SealItem = {id,name,imageFileId,imageUrl,enabled,createdAt}；imageUrl=/api/infra/files/{imageFileId}/download）：
- GET `/api/wf/seals` → [SealItem]（登录即可）
- POST `/api/wf/seals` {name,imageFileId?,enabled?}【P:wf:def:edit】→ SealItem
- PUT `/api/wf/seals/{id}` {name?,imageFileId?,enabled?}【P:wf:def:edit】→ SealItem
- DELETE `/api/wf/seals/{id}`【P:wf:def:edit】

打印/盖章：无需新端点，前端用 GET instances/{id}（表单快照 + timeline + seals）渲染套打页 + 浏览器打印。

### 定义侧 P3 节点类型（DINGTALK designerJson，JsonToBpmnConverter 生成，无新增运行时 API）
- 子流程 `{type:"subprocess",name,defCode,async:bool,paramMap?:{子变量:父字段}}` → CallActivity(calledElement=defCode,inheritVariables=true,inParameters=paramMap)；**同步** async=false 主流程等子流程结束再继续；**异步** async=true 并行网关旁路(fork→子流程分支到独立 end + 主流程分支继续，不阻塞)。被调子流程需先部署。详情 subInstances 展示父子联动
- 定时 `{type:"timer",name,mode:"duration"|"date",value}` → intermediateCatchEvent(timerEventDefinition，duration=ISO-8601 如 PT5S / date=时间点)，AsyncExecutor 驱动到期进入下一步
- 触发 `{type:"trigger",name,triggerType:"IMMEDIATE"|"TIMER",handler?,webhookUrl?,config?,timer?}` → serviceTask delegateExpression `wfTriggerDelegate`：handler 命中注册的 `WfTrigger` bean(可写流程变量影响路由)，否则 webhookUrl 异步 POST；TIMER 前置一个 timer 事件。内置示例触发器 bean `wfEchoTrigger`。SPI：实现 `WfTrigger` 注册 bean，节点 handler 指向 bean 名
- AI 审批 `{type:"ai",name,model?,systemPrompt?,formContext?:[字段],outputMap?:{approve/reject/route→变量}}` → serviceTask delegateExpression `wfAiApprovalDelegate`：组装表单上下文交 `AiApprovalProvider` 决策 → 写 wf_operation(actor=AI,action=AI_APPROVE,意见) + 按 outputMap 设流程变量(供后续排它网关路由)。**AI SPI**：默认实现 enabled 且有 key 走 OpenAI 兼容 chat completions；无 key 降级规则模拟并在意见明示「AI模拟」。配置 `oa.ai.{enabled,base-url,api-key,model,timeout-seconds}`(默认 enabled=false)
- 节点表单字段权限 `approval` 节点 `formPerms:{field:"HIDDEN"|"READ"|"EDIT"}` → 存扩展元素，详情/待办按当前节点返回 nodeFormPerms，前端 FormRenderer 按此显隐/只读

### Tier 1 公式引擎（Aviator 安全表达式，N-B-04；两套公式共享同一批可扩展函数）
公式 = 安全、无副作用、白名单纯函数。**两套公式共用同一批 `@FormulaFunction` 扩展函数**：
- **计算/条件公式**：跑 Aviator `ExpressionService`（内置运算 + 全部 `@FormulaFunction`）。
- **取人办理人公式**（assignee `FORMULA` 来源）：跑工作流受限求值器 `FormulaEvaluator`（取人 `USER/ROLE/DEPT/POST/DEPT_LEADER/INITIATOR` + 逻辑 `IF/AND/OR/NOT` + 比较），**它不认识的函数名（如 `workDays/deptLeader/dictLabel` 及任意业务自定义 `@FormulaFunction`）委托到 Aviator 引擎求值**。故 `IF(workDays(startDate,endDate) > 3, ROLE("总经理"), DEPT_LEADER(1))` 可求值；自定义函数直接返回用户 id（Long）时，顶层归约为单人办理人。业务方新增一个 `@FormulaFunction` Bean → 两套公式皆自动可用。
- POST `/api/wf/expression/eval` {expr,context?:{字段:值},asBoolean?}【P:wf:instance:admin】→ 求值结果（asBoolean=true 按真值语义返回 boolean）；表达式沙箱（禁 new/反射/静态/循环）。
- GET `/api/wf/expression/functions`【登录即可】→ `R<List<FnMeta>>`，`FnMeta={name,signature,category,description}`。合并「取人公式专属项」（category=`ASSIGNEE`/`LOGIC`/`COMPARE`，静态镜像 `FormulaEvaluator` 内置函数）与「后端可扩展函数」（category=`CUSTOM`，遍历 `@FormulaFunction` 注册表：name 取 `AbstractFunction#getName()`，signature/description 拆自注解 `value` 的 `→` 前后）。供前端「取人公式」与「计算/条件公式」两个编辑器动态展示函数面板。

### Tier 2 脚本引擎（LiteFlow，N-B-05/06/07；GRAPH 设计器 scriptTask）
后端脚本 = 完整应用权限、可有副作用，**非沙箱**（诚实标注）。治理：作者权限收口 `wf:script:write`（仅管理员）+ 脚本是部署态工件（不接受运行时用户注入）+ 每次执行落审计 `wf_script_exec_log`（V18）+ 执行超时看护。
- **引擎**：LiteFlow 2.16.0（`liteflow-spring-boot4-starter` + groovy/graaljs/python 插件），`liteflow.enable=false`（只用其多语言脚本执行 SPI + `@ScriptBean` 门面，不用链路编排，对现有启动零影响）。语言 `lang∈groovy|js|python`（js=GraalJS；python=Jython/Py2，无 C 扩展）。脚本超时 `oa.wf.script.timeout-ms`（默认 5000ms）。
- **脚本上下文变量**（注入脚本绑定）：`vars`(流程变量读写 Map，脚本增改由 wfScriptDelegate 回写为流程变量)、`form`(表单数据 Map)、`execution`(Flowable DelegateExecution，测试运行时为 null)、`spring`(门面：`spring.bean("名")`/`spring.bean(类.class)`/`spring.has("名")` 取任意 Spring Bean)、`log`(`log.info/warn/error`)。**JS 用最后语句值/表达式返回，不支持顶层 return**；Groovy/Python 支持 `return`。
- **scriptTask 序列化约定（GRAPH ProcessModel，`GraphToBpmnConverter` 生成）**：脚本节点 = `serviceTask` 节点 + 顶层 `script`：`{type:"serviceTask", service:{impl:"script"}, script:{lang:"groovy|js|python", code:"..."}}` → serviceTask delegateExpression `${wfScriptDelegate}`，`lang`/`code` 存节点扩展元素 `oa:scriptLang`/`oa:scriptCode`；缺 lang/code → 400。运行时 `wfScriptDelegate` 读出交 `ScriptService` 执行。
  - **前端需补（N-F-09，model.ts）**：`ServiceTaskConfig` 联合当前无 `script` 分支——需增 `{ impl:"script" }`，并在 `ServiceTaskNode` 增可选 `script?: { lang:"groovy"|"js"|"python"; code:string }`（脚本节点=serviceTask 且 service.impl="script" + 节点级 script 承载 lang/code；与后端 `FlowNodeDto.script` 对齐）。
- **测试运行端点**：POST `/api/wf/script/test-run` {lang,code,sampleVars?:{}}【P:wf:script:write】→ `ScriptTestRunResult{success,result?,resultType?,vars,costMs,error?}`（编译/运行/超时错误以 success=false + error 承载于 R.ok，供编辑器展示；同权限、同审计）。
- **种子（V18）**：权限码 `wf:script:write`（流程脚本编写，BUTTON，授 ADMIN）；审计表 `wf_script_exec_log`(who/script_ref/lang/source[TASK|TEST_RUN]/success/cost_ms/error_msg/created_at)。

### 种子（V7 + WorkflowInitializer 启动部署）
- 表单定义「请假申请单」(code=leave,v1,PUBLISHED)：请假类型 select / 开始日期 / 结束日期 / 天数 number / 事由 textarea
- 流程定义「请假审批」(defCode=leave_approval,DINGTALK)：发起 → 部门经理(LEADER level1,ANY) → 条件(天数>3 → 总经理 admin，否则跳过) → 抄送 hr(zhangsan) → 结束
  （V7 将请假发起人所在「人事行政部」leader 设为王经理 manager，使 LEADER level1 解析出与总经理 admin 不同的审批人）
- 权限点：workflow(MENU)、wf:def:edit(BUTTON)、wf:instance:admin(BUTTON，跳转/终止/交接/管理员列表) 授予 ADMIN
- P2 业务表：wf_delegate_rule(委托规则)、wf_task_read(已阅,V10)、wf_vote(票签权重,V11)、wf_add_sign(加签串行链,V12)；测试用户 lisi(李四)/wangwu(王五) 主任职人事行政部(V9)
- P3(V13)：wf_instance_ext 增 biz_time(穿越时空)/resurrect_from(唤醒来源)、wf_operation 增 biz_time；电子章沿用 V7 的 wf_seal；子流程/定时/触发/AI 为纯 BPMN 转换无新表。AI 配置 oa.ai.*(application.yml，默认 enabled=false)

## 自动化逻辑编排（oa-module-workflow orch 域，V25，前缀 `/api/orch`）
> 契约 `docs/design/orchestration-design.md`。引擎=LiteFlow 2.16（**编程式 FlowExecutor**，`liteflow.enable` 保持 false 不影响脚本 SPI）；OrchModel(designer_json) 发布时经 `OrchToElCompiler` 编译缓存 el_expr（校验：单 trigger/无环/条件默认支/动作单出边）。模板插值 `{{Aviator表达式}}`（上下文 payload/vars/outputs，`OrchTemplate` 唯一真源）；内置函数 now()/today()/uuid()/dateFormat()/jsonGet()（@FormulaFunction 注册，全域可用）。
>
> 节点（本批）：trigger/http(credentialId 认证注入+retry.backoff+responseType)/script(复用 ScriptService，绑定 vars 可写+form.payload/form.outputs 只读)/condition(SWITCH，出边 expression 或结构化条件+isDefault)/dataMap(assignments:[{target,expr}]，兼容旧 assigns)/llm(§4 OpenAI-compatible，凭据只存 credentialId，TEXT|JSON)/notify/delay(≤5min)/startApproval(引擎直起+__wfRegister 一等实例)/subFlow(深度≤5,waitResult)/end(output 表达式=流水结果)。parallel/loop 下一批。
> 通用节点字段：`retry{times≤10,intervalMs,backoff}`、`onError ABORT|CONTINUE`、`saveAs`。执行：异步线程池+整流 10min 护栏；节点留痕 input/output 截 8KB/attempts/costMs；整流失败触发 error_flow_id（错误流失败不级联）。

- GET `/flows?keyword=&pageNum=`【P:orch:flow:read】列表（含 id/code/triggerType/enabled/version/webhookToken/lastExecStatus/lastExecAt，不含 designerJson）
- GET `/flows/{key}`【read】详情（key 纯数字=id 否则=code；含 designerJson+webhookToken）
- POST `/flows` {code*,name,designerJson?,remark?,errorFlowId?}【P:orch:flow:write】；PUT `/flows/{id}`；DELETE `/flows/{id}`
- POST `/flows/{id}/publish`【write】编译校验→el_expr+version+1（编译错误 400 带原因）；POST `/flows/{id}/enable` {enabled}【write】（空 body 按 enabled=true；未发布不可启用）
- POST `/flows/{id}/hook-token/reset`【write】重置 webhook token
- POST `/flows/{id}/run` body=payload(任意 JSON)【P:orch:flow:run】→ {execId}（异步执行）
- GET `/execs?flowId=&status=&pageNum=&pageSize=`【read】流水分页；GET `/execs/{id}`【read】→ {exec, nodes[{nodeId,nodeName,status,attempts,input,output,error,costMs,startedAt}]}
- POST `/execs/{id}/rerun`【run】同 payload 新流水 → {execId}
- 凭据【write】：GET/POST `/credentials`、PUT/DELETE `/credentials/{id}`；type=LLM|HTTP_BEARER|HTTP_BASIC|HTTP_HEADER，{name,type,baseUrl?,apiKey?(只写不回显),model?,headerName?,enabled}→ 响应含 hasKey
- 权限码：orch:flow:read / orch:flow:write（受信，同 wf:script:write 级）/ orch:flow:run（V25 授 ADMIN）
- **触发器（第二批已全量落地）**：
  - CRON：`OrchCronScheduler`（Spring TaskScheduler 动态注册；enabled+已发布+triggerType=CRON 才调度；发布/启停/更新/删除即刷新；表达式=Spring 6 段，发布时校验。**集群扩展点**：单实例内存调度，多实例需换 xxl-job/ShedLock，替换 schedule() 即可）。
  - EVENT：`OrchEventBridge`（桥接共享 Flowable 引擎事件）。订阅形状 trigger 节点 config.event=`{source, type, defCode?}`。事件目录：source=WF → INSTANCE_COMPLETED / TASK_COMPLETED；source=GONGWEN → ISSUED/SEALED/PUBLISHED/FINISHED（gw_send/gw_recv 锁定节点映射）。**payload 形状**：`{source, type, defCode, procInstId, title?, initiatorId?, initiatorName?, nodeId?, nodeName?, businessKey?, documentId?}`。防自触发死循环：编排 startApproval 起的实例带 __orchDepth，≥2 不再触发。
  - WEBHOOK：POST `/api/orch/hooks/{token}`（免登录 permitAll；token 匹配 enabled+已发布+triggerType=WEBHOOK 的流，否则 404；限流 60 次/token/分钟 → 429；body=payload）→ {execId}。
- **节点（第二批补齐）**：parallel（OPEN N 条出边=并行分支 → 编译 WHEN，全部分支须汇聚同一 JOIN(mode=JOIN)，JOIN 单出边续接）；loop（编译 ITERATOR，config {collection 表达式, itemVar 默认 item, maxIterations≤1000}，两条出边：`loopBody:true`=循环体入口（体内自然终止不回连）+ 一条循环后续接；每次迭代写 vars[itemVar]/vars[itemVar+"Index"]）。
- **onError=BRANCH 契约**：动作节点恰两条出边——`errorBranch:true`=失败支、另一条=成功支；节点失败不中断，vars.__lastError 带错误信息，orchErrorRouter 路由失败支（编译 THEN(动作, SWITCH(errorRouter))）。
- **批3（§9）**：
  - `agent` 节点：OpenAI function-calling 循环（config 见 §9.1：credentialId/tools 内嵌 HTTP|SCRIPT 实现/maxSteps≤15/timeoutMs/outputMode）；HTTP 工具模板可用 `{{args.xxx}}`；节点输出 `{result, steps[{step,tool,args,result}], warning?}`。
  - `wait` 节点 + 挂起：分段链（主段 EL 到 wait 为止；恢复段现场编译）；exec 状态 **WAITING** + `resumeToken`/`currentSegment` 列；POST `/api/orch/resume/{token}`（免登录 permitAll+限流，body 存 wait.saveAs）恢复；超时（timeoutMs 默认 24h，内存定时器+启动恢复扫描）→ FAILED(error=wait timeout) 或节点 onError=CONTINUE 续跑；校验 wait 不得在 parallel/loop 体内（发布 400）。
  - 失败续跑：POST `/api/orch/execs/{id}/resume-from-failure`【run】→ 新 exec（`parentExecId` 血缘），复用父 `context_snapshot`（**完整上下文 JSON 列**：{payload,vars,outputs,failedNodes[,waitNodeId,waitDeadline]}，节点留痕 8KB 截断仅展示用），从失败节点(含)段起跑；失败点在 parallel/loop 体内 400。
  - `respond` 节点 + webhook 同步响应：hooks 端点在流含 respond 时同步等待其执行（trigger config.syncTimeoutMs 默认 10s，超时/未达 respond 回退 **202+execId**），返回 respond 的 status/contentType/body（**非 R 信封**）；respond 后续节点继续异步；非 webhook 触发时 respond 等价 dataMap。
  - ExecResponse 增 `resumeToken/currentSegment/parentExecId`。
- **批4（§9.5）**：
  - `dingtalkBot` 节点：{url, secret?(HmacSHA256 加签→URL 追加 timestamp/sign), msgType text|markdown, title?, content 模板, atMobiles?, atAll?}；errcode!=0 视为失败。
  - `feishuBot` 节点：{url, secret?(HmacSHA256 签名随 body timestamp/sign), msgType text|markdown(→post 富文本单段), title?, content 模板}；code!=0 视为失败。
  - `dbQuery` 节点（裁定：**本应用库只读 + select-only 硬校验**）：{sql(静态不插值), params?:[Aviator 表达式→? 按序绑定], maxRows≤1000, timeoutMs≤30s, saveAs} → {rows, count}；单语句/SELECT|WITH 开头/DML·DDL 黑名单硬拒；外部 JDBC（credentialId type=JDBC）为扩展点本期不实现（配置即报错）。
  - 版本历史（orch_flow_version，publish 即快照）：GET `/flows/{id}/versions`【read】（version/name/triggerType/createdBy/createdAt）、GET `/flows/{id}/versions/{version}`【read】（含 designerJson/elExpr）、POST `/flows/{id}/versions/{version}/rollback`【write】（以历史版本覆盖当前并重新发布 → 产生新版本，历史不改写）。
- **列表 keyword（第二批顺手）**：GET `/api/wf/tasks/todo`、`/api/wf/instances/my`、`/api/wf/instances/done-by-me`、`/api/wf/instances/cc`、`/api/wf/instances/drafts` 均支持 `keyword`（标题/流程名（待办/已办另含节点名）模糊；todo/done-by-me/cc 为组装后过滤）。

## AI 智能助手（oa-boot ai 域，V28，前缀 `/api/ai`）
> 契约 `docs/design/ai-assistant-design.md`。登录即用（无新权限码）；**工具全部包装既有 Service，请求线程内同步执行 → @PreAuthorize 功能权限 + JPA 数据权限天然生效**（安全红线 §0.1）。LLM 凭据取 `orch_credential`（LLM 型）：配置 `ai-assistant.credential-id` 指定，否则取第一条启用 LLM 凭据。function-calling 循环走公共 `LlmToolLoop`（与编排 agent 节点同源）。
- POST `/chat` {sessionId?, message} → {sessionId, messages:[{role:"ASSISTANT", content:markdown, cards?:Card[]}]}（sessionId 空=新会话）
- POST `/confirm` {actionId} → 执行暂存的变更动作（§0.2 二段式；AiConfirmService 暂存 10min，绑定 user+session，一次性消费）；不存在/过期 410，他人动作 403
- GET `/sessions` 近 30 天会话列表（用户隔离）；GET `/sessions/{id}/messages?pageNum=&pageSize=` 消息分页；DELETE `/sessions/{id}` 删会话（均硬校验归属，越权 403，不存在 404）
- **Card 类型**（§3 + §10）：navigate{path,title,desc?} / list{title,columns,rows(行含 link?),moreLink?} / confirm{actionId,title,summary,params,danger} / form{defCode,defName,formType(ONLINE|CODE),schema?(在线 widgets),submitPath?(CODE)} / chart{chartType bar|line|pie,title,categories?,series[{name,data}](pie data 项带 name/value/percent)} / link{items[{title,path}]}
- **工具目录**（§4，@AiTool）：导航 list_functions/open_function（菜单按功能权限过滤）；查询 query_todo/query_my_instances/query_documents/query_meetings/query_leave_balance/query_attendance/query_urgent（服务端打分）/stats_report（预置聚合带数据权限：approval by status|type、document by docType）；变更 start_approval(产 form 卡)/approve_task/create_schedule/create_meeting(产 confirm 卡)。删除类首批不开放。

## 单据管理 BizDoc（oa-module-office，V29，前缀 `/api/bizdoc`）
> 契约 `docs/design/bizdoc-design.md`。单据定义（绑 ONLINE/CODE 表单 + 编号规则(复用 oa_doc_number_rule) + 打印模板 + 可选审批流）→ 运行时零代码获得台账/录入/送审/打印。权限码：bizdoc:def:write（定义管理，ADMIN）/ bizdoc:read / bizdoc:write（ADMIN+DEPT_MANAGER+EMPLOYEE+FINANCE）。
- **定义**：GET `/defs?keyword=&status=&pageNum=`【read】、GET `/defs/published`（运行时入口卡）、GET `/defs/{key}`（数字=id 否则=code）；POST/PUT/DELETE `/defs...`、POST `/defs/{id}/publish|disable`【def:write】。Def 字段含 **submitPath**（CODE 表单运行时「新建」跳转路径，同公文 form_submit_path 口径——疾风批A契约）。发布校验：表单存在(wf_form_def)/编号规则存在/wf_def_code 已发布/list_config 字段 ∈ 表单字段清单（CODE=field_manifest、ONLINE=schema 递归收 key；office 经原生查询读 wf 表，不引模块依赖）。
- **运行时**：GET `/docs?defCode=*&keyword=&status=&filters={"字段":"值"}&pageNum=`【read+DS】台账（数据权限 Specification(dept_id+creator_id)；filters 为 form_data 字段匹配——数据权限先行、内存过滤分页）；POST `/docs` {defCode,title?,formData}（title 缺省=定义名+创建人）；GET/PUT `/docs/{id}`（仅 DRAFT/REJECTED 且创建人可改）；POST `/docs/{id}/submit`（无流程→占号(幂等)+EFFECTIVE；有流程→占号+起流程 businessKey=`BIZDOC:{id}`、__wfRegister 一等实例、表单标量入流程变量→APPROVING；REJECTED 可改重提=新实例）；POST `/docs/{id}/void`（EFFECTIVE→VOID，创建人或 wf:instance:admin；单号台账置 VOID 不回收）。
- **状态回写**（事件监听，workflow 原生 UPDATE oa_bizdoc by process_instance_id，仅 APPROVING 态）：流程完成→EFFECTIVE；实例删除（驳回退发起人/终止/撤销）→REJECTED。
- **打印**：GET `/defs/{defId}/print-tpls`、POST（首个自动默认）、PUT/DELETE `/print-tpls/{id}`、POST `/print-tpls/{id}/default`【def:write】；GET `/docs/{id}/print?tplId=`【read】→ `{tpl(content 元素树 §4), data(form_data+docNo/title/creatorName/deptName/createdAt/status——status=VOID 前端渲 45° 作废水印 §8, **_approvals**=办理记录数组 `[{nodeName,assigneeName,opinion,time}]`（§9.3 审批记录区：绑流程单据从其流程实例取，按办理顺序，与已办/时间线同源=wf_operation；无流程或未办=[]）), fields([{key,label}])}`——**渲染在前端**（套打设计器同一渲染器）。
- 占号：`DocNumberService.allocateExternal`（原子序号+台账行 document_id 置空，与公文幂等互不串号；单据幂等=已有 docNo 跳过）。
