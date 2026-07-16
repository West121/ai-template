package com.hentor.oa.workflow.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.workflow.dto.FormDefRequest;
import com.hentor.oa.workflow.dto.FormDefResponse;
import com.hentor.oa.workflow.dto.FormRecordResponse;
import com.hentor.oa.workflow.service.FormDefService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/wf/form-defs")
@RequiredArgsConstructor
public class FormDefController {

    private final FormDefService service;

    @GetMapping
    public R<PageResult<FormDefResponse>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.page(keyword, pageNum, pageSize));
    }

    @GetMapping("/{id}")
    public R<FormDefResponse> get(@PathVariable Long id) {
        return R.ok(service.get(id));
    }

    @GetMapping("/{code}/latest")
    public R<FormDefResponse> latest(@PathVariable String code) {
        return R.ok(service.latest(code));
    }

    @GetMapping("/{code}/versions")
    public R<List<FormDefResponse>> versions(@PathVariable String code) {
        return R.ok(service.versions(code));
    }

    /** 关联表单记录：查该表单已提交的流程实例作为 relation 控件可选项【登录】。 */
    @GetMapping("/{defCode}/records")
    public R<PageResult<FormRecordResponse>> records(
            @PathVariable String defCode,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.records(defCode, keyword, pageNum, pageSize));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<FormDefResponse> create(@Valid @RequestBody FormDefRequest req) {
        return R.ok(service.create(req));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<FormDefResponse> update(@PathVariable Long id, @Valid @RequestBody FormDefRequest req) {
        return R.ok(service.update(id, req));
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<FormDefResponse> publish(@PathVariable Long id) {
        return R.ok(service.publish(id));
    }
}
