package com.xingchen.oa.office.knowledge.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.office.knowledge.dto.KbDtos.MemberRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.MemberResponse;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SpaceRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SpaceResponse;
import com.xingchen.oa.office.knowledge.service.KbSpaceService;
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
 * 知识空间 + 成员管理（ai-knowledge-base.md §2/§5）。
 * 列表/详情仅返回当前用户可见的空间（可见性 + 成员过滤，红线）。
 */
@RestController
@RequestMapping("/api/kb/spaces")
@RequiredArgsConstructor
public class KbSpaceController {

    private final KbSpaceService spaceService;

    @GetMapping
    @PreAuthorize("hasAuthority('kb:space:view')")
    public R<List<SpaceResponse>> list() {
        return R.ok(spaceService.list());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:space:view')")
    public R<SpaceResponse> get(@PathVariable Long id) {
        return R.ok(spaceService.get(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('kb:space:manage')")
    @OperLog(module = "知识库", action = "创建空间")
    public R<SpaceResponse> create(@Valid @RequestBody SpaceRequest request) {
        return R.ok(spaceService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:space:manage')")
    @OperLog(module = "知识库", action = "修改空间")
    public R<SpaceResponse> update(@PathVariable Long id, @Valid @RequestBody SpaceRequest request) {
        return R.ok(spaceService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:space:manage')")
    @OperLog(module = "知识库", action = "删除空间")
    public R<Void> delete(@PathVariable Long id) {
        spaceService.delete(id);
        return R.ok();
    }

    @GetMapping("/{id}/members")
    @PreAuthorize("hasAuthority('kb:space:view')")
    public R<List<MemberResponse>> members(@PathVariable Long id) {
        return R.ok(spaceService.members(id));
    }

    @PostMapping("/{id}/members")
    @PreAuthorize("hasAuthority('kb:space:manage')")
    @OperLog(module = "知识库", action = "添加空间成员")
    public R<MemberResponse> addMember(@PathVariable Long id, @Valid @RequestBody MemberRequest request) {
        return R.ok(spaceService.addMember(id, request));
    }

    @DeleteMapping("/{id}/members/{memberId}")
    @PreAuthorize("hasAuthority('kb:space:manage')")
    @OperLog(module = "知识库", action = "移除空间成员")
    public R<Void> removeMember(@PathVariable Long id, @PathVariable Long memberId) {
        spaceService.removeMember(id, memberId);
        return R.ok();
    }
}
