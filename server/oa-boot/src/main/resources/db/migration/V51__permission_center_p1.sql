-- ============================================================
-- OA Platform - V51 权限中心 P1：维度自定义（docs/design/permission-center.md §2 / 附录拍板 D）
--   1) sys_data_dimension 加 value_source / dict_type：取值来源三选（OPTION 自定义选项表 /
--      DICT 数据字典 / DEPT 部门树），免写 provider bean；存量 costCenter/project 标记
--      PROVIDER（继续走专用 bean，零迁移——比伪装成 OPTION 回填双份数据干净）。
--   2) sys_dimension_option：OPTION 源的自定义选项（value=BIGINT，授权值/行数据列值同域，拍板①值链路保持 Long）。
--   3) sys_dimension_binding：维度↔实体绑定升格为真元数据（缺口①）——查询侧 DataScopeSupport.multiDim
--      改读本表，废除 ApprovalService 代码常量。column_name 存 JPA 属性名（如 costCenterId，
--      Criteria root.get 消费口径；V43 的 sys_data_dimension.column_name 是 DB 列名、纯文档字段，弃用不删）。
--      P1 单实体单列（UNIQUE(dimension, entity)；多实体/JSON 扩展列=P4）。
--   4) 权限码 system:dim:manage（维度/选项/绑定管理）授 ADMIN。
--   向后兼容红线：迁移后 oa_approval 多维过滤行为分毫不变（binding 种子=原代码常量逐字搬入）。
-- ============================================================

ALTER TABLE sys_data_dimension
    ADD COLUMN value_source VARCHAR(16) NOT NULL DEFAULT 'PROVIDER',
    ADD COLUMN dict_type    VARCHAR(64);

-- 存量两维度：专用 provider bean 健在 → PROVIDER（options 仍由 SPI 供给）
UPDATE sys_data_dimension SET value_source = 'PROVIDER' WHERE code IN ('costCenter', 'project');

CREATE TABLE sys_dimension_option (
    id        BIGSERIAL    PRIMARY KEY,
    dimension VARCHAR(64)  NOT NULL,
    value     BIGINT       NOT NULL,             -- 授权值 = 行数据列值（同域，Long 链路）
    label     VARCHAR(64)  NOT NULL,
    sort      INTEGER      NOT NULL DEFAULT 0,
    enabled   BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT uk_dim_option UNIQUE (dimension, value)
);
CREATE INDEX idx_dim_option_dim ON sys_dimension_option (dimension);

CREATE TABLE sys_dimension_binding (
    id          BIGSERIAL    PRIMARY KEY,
    dimension   VARCHAR(64)  NOT NULL,
    entity      VARCHAR(128) NOT NULL,           -- 可绑列目录内的实体名（如 Approval）
    column_name VARCHAR(64)  NOT NULL,           -- JPA 属性名（如 costCenterId），multiDim root.get 消费
    CONSTRAINT uk_dim_binding UNIQUE (dimension, entity)
);
CREATE INDEX idx_dim_binding_entity ON sys_dimension_binding (entity);

-- V43 死数据迁入 binding（原 ApprovalService.DATA_DIMENSIONS 常量逐字搬入，行为不变）
INSERT INTO sys_dimension_binding (dimension, entity, column_name) VALUES
    ('costCenter', 'Approval', 'costCenterId'),
    ('project',    'Approval', 'projectId');

-- 权限码：维度/选项/绑定管理（仅 ADMIN）
INSERT INTO sys_permission (parent_id, code, name, type) VALUES
    (0, 'system:dim:manage', '数据维度管理', 'BUTTON');
INSERT INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission WHERE code = 'system:dim:manage';
