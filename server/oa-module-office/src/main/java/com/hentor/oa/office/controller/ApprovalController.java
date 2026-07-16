package com.hentor.oa.office.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import com.hentor.oa.office.dto.ApprovalActionRequest;
import com.hentor.oa.office.dto.ApprovalCcResponse;
import com.hentor.oa.office.dto.ApprovalCreateRequest;
import com.hentor.oa.office.dto.ApprovalDoneResponse;
import com.hentor.oa.office.dto.ApprovalLogResponse;
import com.hentor.oa.office.dto.ApprovalResponse;
import com.hentor.oa.office.service.ApprovalService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/office/approvals")
@RequiredArgsConstructor
public class ApprovalController {

    private final ApprovalService approvalService;

    @GetMapping
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<PageResult<ApprovalResponse>> page(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(approvalService.page(status, pageNum, pageSize));
    }

    /**
     * 待办数量（数据权限内 status = PENDING 的单量）。
     */
    @GetMapping("/pending-count")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<Long> pendingCount() {
        return R.ok(approvalService.pendingCount());
    }

    /**
     * 我发起的（applicant_id = 当前用户，不走数据权限）。
     */
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<PageResult<ApprovalResponse>> my(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(approvalService.my(status, pageNum, pageSize));
    }

    /**
     * 我处理过的（依据操作日志）。
     */
    @GetMapping("/done")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<PageResult<ApprovalDoneResponse>> done(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(approvalService.done(pageNum, pageSize));
    }

    /**
     * 抄送我的。
     */
    @GetMapping("/cc")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<PageResult<ApprovalCcResponse>> cc(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(approvalService.cc(pageNum, pageSize));
    }

    @PostMapping("/cc/{approvalId}/read")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<Void> markCcRead(@PathVariable Long approvalId) {
        approvalService.markCcRead(approvalId);
        return R.ok();
    }

    @PostMapping("/cc/read-all")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<Void> markAllCcRead() {
        approvalService.markAllCcRead();
        return R.ok();
    }

    @PostMapping
    @PreAuthorize("hasAuthority('office:approval:create')")
    @OperLog(module = "审批", action = "创建")
    public R<ApprovalResponse> create(@Valid @RequestBody ApprovalCreateRequest request) {
        return R.ok(approvalService.create(request));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('office:approval:approve')")
    @OperLog(module = "审批", action = "同意")
    public R<ApprovalResponse> approve(@PathVariable Long id,
                                       @RequestBody(required = false) ApprovalActionRequest request) {
        return R.ok(approvalService.approve(id, request != null ? request.comment() : null));
    }

    @PostMapping("/{id}/reject")
    @PreAuthorize("hasAuthority('office:approval:approve')")
    @OperLog(module = "审批", action = "驳回")
    public R<ApprovalResponse> reject(@PathVariable Long id,
                                      @RequestBody(required = false) ApprovalActionRequest request) {
        return R.ok(approvalService.reject(id, request != null ? request.reason() : null));
    }

    /**
     * 撤回：仅本人且 PENDING。
     */
    @PostMapping("/{id}/withdraw")
    @PreAuthorize("hasAuthority('office:approval:create')")
    @OperLog(module = "审批", action = "撤回")
    public R<ApprovalResponse> withdraw(@PathVariable Long id) {
        return R.ok(approvalService.withdraw(id));
    }

    /**
     * 流转记录（B-05 越权修复）：service 内做归属校验，
     * 仅发起人 / 审批人 / 抄送人 / 数据权限可见者可读，无关用户 403。
     */
    @GetMapping("/{id}/logs")
    @PreAuthorize("hasAuthority('office:approval:list')")
    public R<List<ApprovalLogResponse>> logs(@PathVariable Long id) {
        return R.ok(approvalService.logs(id));
    }
}
