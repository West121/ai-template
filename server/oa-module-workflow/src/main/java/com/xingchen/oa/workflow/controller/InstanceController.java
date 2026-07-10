package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.CcItem;
import com.xingchen.oa.workflow.dto.DoneByMeItem;
import com.xingchen.oa.workflow.dto.InstanceDetailResponse;
import com.xingchen.oa.workflow.dto.InstanceListItem;
import com.xingchen.oa.workflow.dto.P2Requests.AppendNodeRequest;
import com.xingchen.oa.workflow.dto.P2Requests.CommentRequest;
import com.xingchen.oa.workflow.dto.P2Requests.DraftRequest;
import com.xingchen.oa.workflow.dto.P2Requests.HandoverRequest;
import com.xingchen.oa.workflow.dto.P2Requests.JumpRequest;
import com.xingchen.oa.workflow.dto.P2Requests.SubmitDraftRequest;
import com.xingchen.oa.workflow.dto.P3Requests.AdhocTaskRequest;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse;
import com.xingchen.oa.workflow.dto.P3Requests.ResurrectRequest;
import com.xingchen.oa.workflow.dto.ResubmitRequest;
import com.xingchen.oa.workflow.dto.StartInstanceRequest;
import com.xingchen.oa.workflow.dto.StartableItem;
import com.xingchen.oa.workflow.service.InstanceService;
import com.xingchen.oa.workflow.service.WfCollaborationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/wf")
@RequiredArgsConstructor
public class InstanceController {

    private final InstanceService service;
    private final WfCollaborationService collaboration;

    @GetMapping("/startable")
    public R<List<StartableItem>> startable() {
        return R.ok(service.startable());
    }

    @PostMapping("/instances")
    public R<InstanceDetailResponse> start(@Valid @RequestBody StartInstanceRequest req) {
        return R.ok(service.start(req));
    }

    @GetMapping("/instances/my")
    public R<PageResult<InstanceListItem>> my(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.my(pageNum, pageSize));
    }

    /** 「已办」列表：我办结的历史任务（缺 wf_instance_ext 行回退 Flowable 历史，绝不 404 整个列表）。 */
    @GetMapping("/instances/done-by-me")
    public R<PageResult<DoneByMeItem>> doneByMe(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.doneByMe(pageNum, pageSize));
    }

    @GetMapping("/instances/admin")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<PageResult<InstanceListItem>> adminList(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.adminList(status, keyword, pageNum, pageSize));
    }

    @GetMapping("/instances/cc")
    public R<PageResult<CcItem>> cc(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.cc(pageNum, pageSize));
    }

    @GetMapping("/instances/{id}")
    public R<InstanceDetailResponse> detail(@PathVariable String id) {
        // 兼容两种定位方式：纯数字=wf_instance_ext.id；否则=流程实例 procInstId(UUID)。
        // 待办/抄送等列表跳转常用 procInstId，不做兼容会因 Long 绑定失败而 500。
        return R.ok(id.matches("\\d+") ? service.detail(Long.valueOf(id)) : service.detailByProcInstId(id));
    }

    @PostMapping("/instances/{id}/cancel")
    public R<InstanceDetailResponse> cancel(@PathVariable Long id) {
        return R.ok(service.cancel(id));
    }

    @PostMapping("/instances/{id}/resubmit")
    public R<InstanceDetailResponse> resubmit(@PathVariable Long id,
                                              @RequestBody(required = false) ResubmitRequest req) {
        return R.ok(service.resubmit(id, req != null ? req.formData() : null));
    }

    @PostMapping("/instances/{id}/jump")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<InstanceDetailResponse> jump(@PathVariable Long id, @Valid @RequestBody JumpRequest req) {
        return R.ok(service.jump(id, req));
    }

    @PostMapping("/instances/{id}/terminate")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<InstanceDetailResponse> terminate(@PathVariable Long id,
                                               @RequestBody(required = false) CommentRequest req) {
        return R.ok(service.terminate(id, req));
    }

    @PostMapping("/instances/{id}/urge")
    public R<Void> urge(@PathVariable Long id, @RequestBody(required = false) CommentRequest req) {
        service.urge(id, req);
        return R.ok();
    }

    @PostMapping("/instances/{id}/append-node")
    public R<Void> appendNode(@PathVariable Long id, @RequestBody AppendNodeRequest req) {
        String pid = service.detail(id).procInstId();
        collaboration.appendNode(pid, req.name(), req.assignees());
        return R.ok();
    }

    /* ---------------- P3 高级能力 ---------------- */

    @PostMapping("/instances/{id}/predict")
    public R<PredictResponse> predict(@PathVariable Long id) {
        return R.ok(service.predict(id));
    }

    @PostMapping("/instances/{id}/resurrect")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<InstanceDetailResponse> resurrect(@PathVariable Long id, @Valid @RequestBody ResurrectRequest req) {
        return R.ok(service.resurrect(id, req));
    }

    /** 动态构建 ad-hoc 任务（不体现在流程图，服务层管理完成条件）。 */
    @PostMapping("/instances/{id}/adhoc-task")
    public R<Void> adhocTask(@PathVariable Long id, @RequestBody AdhocTaskRequest req) {
        String pid = service.detail(id).procInstId();
        collaboration.adhocTask(pid, req.name(), req.assignees());
        return R.ok();
    }

    @PostMapping("/handover")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<Integer> handover(@RequestBody HandoverRequest req) {
        return R.ok(service.handover(req));
    }

    /* ---------------- P2-C 暂存草稿 ---------------- */

    @PostMapping("/instances/draft")
    public R<InstanceListItem> saveDraft(@RequestBody DraftRequest req) {
        return R.ok(service.saveDraft(req));
    }

    @PutMapping("/instances/{id}/draft")
    public R<InstanceListItem> updateDraft(@PathVariable Long id, @RequestBody DraftRequest req) {
        return R.ok(service.updateDraft(id, req));
    }

    @PostMapping("/instances/{id}/submit")
    public R<InstanceDetailResponse> submit(@PathVariable Long id,
                                            @RequestBody(required = false) SubmitDraftRequest req) {
        return R.ok(service.submitDraft(id, req != null ? req.formData() : null));
    }

    @GetMapping("/instances/drafts")
    public R<PageResult<InstanceListItem>> drafts(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.drafts(pageNum, pageSize));
    }
}
