package com.xingchen.oa.office.knowledge.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.office.knowledge.dto.KbDtos.TagRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.TagResponse;
import com.xingchen.oa.office.knowledge.service.KbTagService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 标签 CRUD（ai-knowledge-base.md §2 kb_tag）。手动标签；AI 自动标签在批3。
 */
@RestController
@RequestMapping("/api/kb/tags")
@RequiredArgsConstructor
public class KbTagController {

    private final KbTagService tagService;

    @GetMapping
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<List<TagResponse>> list() {
        return R.ok(tagService.list());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "创建标签")
    public R<TagResponse> create(@Valid @RequestBody TagRequest request) {
        return R.ok(tagService.create(request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "删除标签")
    public R<Void> delete(@PathVariable Long id) {
        tagService.delete(id);
        return R.ok();
    }
}
