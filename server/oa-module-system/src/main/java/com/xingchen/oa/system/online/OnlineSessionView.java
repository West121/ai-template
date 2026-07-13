package com.xingchen.oa.system.online;

/**
 * 在线会话列表项（GET /api/system/online）。current=是否为请求者本人当前会话（前端禁踢/标记）。
 */
public record OnlineSessionView(
        String sessionId,
        Long userId,
        String username,
        String name,
        String ip,
        String location,
        String client,
        String userAgent,
        long loginTime,
        long lastActive,
        String activeAssignmentId,
        boolean current) {
}
