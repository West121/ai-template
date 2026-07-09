package com.xingchen.oa.infra.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.infra.dto.LoginLogResponse;
import com.xingchen.oa.infra.dto.OperLogResponse;
import com.xingchen.oa.infra.dto.RuntimeLogResponse;
import com.xingchen.oa.infra.service.LogService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 日志管理：登录日志 / 操作日志分页 + 运行日志 tail。
 * B-06：三个接口均需 system:log:list（V6 种子，超管代码级全量自动拥有），返回 Response DTO 而非实体。
 */
@RestController
@RequestMapping("/api/infra/logs")
@RequiredArgsConstructor
public class LogController {

    private final LogService logService;

    @GetMapping("/login")
    @PreAuthorize("hasAuthority('system:log:list')")
    public R<PageResult<LoginLogResponse>> loginLogs(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(logService.loginLogs(keyword, pageNum, pageSize));
    }

    @GetMapping("/oper")
    @PreAuthorize("hasAuthority('system:log:list')")
    public R<PageResult<OperLogResponse>> operLogs(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String module,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(logService.operLogs(keyword, module, pageNum, pageSize));
    }

    @GetMapping("/runtime")
    @PreAuthorize("hasAuthority('system:log:list')")
    public R<RuntimeLogResponse> runtime(@RequestParam(defaultValue = "200") int lines) {
        return R.ok(logService.runtime(lines));
    }
}
