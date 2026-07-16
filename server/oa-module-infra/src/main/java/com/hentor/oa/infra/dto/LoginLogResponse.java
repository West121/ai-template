package com.hentor.oa.infra.dto;

import com.hentor.oa.infra.entity.SysLoginLog;

import java.time.LocalDateTime;

/**
 * 契约 LoginLog = {id,username,ip,location,userAgent,success,message,createdAt}
 * （B-06：接口不直接返回 JPA 实体）
 */
public record LoginLogResponse(
        Long id,
        String username,
        String ip,
        String location,
        String userAgent,
        Boolean success,
        String message,
        LocalDateTime createdAt) {

    public static LoginLogResponse of(SysLoginLog log) {
        return new LoginLogResponse(log.getId(), log.getUsername(), log.getIp(), log.getLocation(),
                log.getUserAgent(), log.getSuccess(), log.getMessage(), log.getCreatedAt());
    }
}
