package com.hentor.oa.system.controller;

import com.hentor.oa.common.core.BatchResult;
import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import com.hentor.oa.system.dto.AssignmentCreateRequest;
import com.hentor.oa.system.dto.AssignmentInfo;
import com.hentor.oa.system.dto.BatchIdsRequest;
import com.hentor.oa.system.dto.BatchMoveDeptRequest;
import com.hentor.oa.system.dto.BatchSetRolesRequest;
import com.hentor.oa.system.dto.BatchStatusRequest;
import com.hentor.oa.system.dto.TransferRequest;
import com.hentor.oa.system.dto.UserCreateRequest;
import com.hentor.oa.system.dto.UserEnabledRequest;
import com.hentor.oa.system.dto.UserResponse;
import com.hentor.oa.system.dto.UserUpdateRequest;
import com.hentor.oa.system.service.SysUserService;
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
import java.util.Map;

/**
 * 用户管理 + 用户任职（兼任）。查询仅要求登录，写操作需 system:user:edit。
 */
@RestController
@RequestMapping("/api/system/users")
@RequiredArgsConstructor
public class SysUserController {

    private final SysUserService userService;

    @GetMapping
    public R<PageResult<UserResponse>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long deptId,
            @RequestParam(required = false) Boolean enabled,
            @RequestParam(defaultValue = "true") boolean includeSubDept,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(userService.page(keyword, deptId, enabled, includeSubDept, pageNum, pageSize));
    }

    @GetMapping("/{id}")
    public R<UserResponse> getById(@PathVariable Long id) {
        return R.ok(userService.getById(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "创建")
    public R<UserResponse> create(@Valid @RequestBody UserCreateRequest request) {
        return R.ok(userService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "修改")
    public R<UserResponse> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest request) {
        return R.ok(userService.update(id, request));
    }

    @PutMapping("/{id}/enabled")
    @PreAuthorize("hasAuthority('system:user:edit')")
    public R<Void> updateEnabled(@PathVariable Long id, @Valid @RequestBody UserEnabledRequest request) {
        userService.updateEnabled(id, request.enabled());
        return R.ok();
    }

    @PostMapping("/{id}/transfer")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "转岗")
    public R<Map<String, Object>> transfer(@PathVariable Long id, @Valid @RequestBody TransferRequest request) {
        return R.ok(userService.transfer(id, request));
    }

    @PostMapping("/{id}/reset-password")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "重置密码")
    public R<String> resetPassword(@PathVariable Long id) {
        // data = 新生成的一次性随机初始密码，供管理员转交用户（B-12）
        return R.ok(userService.resetPassword(id));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "删除")
    public R<Void> delete(@PathVariable Long id) {
        userService.delete(id);
        return R.ok();
    }

    // ------------------------------------------------------------
    // 批量操作（统一协议 BatchResult{successIds, failed[{id,reason}]}；护栏：不误删/停自己与超管）
    // ------------------------------------------------------------

    @PostMapping("/batch-delete")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "批量删除")
    public R<BatchResult> batchDelete(@Valid @RequestBody BatchIdsRequest request) {
        return R.ok(userService.batchDelete(request.ids()));
    }

    @PostMapping("/batch-status")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "批量启停")
    public R<BatchResult> batchStatus(@Valid @RequestBody BatchStatusRequest request) {
        return R.ok(userService.batchUpdateEnabled(request.ids(), request.enabled()));
    }

    @PostMapping("/batch-move-dept")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "批量移动部门")
    public R<BatchResult> batchMoveDept(@Valid @RequestBody BatchMoveDeptRequest request) {
        return R.ok(userService.batchMoveDept(request.ids(), request.deptId()));
    }

    @PostMapping("/batch-set-roles")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "批量设置角色")
    public R<BatchResult> batchSetRoles(@Valid @RequestBody BatchSetRolesRequest request) {
        return R.ok(userService.batchSetRoles(request.ids(), request.roleIds()));
    }

    // ------------------------------------------------------------
    // 任职（兼任）
    // ------------------------------------------------------------

    @GetMapping("/{id}/assignments")
    public R<List<AssignmentInfo>> assignments(@PathVariable Long id) {
        return R.ok(userService.assignments(id));
    }

    @PostMapping("/{id}/assignments")
    @PreAuthorize("hasAuthority('system:user:edit')")
    public R<List<AssignmentInfo>> addAssignment(
            @PathVariable Long id, @Valid @RequestBody AssignmentCreateRequest request) {
        return R.ok(userService.addAssignment(id, request));
    }
}
