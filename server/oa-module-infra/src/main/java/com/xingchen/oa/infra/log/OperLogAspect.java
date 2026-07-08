package com.xingchen.oa.infra.log;

import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.infra.entity.SysOperLog;
import com.xingchen.oa.infra.repository.SysOperLogRepository;
import com.xingchen.oa.infra.util.IpUtils;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * @OperLog 切面：成功 / 异常均落库（params JSON 截断 1000、costMs、ip、username），异常继续抛出。
 * 注解定义在 oa-common（com.xingchen.oa.common.log.OperLog），office / system 模块可直接标注。
 */
@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class OperLogAspect {

    private final SysOperLogRepository operLogRepository;
    private final ObjectMapper objectMapper;

    @Around("@annotation(operLog)")
    public Object around(ProceedingJoinPoint joinPoint, OperLog operLog) throws Throwable {
        long start = System.currentTimeMillis();
        String errorMsg = null;
        try {
            Object result = joinPoint.proceed();
            return result;
        } catch (Throwable e) {
            errorMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            throw e;
        } finally {
            save(joinPoint, operLog, System.currentTimeMillis() - start, errorMsg);
        }
    }

    private void save(ProceedingJoinPoint joinPoint, OperLog operLog, long costMs, String errorMsg) {
        try {
            MethodSignature signature = (MethodSignature) joinPoint.getSignature();
            SysOperLog entry = new SysOperLog();
            UserContext user = CurrentUserHolder.get();
            entry.setUsername(user != null ? user.getUsername() : "anonymous");
            entry.setModule(operLog.module());
            entry.setAction(operLog.action());
            entry.setMethod(truncate(signature.getDeclaringType().getSimpleName() + "." + signature.getName(), 128));
            entry.setParams(truncate(serializeArgs(joinPoint.getArgs()), 1000));
            entry.setStatus(errorMsg == null ? "SUCCESS" : "FAIL");
            entry.setErrorMsg(truncate(errorMsg, 500));
            entry.setCostMs(costMs);
            entry.setIp(IpUtils.currentIp());
            operLogRepository.save(entry);
        } catch (Exception e) {
            // 操作日志落库失败不影响业务
            log.warn("操作日志写入失败: {}", e.getMessage());
        }
    }

    private String serializeArgs(Object[] args) {
        if (args == null || args.length == 0) {
            return "[]";
        }
        List<Object> safe = new ArrayList<>();
        for (Object arg : args) {
            if (arg instanceof MultipartFile file) {
                safe.add("<file:" + file.getOriginalFilename() + "," + file.getSize() + "B>");
            } else if (arg instanceof ServletRequest || arg instanceof ServletResponse
                    || arg instanceof InputStream) {
                // 不可序列化的请求级对象跳过
            } else {
                safe.add(arg);
            }
        }
        try {
            return objectMapper.writeValueAsString(safe);
        } catch (Exception e) {
            return String.valueOf(safe);
        }
    }

    private String truncate(String text, int max) {
        if (text == null) {
            return null;
        }
        return text.length() > max ? text.substring(0, max) : text;
    }
}
