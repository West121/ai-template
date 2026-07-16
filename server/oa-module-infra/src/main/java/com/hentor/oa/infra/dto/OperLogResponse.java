package com.hentor.oa.infra.dto;

import com.hentor.oa.infra.entity.SysOperLog;

import java.time.LocalDateTime;

/**
 * 契约 OperLog = {id,username,module,action,method,params,status,errorMsg,costMs,ip,createdAt}
 * （B-06：接口不直接返回 JPA 实体）
 */
public record OperLogResponse(
        Long id,
        String username,
        String module,
        String action,
        String method,
        String params,
        String status,
        String errorMsg,
        Long costMs,
        String ip,
        LocalDateTime createdAt) {

    public static OperLogResponse of(SysOperLog log) {
        return new OperLogResponse(log.getId(), log.getUsername(), log.getModule(), log.getAction(),
                log.getMethod(), log.getParams(), log.getStatus(), log.getErrorMsg(),
                log.getCostMs(), log.getIp(), log.getCreatedAt());
    }
}
