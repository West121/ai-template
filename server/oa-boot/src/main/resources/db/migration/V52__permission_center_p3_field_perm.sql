-- ============================================================
-- OA Platform - V52 权限中心 P3：角色×功能 字段权限（docs/design/permission-center.md §5 / 附2）
--   sys_role_field_perm：角色 × 功能(feature=ai_feature_catalog.feature_code 的 opaque 字符串，拍板 A)
--   × 字段(field=表单字段 key 或 @FieldPerm 标注的 DTO 固定列名) → visible/editable。
--   解析：多角色并集放宽（任一角色 visible=true 即可见）；未配置任何行=全可见全可编（向后兼容红线）。
--   无新权限码：配置沿用 system:role:edit。
-- ============================================================

CREATE TABLE sys_role_field_perm (
    id       BIGSERIAL   PRIMARY KEY,
    role_id  BIGINT      NOT NULL,
    feature  VARCHAR(64) NOT NULL,
    field    VARCHAR(64) NOT NULL,
    visible  BOOLEAN     NOT NULL DEFAULT TRUE,
    editable BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT uk_role_field_perm UNIQUE (role_id, feature, field)
);
CREATE INDEX idx_role_field_perm_role ON sys_role_field_perm (role_id, feature);

-- 拍板 B 字段清单来源种子：待办办理（WORKFLOW_TASKS）关联种子表单 leave
-- （catalog 端点按 related_form_codes 经 FormManifestService 合流出表单字段；仅回填空值不覆盖已配置）
UPDATE ai_feature_catalog SET related_form_codes = 'leave'
WHERE feature_code = 'WORKFLOW_TASKS' AND (related_form_codes IS NULL OR related_form_codes = '');
