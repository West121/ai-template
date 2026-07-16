package com.hentor.oa.system.service;

import com.hentor.oa.system.dto.PermissionTreeNode;
import com.hentor.oa.system.entity.SysPermission;
import com.hentor.oa.system.repository.SysPermissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

/**
 * 权限点查询（parent_id 组树，根 parent_id = 0）。
 */
@Service
@RequiredArgsConstructor
public class SysPermissionService {

    private static final long ROOT_PARENT_ID = 0L;

    private final SysPermissionRepository permissionRepository;

    @Transactional(readOnly = true)
    public List<PermissionTreeNode> tree() {
        List<SysPermission> all = permissionRepository.findAllByOrderByIdAsc();
        return buildTree(all, ROOT_PARENT_ID);
    }

    private List<PermissionTreeNode> buildTree(List<SysPermission> all, long parentId) {
        return all.stream()
                .filter(p -> Objects.equals(p.getParentId() == null ? ROOT_PARENT_ID : p.getParentId(), parentId))
                .map(p -> new PermissionTreeNode(
                        p.getId(),
                        p.getCode(),
                        p.getName(),
                        p.getType(),
                        buildTree(all, p.getId())))
                .toList();
    }
}
