package com.xingchen.oa.boot.job;

import com.xingchen.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 定时任务管理页的数据源：执行器信息 + 已注册的 JobHandler 清单。
 * 任务的增删改与调度日志由 XXL-Job 调度中心（consoleUrl）负责。
 */
@RestController
@RequestMapping("/api/system/jobs")
@RequiredArgsConstructor
public class JobInfoController {

    /** 确保 XxlJobProperties 在 enabled=false 时也可注入（前端页面仍能展示接入说明） */
    @Configuration
    @EnableConfigurationProperties(XxlJobProperties.class)
    static class PropertiesRegistrar {
    }

    private final XxlJobProperties properties;

    private static final List<Map<String, String>> HANDLERS = List.of(
            Map.of(
                    "name", "demoJob",
                    "description", "示例任务：打印调度参数与执行日志",
                    "recommendedCron", "0 0/5 * * * ?"),
            Map.of(
                    "name", "approvalPendingReportJob",
                    "description", "待审批统计播报：统计 PENDING 审批单数量",
                    "recommendedCron", "0 0 9 * * ?"),
            Map.of(
                    "name", "attendanceRemindJob",
                    "description", "下班打卡提醒：统计已签到未签退人数并提醒",
                    "recommendedCron", "0 0 18 * * ?"));

    @GetMapping
    public R<Map<String, Object>> info() {
        return R.ok(Map.of(
                "enabled", properties.isEnabled(),
                "consoleUrl", properties.getAdminAddresses() == null ? "" : properties.getAdminAddresses(),
                "appname", properties.getExecutor().getAppname(),
                "port", properties.getExecutor().getPort(),
                "handlers", HANDLERS));
    }
}
