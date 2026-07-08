package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.system.dto.AssignmentCreateRequest;
import com.xingchen.oa.system.dto.AssignmentInfo;
import com.xingchen.oa.system.dto.UserCreateRequest;
import com.xingchen.oa.system.dto.UserEnabledRequest;
import com.xingchen.oa.system.dto.UserResponse;
import com.xingchen.oa.system.dto.UserUpdateRequest;
import com.xingchen.oa.system.service.SysUserService;
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
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(userService.page(keyword, deptId, enabled, pageNum, pageSize));
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

    @PostMapping("/{id}/reset-password")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "重置密码")
    public R<Void> resetPassword(@PathVariable Long id) {
        userService.resetPassword(id);
        return R.ok();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "删除")
    public R<Void> delete(@PathVariable Long id) {
        userService.delete(id);
        return R.ok();
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
