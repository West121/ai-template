package com.hentor.oa.system.security;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.StringUtils;

@Data
@ConfigurationProperties(prefix = "oa.jwt")
public class OaJwtProperties {

    /** HS256 最低密钥长度（256 bit = 32 字节，按 ASCII 计 32 字符），建议 64+。 */
    private static final int MIN_SECRET_LENGTH = 32;

    /**
     * HS256 签名密钥。安全要求（B-01）：不在配置文件内置默认值，
     * 必须通过环境变量 OA_JWT_SECRET 注入；缺失或过短时启动快速失败。
     */
    private String secret;

    /**
     * 过期时间（分钟）。
     */
    private long expireMinutes = 720;

    @PostConstruct
    void validate() {
        if (!StringUtils.hasText(secret)) {
            throw new IllegalStateException(
                    "JWT 密钥未配置：请通过环境变量 OA_JWT_SECRET 注入（HS256，至少 32 字符，建议 64+），"
                            + "例如 export OA_JWT_SECRET=$(openssl rand -hex 32)");
        }
        if (secret.trim().length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException(
                    "JWT 密钥过短：OA_JWT_SECRET 至少 " + MIN_SECRET_LENGTH + " 字符（HS256 需 256 bit），建议 64+");
        }
    }
}
