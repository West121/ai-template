-- ============================================================
-- V42 直属上级（多值、有序）：sys_user_leader
--   一个用户可配置多个有序「指定直属上级」，供工作流 LEADER（发起人主管）节点解析：
--   配了 → 用指定的（节点 multiMode ANY/ALL 决定或签/会签）；没配 → 回退所在部门负责人（dept.leader_id）。
--   与既有单值 sys_user.leader_id（组织架构直属上级，展示用）并存、互不影响。
--   本表初始为空 → 所有存量用户行为不变（LEADER 一律回退部门负责人），向后兼容。
-- ============================================================
CREATE TABLE sys_user_leader (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT,                                  -- 预留多租户（当前单租户，恒空）
    user_id    BIGINT  NOT NULL,                        -- 被指派上级的用户
    leader_id  BIGINT  NOT NULL,                        -- 指定的直属上级用户
    sort_order INTEGER NOT NULL DEFAULT 0,              -- 顺序（前端数组下标写入）
    CONSTRAINT uk_sys_user_leader UNIQUE (user_id, leader_id)
);

CREATE INDEX idx_sys_user_leader_user   ON sys_user_leader (user_id);
CREATE INDEX idx_sys_user_leader_leader ON sys_user_leader (leader_id);
