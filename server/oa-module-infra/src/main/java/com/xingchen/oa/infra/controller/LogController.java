package com.xingchen.oa.infra.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.infra.dto.RuntimeLogResponse;
import com.xingchen.oa.infra.entity.SysLoginLog;
import com.xingchen.oa.infra.entity.SysOperLog;
import com.xingchen.oa.infra.service.LogService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 日志管理：登录日志 / 操作日志分页 + 运行日志 tail（契约未标注功能权限，登录即可）。
 */
@RestController
@RequestMapping("/api/infra/logs")
@RequiredArgsConstructor
public class LogController {

    private final LogService logService;

    @GetMapping("/login")
    public R<PageResult<SysLoginLog>> loginLogs(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(logService.loginLogs(keyword, pageNum, pageSize));
    }

    @GetMapping("/oper")
    public R<PageResult<SysOperLog>> operLogs(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String module,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(logService.operLogs(keyword, module, pageNum, pageSize));
    }

    @GetMapping("/runtime")
    public R<RuntimeLogResponse> runtime(@RequestParam(defaultValue = "200") int lines) {
        return R.ok(logService.runtime(lines));
    }
}
