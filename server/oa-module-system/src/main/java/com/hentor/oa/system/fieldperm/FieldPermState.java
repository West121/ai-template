package com.hentor.oa.system.fieldperm;

/** 某字段对当前用户的合并权限（mine 端点值元素；多角色并集放宽）。 */
public record FieldPermState(boolean visible, boolean editable) {
}
