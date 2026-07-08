package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.BottleneckItem;
import com.xingchen.oa.workflow.dto.MonitorOverview;
import com.xingchen.oa.workflow.service.MonitorService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 流程监控（管理员视角，wf:instance:admin）。 */
@RestController
@RequestMapping("/api/wf/monitor")
@RequiredArgsConstructor
public class MonitorController {

    private final MonitorService service;

    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<MonitorOverview> overview() {
        return R.ok(service.overview());
    }

    @GetMapping("/bottleneck")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<List<BottleneckItem>> bottleneck() {
        return R.ok(service.bottleneck());
    }
}
