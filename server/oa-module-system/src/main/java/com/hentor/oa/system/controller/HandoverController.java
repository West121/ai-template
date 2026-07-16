package com.hentor.oa.system.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import com.hentor.oa.system.handover.HandoverDtos.ExecResult;
import com.hentor.oa.system.handover.HandoverDtos.HandoverView;
import com.hentor.oa.system.handover.HandoverDtos.ItemUpdateRequest;
import com.hentor.oa.system.handover.HandoverDtos.ResignRequest;
import com.hentor.oa.system.handover.HandoverService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 离职 offboarding + 交接治理（DP2）。写操作需 system:user:edit；交接单查看仅要求登录。
 * <ul>
 *   <li>POST /api/system/users/{id}/resign {successorId,reason,resignDate} → {handoverId}
 *       （校验：部门负责人未指定继任→阻断；置离职：禁登录+token 失效+数据权限即时失效）</li>
 *   <li>GET /api/system/handovers/{id} → 交接单 + items（item_type/ref/old→new/status）</li>
 *   <li>PUT /api/system/handovers/{id}/items/{itemId} {successorId?/status:SKIPPED} 逐项调整</li>
 *   <li>POST /api/system/handovers/{id}/execute → {doneIds, failed:[{itemId,reason}]}（item 级、可重试）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class HandoverController {

    private final HandoverService handoverService;

    @PostMapping("/users/{id}/resign")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "离职")
    public R<Map<String, Object>> resign(@PathVariable Long id, @RequestBody(required = false) ResignRequest request) {
        Long handoverId = handoverService.resign(id, request);
        return R.ok(Map.of("handoverId", handoverId));
    }

    @GetMapping("/handovers/{id}")
    public R<HandoverView> get(@PathVariable Long id) {
        return R.ok(handoverService.get(id));
    }

    @PutMapping("/handovers/{id}/items/{itemId}")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "交接", action = "调整交接项")
    public R<Void> updateItem(@PathVariable Long id, @PathVariable Long itemId,
                              @RequestBody(required = false) ItemUpdateRequest request) {
        handoverService.updateItem(id, itemId, request);
        return R.ok();
    }

    @PostMapping("/handovers/{id}/execute")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "交接", action = "执行交接")
    public R<ExecResult> execute(@PathVariable Long id) {
        return R.ok(handoverService.execute(id));
    }
}
