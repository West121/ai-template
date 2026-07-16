package com.hentor.oa.infra.storage;

import java.io.InputStream;

/**
 * 对象存储抽象：LOCAL（本地磁盘）/ MINIO / S3（后两者共用 MinIO SDK，S3 协议）。
 */
public interface StorageService {

    /** 存储类型标识：LOCAL / MINIO / S3（落库到 sys_file.storage_type） */
    String type();

    void put(String objectKey, InputStream in, long size, String contentType);

    InputStream get(String objectKey);

    void delete(String objectKey);
}
