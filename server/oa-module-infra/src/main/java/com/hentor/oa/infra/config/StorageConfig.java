package com.hentor.oa.infra.config;

import com.hentor.oa.infra.storage.LocalStorageService;
import com.hentor.oa.infra.storage.MinioStorageService;
import com.hentor.oa.infra.storage.StorageService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 按 oa.storage.type 选择存储实现（工厂方式）：
 * local → LocalStorageService；minio / s3 → MinioStorageService（S3 协议共用）。
 */
@Configuration
public class StorageConfig {

    @Bean
    public StorageService storageService(StorageProperties props) {
        String type = props.getType() == null ? "local" : props.getType().toLowerCase();
        return switch (type) {
            case "minio", "s3" -> new MinioStorageService(props.getMinio(), type);
            case "local" -> new LocalStorageService(props.getLocal().getBasePath());
            default -> throw new IllegalStateException("不支持的存储类型 oa.storage.type=" + props.getType());
        };
    }
}
