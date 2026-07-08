package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.DelegateRuleItem;
import com.xingchen.oa.workflow.dto.P2Requests.DelegateRuleRequest;
import com.xingchen.oa.workflow.service.DelegateRuleService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/wf/delegate-rules")
@RequiredArgsConstructor
public class DelegateRuleController {

    private final DelegateRuleService service;

    @GetMapping
    public R<List<DelegateRuleItem>> list() {
        return R.ok(service.list());
    }

    @PostMapping
    public R<DelegateRuleItem> create(@RequestBody DelegateRuleRequest req) {
        return R.ok(service.create(req));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }
}
