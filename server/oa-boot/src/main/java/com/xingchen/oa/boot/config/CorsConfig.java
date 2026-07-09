package com.xingchen.oa.boot.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * CORS：允许来源可配置（B-13）。
 * 由 {@code oa.cors.allowed-origins}（逗号分隔）注入——dev 默认放行本地 Vite，
 * 生产经环境变量 {@code OA_CORS_ALLOWED_ORIGINS} 注入。
 * 保留 {@code allowCredentials=true} 语义，故须为显式来源列表（不可用 "*"）。
 */
@Configuration
public class CorsConfig {

    @Value("${oa.cors.allowed-origins:http://localhost:5173,http://localhost:5181}")
    private List<String> allowedOrigins;

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(allowedOrigins);
        config.setAllowedMethods(List.of("*"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
