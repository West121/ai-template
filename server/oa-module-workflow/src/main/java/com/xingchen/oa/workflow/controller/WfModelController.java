package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.BpmnImportResult;
import com.xingchen.oa.workflow.dto.GraphDeployRequest;
import com.xingchen.oa.workflow.dto.GraphDeployResponse;
import com.xingchen.oa.workflow.service.ProcessDefService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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

    /**
     * 导出 {@code .bpmn} XML（N-B-02 附录 B「.bpmn 往返」）。返回该流程定义存档的 {@code bpmn_xml}
     *（GRAPH 老数据仅存 designer_json 时现转），包在 {@code R<String>} 里，与现有
     * {@code GET /api/wf/process-defs/{code}/diagram} 一致。权限与现有定义查看一致（登录即可）。
     */
    @GetMapping("/{id}/bpmn")
    public R<String> exportBpmn(@PathVariable Long id) {
        return R.ok(service.exportBpmn(id));
    }

    /**
     * 导入 {@code .bpmn} XML → 归一化 {@link com.xingchen.oa.workflow.convert.graph.ProcessModel}（N-B-02）。
     * 请求体为原始 {@code .bpmn} XML（{@code Content-Type: application/xml | text/xml | text/plain}）。
     * 仅还原供前端载入编辑，<b>不落库、不部署</b>；结果 warnings 承载未完全还原/缺 DI 提示。
     */
    @PostMapping(value = "/import",
            consumes = {MediaType.APPLICATION_XML_VALUE, MediaType.TEXT_XML_VALUE, MediaType.TEXT_PLAIN_VALUE})
    @PreAuthorize("hasAuthority('wf:def:edit')")
    public R<BpmnImportResult> importBpmn(@RequestBody String xml) {
        return R.ok(service.importBpmn(xml));
    }
}
