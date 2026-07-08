package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.system.dto.RolePermissionsRequest;
import com.xingchen.oa.system.dto.RoleRequest;
import com.xingchen.oa.system.dto.RoleResponse;
import com.xingchen.oa.system.service.SysRoleService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 角色管理 + 角色权限分配。查询仅要求登录，写操作需 system:role:edit。
 */
@RestController
@RequestMapping("/api/system/roles")
@RequiredArgsConstructor
public class SysRoleController {

    private final SysRoleService roleService;

    @GetMapping
    public R<PageResult<RoleResponse>> page(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(roleService.page(pageNum, pageSize));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:role:edit')")
    @OperLog(module = "角色", action = "创建")
    public R<RoleResponse> create(@Valid @RequestBody RoleRequest request) {
        return R.ok(roleService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:role:edit')")
    @OperLog(module = "角色", action = "修改")
    public R<RoleResponse> update(@PathVariable Long id, @Valid @RequestBody RoleRequest request) {
        return R.ok(roleService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:role:edit')")
    @OperLog(module = "角色", action = "删除")
    public R<Void> delete(@PathVariable Long id) {
        roleService.delete(id);
        return R.ok();
    }

    @GetMapping("/{id}/permissions")
    public R<List<Long>> permissions(@PathVariable Long id) {
        return R.ok(roleService.permissionIds(id));
    }

    @PutMapping("/{id}/permissions")
    @PreAuthorize("hasAuthority('system:role:edit')")
    public R<Void> replacePermissions(@PathVariable Long id, @Valid @RequestBody RolePermissionsRequest request) {
        roleService.replacePermissions(id, request.permissionIds());
        return R.ok();
    }
}
