package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.system.dto.PermissionTreeNode;
import com.xingchen.oa.system.service.SysPermissionService;
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
