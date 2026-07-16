package com.hentor.oa.office.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.office.dto.LeaveCreateRequest;
import com.hentor.oa.office.dto.LeaveQuotaResponse;
import com.hentor.oa.office.dto.LeaveResponse;
import com.hentor.oa.office.service.LeaveService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/office/leaves")
@RequiredArgsConstructor
public class LeaveController {

    private final LeaveService leaveService;

    @GetMapping
    public R<PageResult<LeaveResponse>> page(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(leaveService.page(pageNum, pageSize));
    }

    /**
     * 我的假期额度。
     */
    @GetMapping("/quotas")
    public R<List<LeaveQuotaResponse>> quotas() {
        return R.ok(leaveService.quotas());
    }

    @PostMapping
    public R<LeaveResponse> create(@Valid @RequestBody LeaveCreateRequest request) {
        return R.ok(leaveService.create(request));
    }

    @PostMapping("/{id}/withdraw")
    public R<LeaveResponse> withdraw(@PathVariable Long id) {
        return R.ok(leaveService.withdraw(id));
    }
}
