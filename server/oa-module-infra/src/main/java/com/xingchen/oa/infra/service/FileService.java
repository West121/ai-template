package com.xingchen.oa.infra.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.infra.config.StorageProperties;
import com.xingchen.oa.infra.dto.ChunkInitRequest;
import com.xingchen.oa.infra.dto.ChunkInitResponse;
import com.xingchen.oa.infra.dto.FileRecordResponse;
import com.xingchen.oa.infra.entity.SysFile;
import com.xingchen.oa.infra.repository.SysFileRepository;
import com.xingchen.oa.infra.storage.StorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * 文件管理：直传 / 下载 / 删除 / 分页 + 分片上传（断点续传、秒传）。
 * 分片先落本地暂存目录（./data/chunk/{uploadId}/{index}），合并后推目标存储。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileService {

    private static final String META_FILE = "upload.meta.json";

    private final SysFileRepository fileRepository;
    private final StorageService storageService;
    private final StorageProperties storageProperties;
    private final ObjectMapper objectMapper;

    /** 分片会话元数据（暂存目录内 upload.meta.json，重启后依然可断点续传） */
    public record ChunkMeta(String fileName, Long size, String contentType, Long chunkSize, String fileHash) {
    }

    // ------------------------------------------------------------------
    // 分页 / 直传 / 下载 / 删除
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public PageResult<FileRecordResponse> page(String keyword, int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Order.desc("id")));
        Page<SysFile> page = StringUtils.hasText(keyword)
                ? fileRepository.findByOriginalNameContaining(keyword, pageable)
                : fileRepository.findAll(pageable);
        return PageResult.from(page.map(FileRecordResponse::of));
    }

    @Transactional
    public FileRecordResponse upload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(400, "上传文件不能为空");
        }
        String originalName = StringUtils.hasText(file.getOriginalFilename()) ? file.getOriginalFilename() : "unnamed";
        String ext = extOf(originalName);
        String objectKey = buildObjectKey(ext);
        String hash;
        try (InputStream in = file.getInputStream()) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (DigestInputStream din = new DigestInputStream(in, digest)) {
                storageService.put(objectKey, din, file.getSize(), file.getContentType());
            }
            hash = HexFormat.of().formatHex(digest.digest());
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(500, "文件上传失败: " + e.getMessage());
        }
        SysFile record = saveRecord(originalName, ext, file.getSize(), file.getContentType(), objectKey, hash);
        return FileRecordResponse.of(record);
    }

    @Transactional(readOnly = true)
    public SysFile getOrThrow(Long id) {
        return fileRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文件记录不存在"));
    }

    public InputStream openStream(SysFile file) {
        return storageService.get(file.getObjectKey());
    }

    @Transactional
    public void delete(Long id) {
        SysFile file = getOrThrow(id);
        storageService.delete(file.getObjectKey());
        fileRepository.delete(file);
    }

    // ------------------------------------------------------------------
    // 分片上传 / 断点续传 / 秒传
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public ChunkInitResponse chunkInit(ChunkInitRequest request) {
        // 1. 秒传：fileHash 命中已有完整文件
        Optional<SysFile> hit = fileRepository.findFirstByFileHashOrderByIdAsc(request.fileHash());
        if (hit.isPresent()) {
            return new ChunkInitResponse(null, List.of(), true, FileRecordResponse.of(hit.get()));
        }
        // 2. 断点续传：暂存目录中已有同 fileHash 的会话则复用（返回已上传分片）
        String uploadId = findSessionByHash(request.fileHash()).orElse(null);
        if (uploadId == null) {
            uploadId = UUID.randomUUID().toString();
            Path dir = chunkDir(uploadId);
            try {
                Files.createDirectories(dir);
                objectMapper.writeValue(dir.resolve(META_FILE).toFile(), new ChunkMeta(
                        request.fileName(), request.size(), request.contentType(),
                        request.chunkSize(), request.fileHash()));
            } catch (Exception e) {
                throw new BusinessException(500, "分片会话创建失败: " + e.getMessage());
            }
        }
        return new ChunkInitResponse(uploadId, uploadedIndexes(uploadId), false, null);
    }

    public List<Integer> saveChunk(String uploadId, int index, MultipartFile chunk) {
        Path dir = chunkDir(uploadId);
        if (!Files.isDirectory(dir)) {
            throw new BusinessException(400, "上传会话不存在或已过期，请重新初始化");
        }
        if (chunk == null || chunk.isEmpty()) {
            throw new BusinessException(400, "分片内容不能为空");
        }
        try (InputStream in = chunk.getInputStream()) {
            Files.copy(in, dir.resolve(String.valueOf(index)), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new BusinessException(500, "分片保存失败: " + e.getMessage());
        }
        return uploadedIndexes(uploadId);
    }

    @Transactional
    public FileRecordResponse merge(String uploadId) {
        Path dir = chunkDir(uploadId);
        Path metaPath = dir.resolve(META_FILE);
        if (!Files.isDirectory(dir) || !Files.exists(metaPath)) {
            throw new BusinessException(400, "上传会话不存在或已过期，请重新初始化");
        }
        ChunkMeta meta;
        try {
            meta = objectMapper.readValue(metaPath.toFile(), ChunkMeta.class);
        } catch (Exception e) {
            throw new BusinessException(500, "分片元数据读取失败: " + e.getMessage());
        }
        List<Integer> indexes = uploadedIndexes(uploadId);
        if (indexes.isEmpty()) {
            throw new BusinessException(400, "尚未上传任何分片");
        }
        for (int i = 0; i < indexes.size(); i++) {
            if (indexes.get(i) != i) {
                throw new BusinessException(400, "分片不连续，缺少序号 " + i + " 的分片");
            }
        }
        String ext = extOf(meta.fileName());
        String objectKey = buildObjectKey(ext);
        Path merged = null;
        try {
            merged = Files.createTempFile(dir, "merged-", ".tmp");
            try (OutputStream out = Files.newOutputStream(merged)) {
                for (Integer index : indexes) {
                    Files.copy(dir.resolve(String.valueOf(index)), out);
                }
            }
            long size = Files.size(merged);
            try (InputStream in = Files.newInputStream(merged)) {
                storageService.put(objectKey, in, size, meta.contentType());
            }
            SysFile record = saveRecord(meta.fileName(), ext, size, meta.contentType(), objectKey, meta.fileHash());
            cleanDir(dir);
            return FileRecordResponse.of(record);
        } catch (BusinessException e) {
            throw e;
        } catch (IOException e) {
            throw new BusinessException(500, "分片合并失败: " + e.getMessage());
        } finally {
            if (merged != null) {
                try {
                    Files.deleteIfExists(merged);
                } catch (IOException ignored) {
                    // 暂存目录整体清理时兜底
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private SysFile saveRecord(String originalName, String ext, long size, String contentType,
                               String objectKey, String fileHash) {
        SysFile record = new SysFile();
        record.setOriginalName(originalName);
        record.setExt(ext);
        record.setSize(size);
        record.setContentType(contentType);
        record.setStorageType(storageService.type());
        record.setObjectKey(objectKey);
        record.setFileHash(fileHash);
        UserContext user = CurrentUserHolder.get();
        if (user != null) {
            record.setUploaderId(user.getUserId());
            record.setUploaderName(user.getName());
        }
        return fileRepository.save(record);
    }

    private String buildObjectKey(String ext) {
        String prefix = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM"));
        String name = UUID.randomUUID().toString();
        return StringUtils.hasText(ext) ? prefix + "/" + name + "." + ext : prefix + "/" + name;
    }

    private String extOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot >= 0 && dot < fileName.length() - 1 ? fileName.substring(dot + 1).toLowerCase() : "";
    }

    private Path chunkRoot() {
        return Paths.get(storageProperties.getLocal().getChunkPath()).toAbsolutePath().normalize();
    }

    private Path chunkDir(String uploadId) {
        if (!uploadId.matches("[0-9a-fA-F-]{8,64}")) {
            throw new BusinessException(400, "非法的 uploadId");
        }
        return chunkRoot().resolve(uploadId);
    }

    private Optional<String> findSessionByHash(String fileHash) {
        Path root = chunkRoot();
        if (!Files.isDirectory(root)) {
            return Optional.empty();
        }
        try (Stream<Path> dirs = Files.list(root)) {
            return dirs.filter(Files::isDirectory)
                    .filter(dir -> Files.exists(dir.resolve(META_FILE)))
                    .filter(dir -> {
                        try {
                            ChunkMeta meta = objectMapper.readValue(dir.resolve(META_FILE).toFile(), ChunkMeta.class);
                            return fileHash.equals(meta.fileHash());
                        } catch (Exception e) {
                            return false;
                        }
                    })
                    .map(dir -> dir.getFileName().toString())
                    .findFirst();
        } catch (IOException e) {
            return Optional.empty();
        }
    }

    private List<Integer> uploadedIndexes(String uploadId) {
        Path dir = chunkDir(uploadId);
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        List<Integer> indexes = new ArrayList<>();
        try (Stream<Path> files = Files.list(dir)) {
            files.map(p -> p.getFileName().toString())
                    .filter(name -> name.matches("\\d+"))
                    .forEach(name -> indexes.add(Integer.parseInt(name)));
        } catch (IOException e) {
            throw new BusinessException(500, "分片目录读取失败: " + e.getMessage());
        }
        indexes.sort(Comparator.naturalOrder());
        return indexes;
    }

    private void cleanDir(Path dir) {
        try (Stream<Path> files = Files.walk(dir)) {
            files.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException e) {
                    log.warn("分片暂存清理失败: {}", p);
                }
            });
        } catch (IOException e) {
            log.warn("分片暂存清理失败: {}", dir, e);
        }
    }

    /** 供冒烟 / 诊断：当前激活存储类型 */
    public Map<String, String> storageInfo() {
        return Map.of("type", storageService.type());
    }
}
