package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.system.dto.DeptRequest;
import com.xingchen.oa.system.dto.DeptTreeNode;
import com.xingchen.oa.system.service.SysDeptService;
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
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 部门管理。查询仅要求登录，写操作需 system:dept:edit。
 */
@RestController
@RequestMapping("/api/system/depts")
@RequiredArgsConstructor
public class SysDeptController {

    private final SysDeptService deptService;

    @GetMapping("/tree")
    public R<List<DeptTreeNode>> tree() {
        return R.ok(deptService.tree());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:dept:edit')")
    @OperLog(module = "部门", action = "创建")
    public R<DeptTreeNode> create(@Valid @RequestBody DeptRequest request) {
        return R.ok(deptService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:dept:edit')")
    @OperLog(module = "部门", action = "修改")
    public R<Void> update(@PathVariable Long id, @Valid @RequestBody DeptRequest request) {
        deptService.update(id, request);
        return R.ok();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:dept:edit')")
    @OperLog(module = "部门", action = "删除")
    public R<Void> delete(@PathVariable Long id) {
        deptService.delete(id);
        return R.ok();
    }
}
