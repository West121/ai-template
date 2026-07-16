package com.hentor.oa.system.service;

import com.hentor.oa.common.core.BatchResult;
import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.system.dto.RoleRequest;
import com.hentor.oa.system.dto.RoleResponse;
import com.hentor.oa.system.entity.SysPermission;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysPermissionRepository;
import com.hentor.oa.system.repository.SysRoleRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 角色管理 + 角色权限分配（全量替换）。
 */
@Service
@RequiredArgsConstructor
public class SysRoleService {

    private final SysRoleRepository roleRepository;
    private final SysPermissionRepository permissionRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysDeptRepository deptRepository;

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
        applyCustomDepts(role, request);
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
        applyCustomDepts(role, request);
        roleRepository.save(role);
        return RoleResponse.of(role, assignmentRepository.countByRoleId(id));
    }

    /**
     * 落地自定义数据范围可见部门（sys_role_dept）：
     * <ul>
     *   <li>dataScope=CUSTOM：customDeptIds 必填非空（否则该角色什么都看不到，属配置错误），
     *       且部门必须存在，写入自定义部门集；</li>
     *   <li>其它数据范围：清空自定义部门集，避免残留脏数据（切回 CUSTOM 时不会误用旧集合）。</li>
     * </ul>
     */
    private void applyCustomDepts(SysRole role, RoleRequest request) {
        if (!SysRole.SCOPE_CUSTOM.equals(request.dataScope())) {
            role.setCustomDeptIds(new HashSet<>());
            return;
        }
        Set<Long> deptIds = request.customDeptIds();
        if (deptIds == null || deptIds.isEmpty()) {
            throw new BusinessException(400, "数据范围为自定义时，请选择自定义可见部门");
        }
        if (deptRepository.findAllById(deptIds).size() != deptIds.size()) {
            throw new BusinessException(400, "存在无效的部门");
        }
        role.setCustomDeptIds(new HashSet<>(deptIds));
    }

    @Transactional
    public void delete(Long id) {
        SysRole role = roleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "角色不存在"));
        if (PermissionService.SUPER_ADMIN_ROLE.equals(role.getCode())) {
            throw new BusinessException(400, "内置超级管理员角色不可删除");
        }
        if (assignmentRepository.countByRoleId(id) > 0) {
            throw new BusinessException(400, "角色已被任职引用，无法删除");
        }
        roleRepository.delete(role);
    }

    /**
     * 批量删除角色（统一协议）。护栏：内置超级管理员角色（ADMIN）不可删、被任职引用不可删（各计 failed）。
     * 幂等：已不存在的 id 计 success。
     */
    @Transactional
    public BatchResult batchDelete(List<Long> ids) {
        BatchResult result = new BatchResult();
        for (Long id : distinctIds(ids)) {
            var roleOpt = roleRepository.findById(id);
            if (roleOpt.isEmpty()) {
                result.success(id); // 幂等
                continue;
            }
            SysRole role = roleOpt.get();
            if (PermissionService.SUPER_ADMIN_ROLE.equals(role.getCode())) {
                result.fail(id, "内置超级管理员角色不可删除");
                continue;
            }
            if (assignmentRepository.countByRoleId(id) > 0) {
                result.fail(id, "角色已被任职引用，无法删除");
                continue;
            }
            roleRepository.delete(role);
            result.success(id);
        }
        return result;
    }

    private static List<Long> distinctIds(List<Long> ids) {
        if (ids == null) {
            return List.of();
        }
        return ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
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
