package com.xingchen.oa.infra.controller;

import com.xingchen.oa.common.core.BatchResult;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.infra.dto.BatchIdsRequest;
import com.xingchen.oa.infra.dto.ChunkInitRequest;
import com.xingchen.oa.infra.dto.ChunkInitResponse;
import com.xingchen.oa.infra.dto.ChunkMergeRequest;
import com.xingchen.oa.infra.dto.ChunkUploadedResponse;
import com.xingchen.oa.infra.dto.FileRecordResponse;
import com.xingchen.oa.infra.entity.SysFile;
import com.xingchen.oa.infra.service.FileService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 文件管理：直传 / 下载 / 删除 / 分页 + 分片上传（断点续传、秒传）。
 * 下载统一后端流式转发（MINIO / S3 亦不暴露直链）。
 */
@RestController
@RequestMapping("/api/infra/files")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    /**
     * 分页（B-04）：登录即可调用；service 内做归属过滤 —— 无 system:file:list 且数据权限非 ALL 时仅返回本人上传的文件。
     */
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public R<PageResult<FileRecordResponse>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(fileService.page(keyword, pageNum, pageSize));
    }

    @PostMapping("/upload")
    @OperLog(module = "文件", action = "上传")
    public R<FileRecordResponse> upload(@RequestParam("file") MultipartFile file) {
        return R.ok(fileService.upload(file));
    }

    /**
     * 下载（B-04 IDOR 修复）：仅上传者本人 / 持有 system:file:list / 数据权限 ALL 可下载，否则 403。
     */
    @GetMapping("/{id}/download")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<StreamingResponseBody> download(@PathVariable Long id) {
        SysFile file = fileService.getReadableOrThrow(id);
        String name = StringUtils.hasText(file.getOriginalName()) ? file.getOriginalName() : "download";
        StreamingResponseBody body = out -> {
            try (InputStream in = fileService.openStream(file)) {
                in.transferTo(out);
            }
        };
        MediaType mediaType = MediaType.APPLICATION_OCTET_STREAM;
        try {
            if (StringUtils.hasText(file.getContentType())) {
                mediaType = MediaType.parseMediaType(file.getContentType());
            }
        } catch (Exception ignored) {
            // 非法 contentType 回落 octet-stream
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(name, StandardCharsets.UTF_8)
                        .build()
                        .toString())
                .contentType(mediaType)
                .contentLength(file.getSize() != null ? file.getSize() : -1)
                .body(body);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:file:edit')")
    @OperLog(module = "文件", action = "删除")
    public R<Void> delete(@PathVariable Long id) {
        fileService.delete(id);
        return R.ok();
    }

    @PostMapping("/batch-delete")
    @PreAuthorize("hasAuthority('system:file:edit')")
    @OperLog(module = "文件", action = "批量删除")
    public R<BatchResult> batchDelete(@Valid @RequestBody BatchIdsRequest request) {
        return R.ok(fileService.batchDelete(request.ids()));
    }

    // ------------------------------------------------------------------
    // 分片上传：init（秒传/断点续传探测）→ chunk（分片暂存）→ merge（合并推存储）
    // ------------------------------------------------------------------

    @PostMapping("/chunk/init")
    public R<ChunkInitResponse> chunkInit(@Valid @RequestBody ChunkInitRequest request) {
        return R.ok(fileService.chunkInit(request));
    }

    @PostMapping("/chunk")
    public R<ChunkUploadedResponse> chunk(@RequestParam("uploadId") String uploadId,
                                          @RequestParam("index") int index,
                                          @RequestParam("chunk") MultipartFile chunk) {
        return R.ok(new ChunkUploadedResponse(fileService.saveChunk(uploadId, index, chunk)));
    }

    @PostMapping("/chunk/merge")
    @OperLog(module = "文件", action = "分片合并上传")
    public R<FileRecordResponse> merge(@Valid @RequestBody ChunkMergeRequest request) {
        return R.ok(fileService.merge(request.uploadId()));
    }
}
