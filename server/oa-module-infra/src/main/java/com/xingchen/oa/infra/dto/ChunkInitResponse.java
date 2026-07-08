package com.xingchen.oa.infra.dto;

import java.util.List;

/**
 * 契约：{uploadId,uploaded:number[],instant:boolean,file?:FileRecord}
 * fileHash 命中已有完整文件 → instant=true 秒传返回 file；否则返回已上传分片序号供断点续传。
 */
public record ChunkInitResponse(
        String uploadId,
        List<Integer> uploaded,
        boolean instant,
        FileRecordResponse file) {
}
