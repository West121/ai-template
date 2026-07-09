package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.GraphDeployRequest;
import com.xingchen.oa.workflow.dto.GraphDeployResponse;
import com.xingchen.oa.workflow.service.ProcessDefService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 归一化图模型（ProcessModel）入口（切片 2a）。与旧 dingtalk/bpmn 路径（{@code /api/wf/process-defs}）并存，
 * 走 {@code GraphToBpmnConverter} 图直译。后续 .bpmn 导入导出（{@code /import}、{@code /{id}/bpmn}）亦挂此基址。
 */
@RestController
@RequestMapping("/api/wf/models")
@RequiredArgsConstructor
public class WfModelController {

    private final ProcessDefService service;

    /** 图直译一站式部署：ProcessModel JSON → BpmnModel → Flowable 部署 + wf_process_ext 落库。 */
    @PostMapping("/graph/deploy")
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<GraphDeployResponse> deployGraph(@Valid @RequestBody GraphDeployRequest req) {
        return R.ok(service.deployGraph(req));
    }
}
