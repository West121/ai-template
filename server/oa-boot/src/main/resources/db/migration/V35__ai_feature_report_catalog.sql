-- ============================================================
-- OA Platform - V35 AI 助手 V2 批C：功能目录 / 报表目录 / 数据集（ai-assistant-design-v2.md §11/§12.1）
--   ai_feature_catalog：结构化功能目录（种子自 web/src/config/menu.ts 手工整理，smoke 防漂移比对）。
--     受控导航：navigate 卡以 featureCode 出卡，后端校验存在+用户可见（§10.2，模型不产任意 path）。
--   ai_report_catalog：固定 reportCode 报表目录（§11.1，参数白名单+权限+数据权限策略；替换 stats_report）。
--   ai_dataset：>20 行结果落数据集（§11.2，短期过期，访问再鉴权）。
-- ============================================================

-- ---------- §12.1 功能目录 ----------
CREATE TABLE ai_feature_catalog (
    id                     BIGSERIAL    PRIMARY KEY,
    feature_code           VARCHAR(64)  NOT NULL UNIQUE,
    module_code            VARCHAR(32)  NOT NULL,
    name                   VARCHAR(64)  NOT NULL,
    description            VARCHAR(255),
    route_code             VARCHAR(128) NOT NULL,      -- 前端路由 path（与 menu.ts 对齐；FeatureRouteRegistry 映射）
    required_authorities   VARCHAR(255),               -- 逗号分隔，全部满足才可见；空=登录可见
    supported_actions      VARCHAR(255),
    related_form_codes     VARCHAR(255),
    related_process_codes  VARCHAR(255),
    keywords               VARCHAR(255),
    system_version         VARCHAR(16)  NOT NULL DEFAULT 'v1',
    status                 VARCHAR(16)  NOT NULL DEFAULT 'PUBLISHED',
    updated_at             TIMESTAMPTZ
);

