package com.xingchen.oa.workflow.orch.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.CredentialRequest;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.CredentialResponse;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.EnableRequest;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.ExecDetailResponse;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.ExecResponse;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.FlowRequest;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.FlowResponse;
import com.xingchen.oa.workflow.orch.entity.OrchExec;
import com.xingchen.oa.workflow.orch.service.OrchCredentialService;
import com.xingchen.oa.workflow.orch.service.OrchExecService;
import com.xingchen.oa.workflow.orch.service.OrchFlowService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 自动化编排 API（/api/orch/*，契约 §3.6）。权限：orch:flow:read / write（受信）/ run。
 */
@RestController
@RequestMapping("/api/orch")
@RequiredArgsConstructor
public class OrchController {

    private final OrchFlowService flowService;
    private final OrchExecService execService;
    private final OrchCredentialService credentialService;

    // ---------- 编排定义 ----------

    @GetMapping("/flows")
    @PreAuthorize("hasAuthority('orch:flow:read')")
    public R<PageResult<FlowResponse>> flows(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(flowService.page(keyword, pageNum, pageSize));
    }

    /** 详情：{key} 纯数字=id，否则=code（设计器路由 :code）。列表/详情均含 id+code+webhookToken。 */
    @GetMapping("/flows/{key}")
    @PreAuthorize("hasAuthority('orch:flow:read')")
    public R<FlowResponse> get(@PathVariable String key) {
        return R.ok(flowService.get(key));
    }

    @PostMapping("/flows")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<FlowResponse> create(@RequestBody FlowRequest req) {
        return R.ok(flowService.create(req));
    }

    @PutMapping("/flows/{id}")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<FlowResponse> update(@PathVariable Long id, @RequestBody FlowRequest req) {
        return R.ok(flowService.update(id, req));
    }

    @DeleteMapping("/flows/{id}")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<Void> delete(@PathVariable Long id) {
        flowService.delete(id);
        return R.ok();
    }

    /** 发布：编译校验 + el_expr 缓存 + version+1。编译报错以 400 返回给设计器。 */
    @PostMapping("/flows/{id}/publish")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<FlowResponse> publish(@PathVariable Long id) {
        return R.ok(flowService.publish(id));
    }

    /** 启停：body {enabled}；空 body / 缺字段按 enabled=true（幂等友好，不 500）。 */
    @PostMapping("/flows/{id}/enable")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<FlowResponse> enable(@PathVariable Long id, @RequestBody(required = false) EnableRequest req) {
        boolean enabled = req == null || req.enabled() == null || req.enabled();
        return R.ok(flowService.enable(id, enabled));
    }

    @PostMapping("/flows/{id}/hook-token/reset")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<FlowResponse> resetHookToken(@PathVariable Long id) {
        return R.ok(flowService.resetHookToken(id));
    }

    /** 手动触发：body 即 payload（任意 JSON 对象）。返回 {execId}。 */
    @PostMapping("/flows/{id}/run")
    @PreAuthorize("hasAuthority('orch:flow:run')")
    public R<Map<String, Object>> run(@PathVariable Long id,
                                      @RequestBody(required = false) Map<String, Object> payload) {
        Long execId = execService.run(id, payload == null ? new LinkedHashMap<>() : payload, OrchExec.KIND_MANUAL);
        return R.ok(Map.of("execId", execId));
    }

    // ---------- 执行流水 ----------

    @GetMapping("/execs")
    @PreAuthorize("hasAuthority('orch:flow:read')")
    public R<PageResult<ExecResponse>> execs(
            @RequestParam(required = false) Long flowId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(execService.page(flowId, status, pageNum, pageSize));
    }

    @GetMapping("/execs/{id}")
    @PreAuthorize("hasAuthority('orch:flow:read')")
    public R<ExecDetailResponse> execDetail(@PathVariable Long id) {
        return R.ok(execService.detail(id));
    }

    @PostMapping("/execs/{id}/rerun")
    @PreAuthorize("hasAuthority('orch:flow:run')")
    public R<Map<String, Object>> rerun(@PathVariable Long id) {
        return R.ok(Map.of("execId", execService.rerun(id)));
    }

    // ---------- 凭据 ----------

    @GetMapping("/credentials")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<List<CredentialResponse>> credentials() {
        return R.ok(credentialService.list());
    }

    @PostMapping("/credentials")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<CredentialResponse> createCredential(@RequestBody CredentialRequest req) {
        return R.ok(credentialService.create(req));
    }

    @PutMapping("/credentials/{id}")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<CredentialResponse> updateCredential(@PathVariable Long id, @RequestBody CredentialRequest req) {
        return R.ok(credentialService.update(id, req));
    }

    @DeleteMapping("/credentials/{id}")
    @PreAuthorize("hasAuthority('orch:flow:write')")
    public R<Void> deleteCredential(@PathVariable Long id) {
        credentialService.delete(id);
        return R.ok();
    }
}
