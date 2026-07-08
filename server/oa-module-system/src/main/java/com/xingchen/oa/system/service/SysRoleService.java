package com.xingchen.oa.system.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.system.dto.RoleRequest;
import com.xingchen.oa.system.dto.RoleResponse;
import com.xingchen.oa.system.entity.SysPermission;
import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.repository.SysPermissionRepository;
import com.xingchen.oa.system.repository.SysRoleRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;

/**
 * 角色管理 + 角色权限分配（全量替换）。
 */
@Service
@RequiredArgsConstructor
public class SysRoleService {

    private final SysRoleRepository roleRepository;
    private final SysPermissionRepository permissionRepository;
    private final SysUserAssignmentRepository assignmentRepository;

    @Transactional(readOnly = true)
    public PageResult<RoleResponse> page(int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize,
                Sort.by(Sort.Order.asc("sort"), Sort.Order.asc("id")));
        Page<SysRole> page = roleRepository.findAll(pageable);
        return PageResult.from(page.map(role ->
                RoleResponse.of(role, assignmentRepository.countByRoleId(role.getId()))));
    }

    @Transactional
    public RoleResponse create(RoleRequest request) {
        if (roleRepository.existsByCode(request.code())) {
            throw new BusinessException(400, "角色编码已存在");
        }
        SysRole role = new SysRole();
        role.setCode(request.code());
        role.setName(request.name());
        role.setDataScope(request.dataScope());
        role.setEnabled(request.enabled() == null || request.enabled());
        roleRepository.save(role);
        return RoleResponse.of(role, 0);
    }

    @Transactional
    public RoleResponse update(Long id, RoleRequest request) {
        SysRole role = roleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "角色不存在"));
        if (roleRepository.existsByCodeAndIdNot(request.code(), id)) {
            throw new BusinessException(400, "角色编码已存在");
        }
        role.setCode(request.code());
        role.setName(request.name());
        role.setDataScope(request.dataScope());
        if (request.enabled() != null) {
            role.setEnabled(request.enabled());
        }
        roleRepository.save(role);
        return RoleResponse.of(role, assignmentRepository.countByRoleId(id));
    }

    @Transactional
    public void delete(Long id) {
        SysRole role = roleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "角色不存在"));
        if (assignmentRepository.countByRoleId(id) > 0) {
            throw new BusinessException(400, "角色已被任职引用，无法删除");
        }
        roleRepository.delete(role);
    }

    @Transactional(readOnly = true)
    public List<Long> permissionIds(Long id) {
        SysRole role = roleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "角色不存在"));
        return role.getPermissions().stream().map(SysPermission::getId).sorted().toList();
    }

    /**
     * 角色权限全量替换。
     */
    @Transactional
    public void replacePermissions(Long id, List<Long> permissionIds) {
        SysRole role = roleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "角色不存在"));
        List<SysPermission> permissions = permissionRepository.findAllById(
                permissionIds == null ? List.of() : permissionIds);
        role.setPermissions(new HashSet<>(permissions));
        roleRepository.save(role);
    }
}
