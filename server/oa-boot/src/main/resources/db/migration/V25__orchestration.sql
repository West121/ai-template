-- ============================================================
-- OA Platform - V25 自动化逻辑编排（Orchestration，契约 docs/design/orchestration-design.md §3）
--   orch_flow      编排定义（designer_json=OrchModel；el_expr=LiteFlow EL 编译缓存；error_flow_id=错误工作流）
--   orch_exec      执行流水（status RUNNING/SUCCESS/FAILED/CANCELED）
--   orch_exec_node 节点级留痕（input/output 截 8KB、耗时、错误）
--   orch_credential 凭据（type：LLM / HTTP_BEARER / HTTP_BASIC / HTTP_HEADER；api_key 加密存储）
--   权限码 orch:flow:read / orch:flow:write（受信，含脚本/HTTP/LLM 配置，同 wf:script:write 级）/ orch:flow:run
-- ============================================================

CREATE TABLE orch_flow (
    id             BIGSERIAL    PRIMARY KEY,
    code           VARCHAR(64)  NOT NULL UNIQUE,
    name           VARCHAR(128) NOT NULL,
    designer_json  TEXT,                          -- OrchModel（图 JSON，前后端同一契约）
    el_expr        TEXT,                          -- 发布时编译缓存的 LiteFlow EL
    trigger_type   VARCHAR(16),                   -- MANUAL / CRON / EVENT / WEBHOOK（发布时从 trigger 节点提取）
    trigger_config TEXT,                          -- cron 表达式 / event 订阅 JSON
    webhook_token  VARCHAR(64),                   -- webhook 触发 token（免登录鉴权）
    enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
    version        INTEGER      NOT NULL DEFAULT 0,   -- 已发布版本号（0=未发布）
    error_flow_id  BIGINT,                        -- 错误工作流：整流失败以 {error,failedNodeId,payload} 触发；错误流失败不级联
    remark         VARCHAR(255),
    created_by     BIGINT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ
);

CREATE TABLE orch_exec (
    id           BIGSERIAL   PRIMARY KEY,
    flow_id      BIGINT      NOT NULL,
    flow_code    VARCHAR(64),
    trigger_kind VARCHAR(16) NOT NULL,            -- MANUAL / CRON / EVENT / WEBHOOK / RERUN / ERROR_FLOW / SUB_FLOW
    payload      TEXT,                            -- 触发载荷 JSON
    status       VARCHAR(16) NOT NULL DEFAULT 'RUNNING',  -- RUNNING / SUCCESS / FAILED / CANCELED
    result       TEXT,                            -- end 节点 output（截 8KB）
    error        TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at     TIMESTAMPTZ
);
CREATE INDEX idx_orch_exec_flow ON orch_exec (flow_id, id DESC);
CREATE INDEX idx_orch_exec_status ON orch_exec (status);

CREATE TABLE orch_exec_node (
    id         BIGSERIAL    PRIMARY KEY,
    exec_id    BIGINT       NOT NULL,
    node_id    VARCHAR(64)  NOT NULL,
    node_name  VARCHAR(128),
    status     VARCHAR(16)  NOT NULL,             -- RUNNING / SUCCESS / FAILED
    attempts   INTEGER      NOT NULL DEFAULT 1,   -- 实际尝试次数（重试语义留痕）
    input      TEXT,                              -- 渲染后的输入摘要（截 8KB）
    output     TEXT,                              -- 输出（截 8KB）
    error      TEXT,
    cost_ms    BIGINT,
    started_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_orch_exec_node_exec ON orch_exec_node (exec_id, id);

CREATE TABLE orch_credential (
    id          BIGSERIAL    PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    type        VARCHAR(16)  NOT NULL DEFAULT 'LLM',  -- LLM / HTTP_BEARER / HTTP_BASIC / HTTP_HEADER
    base_url    VARCHAR(255),                     -- LLM：OpenAI-compatible 端点根
    api_key_enc TEXT,                             -- AES-GCM 加密（不落明文）
    model       VARCHAR(64),                      -- LLM 默认模型
    header_name VARCHAR(64),                      -- HTTP_HEADER：自定义头名
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 权限码：read / write（受信）/ run —— ADMIN 全部
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'orch:flow:read',  '编排查看', 'BUTTON'),
    (0, 'orch:flow:write', '编排编辑', 'BUTTON'),
    (0, 'orch:flow:run',   '编排运行', 'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code IN ('orch:flow:read', 'orch:flow:write', 'orch:flow:run');
