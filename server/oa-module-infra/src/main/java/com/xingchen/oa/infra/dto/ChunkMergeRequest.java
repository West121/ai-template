package com.xingchen.oa.infra.dto;

import jakarta.validation.constraints.NotBlank;

public record ChunkMergeRequest(@NotBlank(message = "uploadId 不能为空") String uploadId) {
}
