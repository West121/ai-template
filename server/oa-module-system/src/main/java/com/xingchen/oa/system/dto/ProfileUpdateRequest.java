package com.xingchen.oa.system.dto;

/**
 * 个人中心·更新本人安全档案字段（仅本人，绝不改 dept/post/role/status/enabled）。
 * nickname 落到 SysUser.name（显示名）；null 字段不改，phone/email/avatar 传空串可清空。
 */
public record ProfileUpdateRequest(String nickname, String phone, String email, String avatar) {
}
