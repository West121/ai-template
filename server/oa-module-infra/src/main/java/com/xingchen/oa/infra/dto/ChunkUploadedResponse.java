package com.xingchen.oa.infra.dto;

import java.util.List;

/**
 * 契约：POST /api/infra/files/chunk → {uploaded:number[]}
 */
public record ChunkUploadedResponse(List<Integer> uploaded) {
}
