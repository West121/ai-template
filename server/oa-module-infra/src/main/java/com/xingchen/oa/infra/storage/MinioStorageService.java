package com.xingchen.oa.infra.storage;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.infra.config.StorageProperties;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.errors.ErrorResponseException;
import lombok.extern.slf4j.Slf4j;

import java.io.InputStream;

/**
 * MinIO / S3 存储（S3 协议，二者共用 MinIO SDK）：桶不存在自动创建。
 */
@Slf4j
public class MinioStorageService implements StorageService {

    private final MinioClient client;
    private final String bucket;
    private final String type;

    public MinioStorageService(StorageProperties.Minio props, String type) {
        this.type = "s3".equalsIgnoreCase(type) ? "S3" : "MINIO";
        this.bucket = props.getBucket();
        this.client = MinioClient.builder()
                .endpoint(props.getEndpoint())
                .credentials(props.getAccessKey(), props.getSecretKey())
                .build();
        ensureBucket();
        log.info("MinioStorageService 就绪, endpoint={}, bucket={}, type={}", props.getEndpoint(), bucket, this.type);
    }

    private void ensureBucket() {
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
                log.info("MinIO 桶 {} 不存在，已自动创建", bucket);
            }
        } catch (Exception e) {
            throw new IllegalStateException("MinIO 桶检查/创建失败: " + e.getMessage(), e);
        }
    }

    @Override
    public String type() {
        return type;
    }

    @Override
    public void put(String objectKey, InputStream in, long size, String contentType) {
        try {
            client.putObject(PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .stream(in, size, -1)
                    .contentType(contentType != null ? contentType : "application/octet-stream")
                    .build());
        } catch (Exception e) {
            throw new BusinessException(500, "对象存储写入失败: " + e.getMessage());
        }
    }

    @Override
    public InputStream get(String objectKey) {
        try {
            return client.getObject(GetObjectArgs.builder().bucket(bucket).object(objectKey).build());
        } catch (ErrorResponseException e) {
            throw new BusinessException(404, "文件不存在或已被清理");
        } catch (Exception e) {
            throw new BusinessException(500, "对象存储读取失败: " + e.getMessage());
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(objectKey).build());
        } catch (Exception e) {
            log.warn("对象存储删除失败: {}", objectKey, e);
        }
    }
}
