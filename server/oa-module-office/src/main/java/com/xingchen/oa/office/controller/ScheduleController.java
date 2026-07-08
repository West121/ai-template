package com.xingchen.oa.office.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.dto.ScheduleCreateRequest;
import com.xingchen.oa.office.dto.ScheduleResponse;
import com.xingchen.oa.office.service.ScheduleService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 日程（当前用户自己的数据）。
 */
@RestController
@RequestMapping("/api/office/schedules")
@RequiredArgsConstructor
public class ScheduleController {

    private final ScheduleService scheduleService;

    @GetMapping
    public R<List<ScheduleResponse>> month(@RequestParam(required = false) String month) {
        return R.ok(scheduleService.month(month));
    }

    @PostMapping
    public R<ScheduleResponse> create(@Valid @RequestBody ScheduleCreateRequest request) {
        return R.ok(scheduleService.create(request));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        scheduleService.delete(id);
        return R.ok();
    }
}
