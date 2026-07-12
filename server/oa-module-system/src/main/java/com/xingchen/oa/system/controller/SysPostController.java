package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.BatchResult;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.system.dto.BatchIdsRequest;
import com.xingchen.oa.system.dto.PostRequest;
import com.xingchen.oa.system.dto.PostResponse;
import com.xingchen.oa.system.service.SysPostService;
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

/**
 * 岗位管理。查询仅要求登录，写操作需 system:post:edit。
 */
@RestController
@RequestMapping("/api/system/posts")
@RequiredArgsConstructor
public class SysPostController {

    private final SysPostService postService;

    @GetMapping
    public R<PageResult<PostResponse>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(postService.page(keyword, pageNum, pageSize));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('system:post:edit')")
    @OperLog(module = "岗位", action = "创建")
    public R<PostResponse> create(@Valid @RequestBody PostRequest request) {
        return R.ok(postService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('system:post:edit')")
    @OperLog(module = "岗位", action = "修改")
    public R<PostResponse> update(@PathVariable Long id, @Valid @RequestBody PostRequest request) {
        return R.ok(postService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('system:post:edit')")
    @OperLog(module = "岗位", action = "删除")
    public R<Void> delete(@PathVariable Long id) {
        postService.delete(id);
        return R.ok();
    }

    @PostMapping("/batch-delete")
    @PreAuthorize("hasAuthority('system:post:edit')")
    @OperLog(module = "岗位", action = "批量删除")
    public R<BatchResult> batchDelete(@Valid @RequestBody BatchIdsRequest request) {
        return R.ok(postService.batchDelete(request.ids()));
    }
}
