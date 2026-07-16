package com.hentor.oa.office.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.office.dto.DashboardResponse;
import com.hentor.oa.office.service.DashboardService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 工作台聚合。
 */
@RestController
@RequestMapping("/api/office/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping
    public R<DashboardResponse> dashboard() {
        return R.ok(dashboardService.build());
    }
}
