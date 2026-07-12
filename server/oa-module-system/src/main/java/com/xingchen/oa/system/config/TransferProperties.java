package com.xingchen.oa.system.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 转岗配置（DP3，可配置化不硬编码）。旧部门数据保留期：全局默认天数 + 开关，可被单次转岗请求 retentionDays 覆盖。
 * 覆盖用 env：OA_TRANSFER_RETENTION_ENABLED / OA_TRANSFER_RETENTION_DAYS。
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "oa.transfer")
public class TransferProperties {

    private Retention retention = new Retention();

    @Getter
    @Setter
    public static class Retention {
        /** 是否启用「旧部门数据保留期」（默认启用）。 */
        private boolean enabled = true;
        /** 全局默认保留天数（默认 7）。 */
        private int days = 7;
    }
}
