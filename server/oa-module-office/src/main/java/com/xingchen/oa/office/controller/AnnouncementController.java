package com.xingchen.oa.office.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.office.dto.AnnouncementCreateRequest;
import com.xingchen.oa.office.dto.AnnouncementResponse;
import com.xingchen.oa.office.service.AnnouncementService;
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

/**
 * 公告（全员可见）。
 */
@RestController
@RequestMapping("/api/office/announcements")
@RequiredArgsConstructor
public class AnnouncementController {

    private final AnnouncementService announcementService;

    @GetMapping
    public R<PageResult<AnnouncementResponse>> page(
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(announcementService.page(category, pageNum, pageSize));
    }

    @GetMapping("/unread-count")
    public R<Long> unreadCount() {
        return R.ok(announcementService.unreadCount());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('office:announcement:publish')")
    @OperLog(module = "公告", action = "发布")
    public R<AnnouncementResponse> create(@Valid @RequestBody AnnouncementCreateRequest request) {
        return R.ok(announcementService.create(request));
    }

    /**
     * 标记已读：幂等，仅首次 reads + 1。
     */
    @PostMapping("/{id}/read")
    public R<Void> read(@PathVariable Long id) {
        announcementService.read(id);
        return R.ok();
    }
}