-- 种子：自 web/src/config/menu.ts 手工整理（demo 示例页与外链控制台不入目录）。
-- featureCode 约定（前端对账 c96b522）：path 段大写下划线（/workflow/form-defs → WORKFLOW_FORM_DEFS）。
-- 权限口径沿用各页面 API @PreAuthorize 实际权限码；SYSTEM_MENU/SYSTEM_JOB 暂借系统管理域权限（无专属码）。
INSERT INTO ai_feature_catalog (feature_code, module_code, name, description, route_code, required_authorities, keywords) VALUES
    ('DASHBOARD',          'dashboard',   '工作台',       '个人首页：待办、日程、公告与统计概览',            '/dashboard',          NULL,                    '首页,工作台,概览'),
    ('WORKFLOW_TASKS',     'workflow',    '我的审批',     '处理待办审批任务、查看已办与抄送',                '/workflow/tasks',     NULL,                    '待办,审批,任务,已办'),
    ('WORKFLOW_START',     'workflow',    '发起申请',     '发起请假/报销/出差等审批流程',                    '/workflow/start',     NULL,                    '发起,申请,流程'),
    ('WORKFLOW_MONITOR',   'workflow',    '流程监控',     '流程实例运行监控与管理员干预',                    '/workflow/monitor',   'wf:instance:admin',     '监控,实例,干预'),
    ('WORKFLOW_DEFS',      'workflow',    '流程定义',     '流程定义管理与可视化设计',                        '/workflow/defs',      'wf:def:edit',           '流程设计,定义,BPMN'),
    ('WORKFLOW_FORM_DEFS', 'workflow',    '表单定义',     '在线表单定义与设计器',                            '/workflow/form-defs', 'wf:def:edit',           '表单,设计器'),
    ('WORKFLOW_SEALS',     'workflow',    '电子章',       '电子印章管理（审批用印）',                        '/workflow/seals',     'office:doc:seal',       '印章,盖章,用印'),
    ('AUTOMATION',         'automation',  '自动化编排',   '无人值守的自动化逻辑编排（触发器/连接器）',        '/automation',         'orch:flow:read',        '编排,自动化,机器人'),
    ('BIZDOC_CENTER',      'bizdoc',      '单据中心',     '已发布业务单据的运行时台账与录入',                '/bizdoc/center',      'bizdoc:read',           '单据,台账,录入'),
    ('BIZDOC_DEFS',        'bizdoc',      '单据定义',     '零代码单据定义（表单/编号/流程/打印绑定）',        '/bizdoc/defs',        'bizdoc:def:write',      '单据定义,零代码'),
    ('BIZDOC_TPLS',        'bizdoc',      '单据模板',     '文档打印模板管理与套打设计器',                    '/bizdoc/tpls',        'bizdoc:def:write',      '打印,模板,套打'),
    ('DOCUMENT_RECEIVE',   'document',    '收文管理',     '收文登记、拟办、批办、传阅',                      '/document/receive',   'office:doc:recv',       '收文,登记,批办'),
    ('DOCUMENT_SEND',      'document',    '发文管理',     '发文拟稿、核稿、签发、用印',                      '/document/send',      'office:doc:send',       '发文,拟稿,签发'),
    ('DOCUMENT_LEDGER',    'document',    '公文台账',     '文号台账与归档卷宗检索',                          '/document/ledger',    NULL,                    '台账,文号,归档'),
    ('MEETING_ROOMS',      'meeting',     '会议室预订',   '查看会议室占用并预订',                            '/meeting/rooms',      NULL,                    '会议室,预订'),
    ('MEETING_MY',         'meeting',     '我的会议',     '我组织或参与的会议',                              '/meeting/my',         NULL,                    '会议,日程'),
    ('ATTENDANCE_RECORD',  'attendance',  '打卡记录',     '考勤打卡与月度记录汇总',                          '/attendance/record',  NULL,                    '打卡,考勤,记录'),
    ('ATTENDANCE_LEAVE',   'attendance',  '请假管理',     '请假申请与假期额度查询',                          '/attendance/leave',   NULL,                    '请假,假期,额度'),
    ('ATTENDANCE_TRIP',    'attendance',  '出差管理',     '出差申请与记录',                                  '/attendance/trip',    NULL,                    '出差,差旅'),
    ('CONTACTS',           'contacts',    '通讯录',       '组织架构与同事联系方式',                          '/contacts',           NULL,                    '通讯录,联系人,组织'),
    ('ANNOUNCEMENT',       'announce',    '公告通知',     '公司公告与通知发布',                              '/announcement',       NULL,                    '公告,通知'),
    ('SCHEDULE',           'schedule',    '日程管理',     '个人日程安排与提醒',                              '/schedule',           NULL,                    '日程,日历,提醒'),
    ('SYSTEM_ORG_DEPT',    'system',      '部门管理',     '部门组织架构维护',                                '/system/org/dept',    'system:dept:edit',      '部门,组织'),
    ('SYSTEM_ORG_POST',    'system',      '岗位管理',     '岗位设置维护',                                    '/system/org/post',    'system:post:edit',      '岗位'),
    ('SYSTEM_USER',        'system',      '用户管理',     '系统用户与任职维护',                              '/system/user',        'system:user:edit',      '用户,账号,任职'),
    ('SYSTEM_ROLE',        'system',      '角色管理',     '角色与权限点维护',                                '/system/role',        'system:role:edit',      '角色,权限'),
    ('SYSTEM_MENU',        'system',      '菜单管理',     '菜单与权限结构维护',                              '/system/menu',        'system:role:edit',      '菜单'),
    ('SYSTEM_JOB',         'system',      '定时任务',     '定时任务调度管理',                                '/system/job',         'system:user:edit',      '定时,任务,调度'),
    ('SYSTEM_DICT',        'system',      '字典管理',     '数据字典维护',                                    '/system/dict',        'system:dict:edit',      '字典'),
    ('SYSTEM_FILE',        'system',      '文件管理',     '平台文件存储管理',                                '/system/file',        'system:file:list',      '文件,附件'),
    ('SYSTEM_LOG',         'system',      '日志管理',     '操作日志与登录日志查询',                          '/system/log',         'system:log:list',       '日志,审计');

