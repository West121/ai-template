package com.hentor.oa.infra.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record ChunkInitRequest(
        @NotBlank(message = "fileName 不能为空") String fileName,
        @NotNull(message = "size 不能为空") Long size,
        String contentType,
        Long chunkSize,
        @NotBlank(message = "fileHash 不能为空") String fileHash) {
}
