package com.hentor.oa.system.online;

/**
 * 在线会话（Redis 存 JSON，key=online:sess:{sessionId}）。一个登录会话一条；switch 换身份保持同一 sessionId。
 *
 * @param client            由 userAgent 粗解析的「浏览器 · 系统」
 * @param loginTime         登录时刻（epoch millis，switch 不重置）
 * @param lastActive        最近活跃时刻（epoch millis，filter 节流更新）
 */
public record OnlineSession(
        String sessionId,
        Long userId,
        String username,
        String name,
        String ip,
        String location,
        String userAgent,
        String client,
        long loginTime,
        long lastActive,
        String activeAssignmentId) {
}
