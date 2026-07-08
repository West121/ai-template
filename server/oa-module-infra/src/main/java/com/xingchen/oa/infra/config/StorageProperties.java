package com.xingchen.oa.infra.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 存储配置：oa.storage.type = local | minio | s3（minio 与 s3 共用 S3 协议客户端）。
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "oa.storage")
public class StorageProperties {

    /** local | minio | s3 */
    private String type = "local";

    private Local local = new Local();

    /** minio 与 s3 共用该段配置（S3 协议） */
    private Minio minio = new Minio();

    @Getter
    @Setter
    public static class Local {
        /** 本地存储根目录，自动创建 */
        private String basePath = "./data/upload";
        /** 分片暂存目录 */
        private String chunkPath = "./data/chunk";
    }

    @Getter
    @Setter
    public static class Minio {
        private String endpoint = "http://localhost:19002";
        private String accessKey = "minioadmin";
        private String secretKey = "minioadmin";
        private String bucket = "oa-files";
    }
}
