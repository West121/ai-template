package com.hentor.oa.system.fieldperm;

/** 角色字段权限配置项（GET/PUT roles/{id}/field-perms 元素）。 */
public record FieldPermItem(String feature, String field, boolean visible, boolean editable) {
}
