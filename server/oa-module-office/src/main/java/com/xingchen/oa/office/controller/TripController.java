package com.xingchen.oa.office.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.dto.TripCreateRequest;
import com.xingchen.oa.office.dto.TripResponse;
import com.xingchen.oa.office.service.TripService;
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
@RequestMapping("/api/office/trips")
@RequiredArgsConstructor
public class TripController {

    private final TripService tripService;

    @GetMapping
    public R<PageResult<TripResponse>> page(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(tripService.page(pageNum, pageSize));
    }

    @PostMapping
    public R<TripResponse> create(@Valid @RequestBody TripCreateRequest request) {
        return R.ok(tripService.create(request));
    }

    @PostMapping("/{id}/withdraw")
    public R<TripResponse> withdraw(@PathVariable Long id) {
        return R.ok(tripService.withdraw(id));
    }
}
