package com.hentor.oa.workflow.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.workflow.dto.NotifyItem;
import com.hentor.oa.workflow.service.NotifyService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/wf/notifies")
@RequiredArgsConstructor
public class NotifyController {

    private final NotifyService service;

    @GetMapping
    public R<PageResult<NotifyItem>> page(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(service.page(pageNum, pageSize));
    }

    @GetMapping("/unread-count")
    public R<Long> unreadCount() {
        return R.ok(service.unreadCount());
    }

    @PostMapping("/{id}/read")
    public R<Void> read(@PathVariable Long id) {
        service.read(id);
        return R.ok();
    }

    @PostMapping("/read-all")
    public R<Void> readAll() {
        service.readAll();
        return R.ok();
    }
}
