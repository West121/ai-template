-- ============================================================
-- OA Platform - V49 开发者工作台（Dev Studio，docs/design/dev-studio.md 附录拍板）
--   dev_asset_version：四类热资产（ORCH/PROCESS/FORM/BIZDOC_TPL）统一非侵入快照表。
--     每次经统一门面 /api/dev-studio/assets 的 保存/发布/回滚 落一行；
--     version_no = 门面自增版本（乐观锁 baseVersion 比对基准，与各资产原生 version 解耦）；
--     actor = USER（工作台人工）| AI（批W2 dev_propose_change 确认执行）。
--   权限码 dev:studio:view / dev:studio:edit（入口门 + AI 工具暴露门；
--     落写双门：门面内再验各资产原生受信码 orch:flow:write / wf:def:edit / bizdoc:def:write）。
-- ============================================================

CREATE TABLE dev_asset_version (
    id         BIGSERIAL    PRIMARY KEY,
    asset_type VARCHAR(16)  NOT NULL,              -- ORCH / PROCESS / FORM / BIZDOC_TPL
    code       VARCHAR(64)  NOT NULL,              -- 资产编码（orch code / wf defCode / form code / tpl code）
    version_no INTEGER      NOT NULL,              -- 门面快照版本（每资产自增；唯一索引兜并发写）
    content    TEXT,                               -- 快照内容（designerJson / bpmnXml / schemaJson / content 元素树）
    actor      VARCHAR(8)   NOT NULL DEFAULT 'USER', -- USER | AI
    actor_id   BIGINT,                             -- 操作人 sys_user.id
    summary    VARCHAR(255),                       -- 变更摘要（保存草稿 / 发布 / 回滚自 vN / AI 摘要）
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 唯一索引：并发保存同一资产时第二个 INSERT 触发冲突 → 服务层转 409
CREATE UNIQUE INDEX ux_dev_asset_version ON dev_asset_version (asset_type, code, version_no);

-- 权限码：view（入口/只读）+ edit（统一 PUT/回滚）；仅授 ADMIN（role_id=1）
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'dev:studio:view', '开发工作台查看', 'BUTTON'),
    (0, 'dev:studio:edit', '开发工作台编辑', 'BUTTON');

INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code IN ('dev:studio:view', 'dev:studio:edit');
