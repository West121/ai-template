package com.xingchen.oa.infra.storage;

import com.xingchen.oa.common.exception.BusinessException;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

/**
 * 本地磁盘存储：objectKey = yyyy/MM/uuid.ext，根目录自动创建。
 */
@Slf4j
public class LocalStorageService implements StorageService {

    private final Path basePath;

    public LocalStorageService(String basePath) {
        this.basePath = Paths.get(basePath).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.basePath);
        } catch (IOException e) {
            throw new IllegalStateException("本地存储目录创建失败: " + this.basePath, e);
        }
        log.info("LocalStorageService 就绪, base-path={}", this.basePath);
    }

    @Override
    public String type() {
        return "LOCAL";
    }

    private Path resolve(String objectKey) {
        Path path = basePath.resolve(objectKey).normalize();
        if (!path.startsWith(basePath)) {
            throw new BusinessException(400, "非法的文件路径");
        }
        return path;
    }

    @Override
    public void put(String objectKey, InputStream in, long size, String contentType) {
        try {
            Path target = resolve(objectKey);
            Files.createDirectories(target.getParent());
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new BusinessException(500, "文件写入失败: " + e.getMessage());
        }
    }

    @Override
    public InputStream get(String objectKey) {
        Path path = resolve(objectKey);
        if (!Files.exists(path)) {
            throw new BusinessException(404, "文件不存在或已被清理");
        }
        try {
            return Files.newInputStream(path);
        } catch (IOException e) {
            throw new BusinessException(500, "文件读取失败: " + e.getMessage());
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            Files.deleteIfExists(resolve(objectKey));
        } catch (IOException e) {
            log.warn("本地文件删除失败: {}", objectKey, e);
        }
    }
}
