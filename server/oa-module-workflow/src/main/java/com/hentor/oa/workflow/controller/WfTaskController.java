package com.hentor.oa.workflow.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.workflow.dto.P2Requests.AddSignRequest;
import com.hentor.oa.workflow.dto.P2Requests.AssigneeRequest;
import com.hentor.oa.workflow.dto.P2Requests.AssistRequest;
import com.hentor.oa.workflow.dto.P2Requests.CommentRequest;
import com.hentor.oa.workflow.dto.P2Requests.CommunicateRequest;
import com.hentor.oa.workflow.dto.P2Requests.CounterSignRequest;
import com.hentor.oa.workflow.dto.P2Requests.ReduceSignRequest;
import com.hentor.oa.workflow.dto.P2Requests.RetrieveRequest;
import com.hentor.oa.workflow.dto.RejectRequest;
import com.hentor.oa.workflow.dto.TaskActionRequest;
import com.hentor.oa.workflow.dto.TaskItem;
import com.hentor.oa.workflow.service.WfCollaborationService;
import com.hentor.oa.workflow.service.WfTaskService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/wf/tasks")
@RequiredArgsConstructor
public class WfTaskController {

    private final WfTaskService service;
    private final WfCollaborationService collaboration;

    @GetMapping("/todo")
    public R<PageResult<TaskItem>> todo(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.todo(keyword, pageNum, pageSize));
    }

    @GetMapping("/done")
    public R<PageResult<TaskItem>> done(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.done(pageNum, pageSize));
    }

    @PostMapping("/{id}/approve")
    public R<Void> approve(@PathVariable String id,
                           @RequestBody(required = false) TaskActionRequest req) {
        service.approve(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/reject")
    public R<Void> reject(@PathVariable String id, @Valid @RequestBody RejectRequest req) {
        service.reject(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/add-sign")
    public R<Void> addSign(@PathVariable String id, @RequestBody AddSignRequest req) {
        service.addSign(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/counter-sign")
    public R<Void> counterSign(@PathVariable String id, @RequestBody CounterSignRequest req) {
        service.counterSign(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/reduce-sign")
    public R<Void> reduceSign(@PathVariable String id, @RequestBody ReduceSignRequest req) {
        service.reduceSign(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/transfer")
    public R<Void> transfer(@PathVariable String id, @RequestBody AssigneeRequest req) {
        service.transfer(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/delegate")
    public R<Void> delegate(@PathVariable String id, @RequestBody AssigneeRequest req) {
        service.delegate(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/retrieve")
    public R<Void> retrieve(@PathVariable String id, @RequestBody(required = false) RetrieveRequest req) {
        service.retrieve(id, req);
        return R.ok();
    }

    /* ---------------- P2 批次2：协作 ---------------- */

    @PostMapping("/{id}/assist")
    public R<Void> assist(@PathVariable String id, @RequestBody AssistRequest req) {
        collaboration.assist(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/complete-adhoc")
    public R<Void> completeAdhoc(@PathVariable String id, @RequestBody(required = false) CommentRequest req) {
        collaboration.completeAdhoc(id, req != null ? req.comment() : null);
        return R.ok();
    }

    @PostMapping("/{id}/communicate")
    public R<Void> communicate(@PathVariable String id, @RequestBody CommunicateRequest req) {
        collaboration.communicate(id, req);
        return R.ok();
    }

    @PostMapping("/{id}/read")
    public R<Void> read(@PathVariable String id) {
        collaboration.read(id);
        return R.ok();
    }

    @PostMapping("/{id}/claim")
    public R<Void> claim(@PathVariable String id) {
        collaboration.claim(id);
        return R.ok();
    }

    @PostMapping("/{id}/unclaim")
    public R<Void> unclaim(@PathVariable String id) {
        collaboration.unclaim(id);
        return R.ok();
    }
}
