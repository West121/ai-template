package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.P3Requests.SealItem;
import com.xingchen.oa.workflow.dto.P3Requests.SealRequest;
import com.xingchen.oa.workflow.service.SealService;
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

/** 电子章管理（P3）：读登录即可；增/改/删需【wf:def:edit】。 */
@RestController
@RequestMapping("/api/wf/seals")
@RequiredArgsConstructor
public class SealController {

    private final SealService service;

    @GetMapping
    public R<List<SealItem>> list() {
        return R.ok(service.list());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<SealItem> create(@RequestBody SealRequest req) {
        return R.ok(service.create(req));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<SealItem> update(@PathVariable Long id, @RequestBody SealRequest req) {
        return R.ok(service.update(id, req));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }
}
