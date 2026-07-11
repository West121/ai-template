package com.xingchen.oa.boot.ai.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.office.entity.Approval;
import com.xingchen.oa.office.entity.Document;
import com.xingchen.oa.office.repository.ApprovalRepository;
import com.xingchen.oa.office.repository.DocumentRepository;
import com.xingchen.oa.office.support.SecuritySupport;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 预置聚合报表（§4 stats_report）：服务端固定聚合查询 + <b>数据权限</b>（复用 office SecuritySupport.dataScope
 * Specification，与列表口径一致），LLM 不自算。首批：审批按状态/按类型、公文按文种。
 */
@Service
@RequiredArgsConstructor
public class AiStatsService {

    private final ApprovalRepository approvalRepository;
    private final DocumentRepository documentRepository;

    /** @param chartType bar|pie；categories/data 一一对应；metric=度量名。 */
    public record StatResult(String title, String chartType, String metric,
                             List<String> categories, List<Number> data) {
    }

    public StatResult report(String module, String dimension) {
        if (!StringUtils.hasText(module)) {
            throw new BusinessException(400, "stats_report 缺少 module");
        }
        return switch (module.toLowerCase()) {
            case "approval" -> approvalStats(dimension);
            case "document" -> documentStats(dimension);
            default -> throw new BusinessException(400,
                    "暂不支持的统计模块: " + module + "（支持 approval / document）");
        };
    }

    private StatResult approvalStats(String dimension) {
        List<Approval> all = approvalRepository.findAll(SecuritySupport.dataScope("deptId", "applicantId"));
        boolean byType = "type".equalsIgnoreCase(dimension);
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Approval a : all) {
            String key = byType ? typeLabel(a.getType()) : statusLabel(a.getStatus());
            counts.merge(key, 1, Integer::sum);
        }
        return toResult(byType ? "审批量按类型统计" : "审批量按状态统计",
                byType ? "bar" : "pie", "审批量", counts);
    }

    private StatResult documentStats(String dimension) {
        List<Document> all = documentRepository.findAll(SecuritySupport.dataScope("deptId", "creatorId"));
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Document d : all) {
            counts.merge(d.getDocType() == null ? "未分类" : d.getDocType(), 1, Integer::sum);
        }
        return toResult("公文按文种统计", "bar", "公文数", counts);
    }

    private StatResult toResult(String title, String chartType, String metric, Map<String, Integer> counts) {
        List<String> categories = new ArrayList<>(counts.keySet());
        List<Number> data = new ArrayList<>(counts.values());
        return new StatResult(title, chartType, metric, categories, data);
    }

    private String statusLabel(String status) {
        return switch (status == null ? "" : status) {
            case "PENDING" -> "待审批";
            case "APPROVED" -> "已通过";
            case "REJECTED" -> "已驳回";
            case "WITHDRAWN" -> "已撤回";
            default -> status == null ? "其它" : status;
        };
    }

    private String typeLabel(String type) {
        return switch (type == null ? "" : type) {
            case "LEAVE" -> "请假";
            case "TRIP" -> "出差";
            case "EXPENSE" -> "报销";
            case "OVERTIME" -> "加班";
            default -> type == null ? "其它" : type;
        };
    }
}
