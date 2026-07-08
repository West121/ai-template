package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.ProcessDefRequest;
import com.xingchen.oa.workflow.dto.ProcessDefResponse;
import com.xingchen.oa.workflow.service.ProcessDefService;
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

@RestController
@RequestMapping("/api/wf/process-defs")
@RequiredArgsConstructor
public class ProcessDefController {

    private final ProcessDefService service;

    @GetMapping
    public R<PageResult<ProcessDefResponse>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.page(keyword, pageNum, pageSize));
    }

    @GetMapping("/{id}")
    public R<ProcessDefResponse> get(@PathVariable Long id) {
        return R.ok(service.get(id));
    }

    @GetMapping("/{code}/latest")
    public R<ProcessDefResponse> latest(@PathVariable String code) {
        return R.ok(service.latest(code));
    }

    @GetMapping("/{code}/diagram")
    public R<String> diagram(@PathVariable String code) {
        return R.ok(service.diagramXml(code));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<ProcessDefResponse> create(@Valid @RequestBody ProcessDefRequest req) {
        return R.ok(service.create(req));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<ProcessDefResponse> update(@PathVariable Long id, @Valid @RequestBody ProcessDefRequest req) {
        return R.ok(service.update(id, req));
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<ProcessDefResponse> publish(@PathVariable Long id) {
        return R.ok(service.publish(id));
    }
}
