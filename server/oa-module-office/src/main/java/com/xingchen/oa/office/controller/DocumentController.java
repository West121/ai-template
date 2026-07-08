package com.xingchen.oa.office.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.dto.DocumentCreateRequest;
import com.xingchen.oa.office.dto.DocumentResponse;
import com.xingchen.oa.office.service.DocumentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/office/documents")
@RequiredArgsConstructor
public class DocumentController {

    private final DocumentService documentService;

    @GetMapping
    public R<PageResult<DocumentResponse>> page(
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(documentService.page(direction, status, keyword, pageNum, pageSize));
    }

    /**
     * 新建发文：code 自动生成，status = DRAFT。
     */
    @PostMapping
    public R<DocumentResponse> create(@Valid @RequestBody DocumentCreateRequest request) {
        return R.ok(documentService.create(request));
    }

    /**
     * 收文签收：待签收 → 办理中。
     */
    @PostMapping("/{id}/sign")
    public R<DocumentResponse> sign(@PathVariable Long id) {
        return R.ok(documentService.sign(id));
    }

    /**
     * 收文办结：办理中 → 已办结。
     */
    @PostMapping("/{id}/finish")
    public R<DocumentResponse> finish(@PathVariable Long id) {
        return R.ok(documentService.finish(id));
    }

    /**
     * 发文提交核稿：DRAFT → REVIEWING。
     */
    @PostMapping("/{id}/review")
    public R<DocumentResponse> review(@PathVariable Long id) {
        return R.ok(documentService.review(id));
    }

    /**
     * 发文签发：REVIEWING → ISSUED，签发人为当前用户。
     */
    @PostMapping("/{id}/issue")
    public R<DocumentResponse> issue(@PathVariable Long id) {
        return R.ok(documentService.issue(id));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('office:document:edit')")
    public R<Void> delete(@PathVariable Long id) {
        documentService.delete(id);
        return R.ok();
    }
}
