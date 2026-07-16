package com.hentor.oa.infra.service;

import com.hentor.oa.infra.entity.SysLoginLog;
import com.hentor.oa.infra.repository.SysLoginLogRepository;
import com.hentor.oa.infra.util.IpUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 登录日志落库：REQUIRES_NEW 独立事务——登录流程（含只读事务 / 抛异常前）随时可调，
 * 日志写入不受业务事务回滚影响。IP / UA 由 RequestContextHolder 提取。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LoginLogService {

    private final SysLoginLogRepository loginLogRepository;
    private final RegionService regionService;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String username, boolean success, String message) {
        try {
            SysLoginLog entry = new SysLoginLog();
            String ip = IpUtils.currentIp();
            entry.setUsername(username);
            entry.setIp(ip);
            entry.setLocation(regionService.resolve(ip));
            entry.setUserAgent(IpUtils.currentUserAgent());
            entry.setSuccess(success);
            entry.setMessage(message);
            loginLogRepository.save(entry);
        } catch (Exception e) {
            // 日志写入失败不影响登录主流程
            log.warn("登录日志写入失败: {}", e.getMessage());
        }
    }
}
