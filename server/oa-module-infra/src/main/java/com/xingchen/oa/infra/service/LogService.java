package com.xingchen.oa.infra.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.infra.dto.RuntimeLogResponse;
import com.xingchen.oa.infra.entity.SysLoginLog;
import com.xingchen.oa.infra.entity.SysOperLog;
import com.xingchen.oa.infra.repository.SysLoginLogRepository;
import com.xingchen.oa.infra.repository.SysOperLogRepository;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.stream.Stream;

/**
 * 日志查询：登录日志 / 操作日志分页 + 运行日志 tail。
 */
@Service
@RequiredArgsConstructor
public class LogService {

    private final SysLoginLogRepository loginLogRepository;
    private final SysOperLogRepository operLogRepository;

    @Value("${logging.file.name:./logs/oa-platform.log}")
    private String logFileName;

    @Transactional(readOnly = true)
    public PageResult<SysLoginLog> loginLogs(String keyword, int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Order.desc("id")));
        return PageResult.from(StringUtils.hasText(keyword)
                ? loginLogRepository.findByUsernameContaining(keyword, pageable)
                : loginLogRepository.findAll(pageable));
    }

    @Transactional(readOnly = true)
    public PageResult<SysOperLog> operLogs(String keyword, String module, int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Order.desc("id")));
        Specification<SysOperLog> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword + "%";
                predicates.add(cb.or(
                        cb.like(root.get("username"), like),
                        cb.like(root.get("action"), like),
                        cb.like(root.get("method"), like)));
            }
            if (StringUtils.hasText(module)) {
                predicates.add(cb.equal(root.get("module"), module));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        return PageResult.from(operLogRepository.findAll(spec, pageable));
    }

    /**
     * 运行日志尾部 N 行；文件不存在时返回提示行。
     */
    public RuntimeLogResponse runtime(int lines) {
        int n = Math.max(1, Math.min(lines, 2000));
        Path path = Paths.get(logFileName).toAbsolutePath().normalize();
        if (!Files.exists(path)) {
            return new RuntimeLogResponse(path.toString(),
                    List.of("日志文件不存在: " + path + "（应用可能尚未产生运行日志）"));
        }
        Deque<String> tail = new ArrayDeque<>(n);
        try (Stream<String> stream = Files.lines(path, StandardCharsets.UTF_8)) {
            stream.forEach(line -> {
                if (tail.size() == n) {
                    tail.pollFirst();
                }
                tail.addLast(line);
            });
        } catch (IOException | RuntimeException e) {
            // Files.lines 惰性读取阶段可能抛 UncheckedIOException
            return new RuntimeLogResponse(path.toString(), List.of("日志文件读取失败: " + e.getMessage()));
        }
        return new RuntimeLogResponse(path.toString(), new ArrayList<>(tail));
    }
}
