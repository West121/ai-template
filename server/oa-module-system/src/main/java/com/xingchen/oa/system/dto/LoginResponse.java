package com.xingchen.oa.system.dto;

import java.util.List;

/**
 * 登录 / 身份切换 / 当前用户信息 统一响应。
 * activeAssignmentId："ALL" 表示全部身份并集，否则为任职 id 字符串。
 */
public record LoginResponse(
        String token,
        UserInfo user,
        List<AssignmentInfo> assignments,
        String activeAssignmentId,
        List<String> permissions
) {

    public record UserInfo(Long id, String username, String name) {
    }
}
