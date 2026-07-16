package com.hentor.oa.office.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.office.dto.MeetingCreateRequest;
import com.hentor.oa.office.dto.MeetingResponse;
import com.hentor.oa.office.dto.MeetingRoomResponse;
import com.hentor.oa.office.service.MeetingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/office")
@RequiredArgsConstructor
public class MeetingController {

    private final MeetingService meetingService;

    /**
     * 会议室列表 + 指定日期（默认今天）的预订时段。
     */
    @GetMapping("/meeting-rooms")
    public R<List<MeetingRoomResponse>> rooms(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return R.ok(meetingService.rooms(date));
    }

    /**
     * 预订会议：时段冲突 → 409。
     */
    @PostMapping("/meetings")
    public R<MeetingResponse> create(@Valid @RequestBody MeetingCreateRequest request) {
        return R.ok(meetingService.create(request));
    }

    /**
     * 我的会议（我组织的 / 我参加的）。
     */
    @GetMapping("/meetings/my")
    public R<PageResult<MeetingResponse>> my(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(meetingService.my(pageNum, pageSize));
    }

    /**
     * 取消会议：仅组织者且未开始。
     */
    @PostMapping("/meetings/{id}/cancel")
    public R<MeetingResponse> cancel(@PathVariable Long id) {
        return R.ok(meetingService.cancel(id));
    }
}
