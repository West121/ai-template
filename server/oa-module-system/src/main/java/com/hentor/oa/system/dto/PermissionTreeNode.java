package com.hentor.oa.system.dto;

import java.util.List;

/**
 * 权限树节点（type: MENU | BUTTON）。
 */
public record PermissionTreeNode(
        Long id,
        String code,
        String name,
        String type,
        List<PermissionTreeNode> children
) {
}
