package com.xingchen.oa.infra.dto;

import com.xingchen.oa.infra.entity.SysFile;

import java.time.LocalDateTime;

/**
 * 契约 FileRecord = {id,originalName,ext,size,contentType,storageType,objectKey,uploaderId,uploaderName,createdAt}
 */
public record FileRecordResponse(
        Long id,
        String originalName,
        String ext,
        Long size,
        String contentType,
        String storageType,
        String objectKey,
        Long uploaderId,
        String uploaderName,
        LocalDateTime createdAt) {

    public static FileRecordResponse of(SysFile f) {
        return new FileRecordResponse(f.getId(), f.getOriginalName(), f.getExt(), f.getSize(),
                f.getContentType(), f.getStorageType(), f.getObjectKey(),
                f.getUploaderId(), f.getUploaderName(), f.getCreatedAt());
    }
}
