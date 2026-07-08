package com.xingchen.oa.system.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 部门树节点。userCount = 该部门任职数（含兼任）；leaderName 由后端一次 findAllById 组装。
 */
public record DeptTreeNode(
        Long id,
        String name,
        Long parentId,
        Integer sort,
        String code,
        Long leaderId,
        String leaderName,
        Boolean enabled,
        LocalDateTime createdAt,
        long userCount,
        List<DeptTreeNode> children
) {
}
