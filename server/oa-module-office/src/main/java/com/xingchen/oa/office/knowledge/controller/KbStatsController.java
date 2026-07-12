package com.xingchen.oa.office.knowledge.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.knowledge.dto.KbDtos.KbStats;
import com.xingchen.oa.office.knowledge.service.KbSpaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 知识库统计概览（ai-knowledge-base.md §7 批5 集成收尾）。
 * <b>严格按当前用户可见空间口径</b>统计（服务层复用 KbAccess，红线：不含不可见空间）；只读，无副作用。
 */
@RestController
@RequestMapping("/api/kb/stats")
@RequiredArgsConstructor
public class KbStatsController {

    private final KbSpaceService spaceService;

    @GetMapping
    @PreAuthorize("hasAuthority('kb:space:view')")
    public R<KbStats> stats() {
        return R.ok(spaceService.stats());
    }
}
