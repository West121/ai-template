-- ============================================================
-- OA Platform - V54 权限中心 P2：功能级数据权限覆盖（permission-center.md §4 / 附3）
--   sys_role_data_dimension / sys_user_data_dimension 加 feature 列：
--     ''=全局默认层（存 '' 代 NULL，唯一键干净——拍板）；非空=按功能覆盖（feature_code opaque 字符串）。
--   解析：功能覆盖 > 全局 > 不限；覆盖=替换（拍板 C，只看覆盖层）；同层内多角色并集放宽。
--   附3 新拍板：覆盖层允许 dimension='dept'（内建保留键）——某功能单独收窄部门范围；
--     CUSTOM values=精确部门 id 集（不含子树，见 DataScopeSupport 语义注释）；全局层禁 dept（唯一真源=role.dataScope 五档）。
--   缓存结构升级：dp:dims:{uid} → dp:dims:v2:{uid}（分层 JSON）；旧键不再被读，TTL 蒸发 + evictUser 顺带删。
--   向后兼容红线：存量行 feature='' 即全局层，未配覆盖=现行为分毫不变。
-- ============================================================

ALTER TABLE sys_role_data_dimension ADD COLUMN feature VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE sys_user_data_dimension ADD COLUMN feature VARCHAR(64) NOT NULL DEFAULT '';

ALTER TABLE sys_role_data_dimension DROP CONSTRAINT uk_role_data_dim;
ALTER TABLE sys_role_data_dimension ADD CONSTRAINT uk_role_data_dim UNIQUE (role_id, dimension, feature);
ALTER TABLE sys_user_data_dimension DROP CONSTRAINT uk_user_data_dim;
ALTER TABLE sys_user_data_dimension ADD CONSTRAINT uk_user_data_dim UNIQUE (user_id, dimension, feature);
