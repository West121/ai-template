package com.xingchen.oa.system.security;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "oa.jwt")
public class OaJwtProperties {

    /**
     * HS256 签名密钥，长度至少 64 字符。
     */
    private String secret;

    /**
     * 过期时间（分钟）。
     */
    private long expireMinutes = 720;
}
