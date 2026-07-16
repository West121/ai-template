package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.entity.AiDataset;
import com.hentor.oa.boot.ai.repository.AiDatasetRepository;
import com.hentor.oa.boot.ai.support.AiErrors;
import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 数据集服务（§11.2，批C）：>20 行报表结果落库短存（默认 30min 过期），聊天卡片只带
 * datasetId + 首页数据；访问再次校验 tenant+user 归属（越权 403），过期 410。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiDatasetService {

    private static final int TTL_MINUTES = 30;

    private final AiDatasetRepository repository;
    private final ObjectMapper objectMapper;

    /** 落库数据集，返回 id（rows 全量 inline 存储；storage_ref 留外置扩展点）。 */
    public Long create(Long userId, Long sessionId, String reportCode,
                       List<Map<String, String>> columns, List<Map<String, Object>> rows) {
        AiDataset ds = new AiDataset();
        ds.setTenantId(AiErrors.TENANT_DEFAULT);
        ds.setUserId(userId);
        ds.setSessionId(sessionId);
        ds.setReportCode(reportCode);
        String rowsJson = toJson(rows);
        ds.setQueryHash(AiErrors.sha256(reportCode + "|" + rowsJson));
        ds.setSchemaJson(toJson(columns));
        ds.setRowCount(rows.size());
        ds.setStorageRef("inline");
        ds.setRowsJson(rowsJson);
        ds.setExpiresAt(OffsetDateTime.now().plusMinutes(TTL_MINUTES));
        return repository.save(ds).getId();
    }

    /** 分页访问（再鉴权：归属 403 / 过期 410）。 */
    @SuppressWarnings("unchecked")
    public PageResult<Map<String, Object>> page(Long id, int pageNum, int pageSize, UserContext user) {
        AiDataset ds = repository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "数据集不存在"));
        if (!ds.getUserId().equals(user.getUserId())) {
            throw new BusinessException(403, "无权访问该数据集"); // §11.2 访问必须再次校验用户
        }
        if (ds.getExpiresAt() != null && ds.getExpiresAt().isBefore(OffsetDateTime.now())) {
            throw new BusinessException(410, "数据集已过期，请重新执行报表");
        }
        List<Map<String, Object>> rows;
        try {
            rows = StringUtils.hasText(ds.getRowsJson())
                    ? objectMapper.readValue(ds.getRowsJson(), List.class) : List.of();
        } catch (Exception e) {
            rows = List.of();
        }
        int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, rows.size());
        int to = Math.min(from + pageSize, rows.size());
        List<Map<String, Object>> pageRows = new ArrayList<>(rows.subList(from, to));
        return new PageResult<>(pageRows, rows.size(), pageNum, pageSize);
    }

    /** 数据集元信息（列定义等，前端表格渲染用）。 */
    public Map<String, Object> meta(Long id, UserContext user) {
        AiDataset ds = repository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "数据集不存在"));
        if (!ds.getUserId().equals(user.getUserId())) {
            throw new BusinessException(403, "无权访问该数据集");
        }
        return Map.of("id", ds.getId(), "reportCode", nz(ds.getReportCode()),
                "columns", parse(ds.getSchemaJson()), "rowCount", ds.getRowCount(),
                "expiresAt", String.valueOf(ds.getExpiresAt()));
    }

    private Object parse(String json) {
        try {
            return StringUtils.hasText(json) ? objectMapper.readTree(json) : List.of();
        } catch (Exception e) {
            return List.of();
        }
    }

    private String toJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return "[]";
        }
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
