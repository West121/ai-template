package com.hentor.oa.infra.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 文件记录：物理内容由 StorageService（LOCAL / MINIO / S3）保管，此处只存元数据。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_file")
public class SysFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "original_name", nullable = false, length = 255)
    private String originalName;

    @Column(length = 32)
    private String ext;

    @Column(nullable = false)
    private Long size = 0L;

    @Column(name = "content_type", length = 128)
    private String contentType;

    /** LOCAL / MINIO / S3 */
    @Column(name = "storage_type", nullable = false, length = 10)
    private String storageType;

    @Column(name = "object_key", nullable = false, length = 255)
    private String objectKey;

    @Column(name = "file_hash", length = 64)
    private String fileHash;

    @Column(name = "uploader_id")
    private Long uploaderId;

    @Column(name = "uploader_name", length = 64)
    private String uploaderName;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
