package com.hentor.oa.boot.job;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * XXL-Job 执行器配置（application.yml 的 xxl.job 前缀）
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "xxl.job")
public class XxlJobProperties {

    /** 是否启用执行器（调度中心未部署时可关闭） */
    private boolean enabled = false;

    /** 调度中心地址，如 http://localhost:8082/xxl-job-admin */
    private String adminAddresses;

    /** 与调度中心一致的 accessToken */
    private String accessToken;

    private Executor executor = new Executor();

    @Getter
    @Setter
    public static class Executor {
        /** 执行器 AppName（调度中心-执行器管理里注册用） */
        private String appname = "oa-executor";
        private int port = 9999;
        private String logPath = "./logs/xxl-job";
        private int logRetentionDays = 7;
    }
}
