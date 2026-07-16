package com.hentor.oa.system.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.system.dto.PermissionTreeNode;
import com.hentor.oa.system.service.SysPermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 权限树查询（仅要求登录）。
 */
@RestController
@RequestMapping("/api/system/permissions")
@RequiredArgsConstructor
public class SysPermissionController {

    private final SysPermissionService permissionService;

    @GetMapping("/tree")
    public R<List<PermissionTreeNode>> tree() {
        return R.ok(permissionService.tree());
    }
}