-- ---------- §11.1 报表目录（固定 reportCode；参数白名单=parameter_schema keys） ----------
CREATE TABLE ai_report_catalog (
    id                   BIGSERIAL    PRIMARY KEY,
    report_code          VARCHAR(64)  NOT NULL UNIQUE,
    name                 VARCHAR(64)  NOT NULL,
    description          VARCHAR(255),
    parameter_schema     TEXT,                          -- JSON {param:{type,description}}；键集即白名单
    required_authorities VARCHAR(255),
    data_scope_strategy  VARCHAR(32)  NOT NULL DEFAULT 'OFFICE_SCOPE',  -- OFFICE_SCOPE/ALL_OR_SELF/SELF
    allowed_dimensions   VARCHAR(255),
    allowed_metrics      VARCHAR(255),
    max_date_range       INT,
    max_rows             INT          NOT NULL DEFAULT 500,
    supports_chart       BOOLEAN      NOT NULL DEFAULT TRUE,
    supports_export      BOOLEAN      NOT NULL DEFAULT FALSE,
    chart_type           VARCHAR(16)  NOT NULL DEFAULT 'bar',
    drill_param          VARCHAR(32),                   -- 亮点③：下钻参数名（chart 卡 drill.paramName）
    status               VARCHAR(16)  NOT NULL DEFAULT 'PUBLISHED',
    version              INT          NOT NULL DEFAULT 1
);

-- 种子：改造现有 4 个统计 + 流程维度（数据权限与列表口径一致）
INSERT INTO ai_report_catalog (report_code, name, description, parameter_schema, required_authorities,
                               data_scope_strategy, chart_type, drill_param) VALUES
    ('APPROVAL_COUNT_BY_STATUS', '审批量按状态统计', '当前可见范围内审批单按状态聚合',
     '{"status":{"type":"string","description":"下钻：按状态过滤返回审批明细（中文标签或 PENDING/APPROVED/REJECTED/WITHDRAWN）"}}',
     'office:approval:approve', 'OFFICE_SCOPE', 'pie', 'status'),
    ('APPROVAL_COUNT_BY_TYPE', '审批量按类型统计', '当前可见范围内审批单按类型聚合',
     '{"type":{"type":"string","description":"下钻：按类型过滤返回审批明细（中文标签或 LEAVE/TRIP/EXPENSE/OVERTIME）"}}',
     'office:approval:approve', 'OFFICE_SCOPE', 'bar', 'type'),
    ('APPROVAL_COUNT_BY_PROCESS', '审批量按流程统计', '工作流实例按流程定义聚合（管理员全量/其他人本人发起）',
     '{"processName":{"type":"string","description":"下钻：按流程名过滤返回实例明细"}}',
     'office:approval:approve', 'ALL_OR_SELF', 'bar', 'processName'),
    ('DOCUMENT_COUNT_BY_TYPE', '公文按文种统计', '当前可见范围内公文按文种聚合',
     '{"docType":{"type":"string","description":"下钻：按文种过滤返回公文明细"}}',
     NULL, 'OFFICE_SCOPE', 'bar', 'docType'),
    ('ATTENDANCE_RATE_BY_MONTH', '我的月度考勤统计', '本人月度出勤/迟到/早退/缺勤汇总',
     '{"month":{"type":"string","description":"月份 yyyy-MM，缺省本月"}}',
     NULL, 'SELF', 'bar', NULL);

-- ---------- §11.2 数据集（大结果不进聊天消息；短期过期，访问再鉴权） ----------
CREATE TABLE ai_dataset (
    id          BIGSERIAL    PRIMARY KEY,
    tenant_id   VARCHAR(32)  NOT NULL DEFAULT 'default',
    user_id     BIGINT       NOT NULL,
    session_id  BIGINT,
    report_code VARCHAR(64),
    query_hash  VARCHAR(64),
    schema_json TEXT,                                   -- 列定义 [{key,label}]
    row_count   INT          NOT NULL,
    storage_ref VARCHAR(32)  NOT NULL DEFAULT 'inline', -- 批C inline（rows_json）；大体量外置扩展点
    rows_json   TEXT,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_dataset_user ON ai_dataset (tenant_id, user_id, id);
