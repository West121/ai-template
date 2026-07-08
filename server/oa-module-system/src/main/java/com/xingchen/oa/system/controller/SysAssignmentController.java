package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.system.service.SysUserService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 任职删除（主任职不可删）。
 */
@RestController
@RequestMapping("/api/system/assignments")
@RequiredArgsConstructor
public class SysAssignmentController {

    private final SysUserService userService;

    @DeleteMapping("/{aid}")
    @PreAuthorize("hasAuthority('system:user:edit')")
    public R<Void> delete(@PathVariable Long aid) {
        userService.deleteAssignment(aid);
        return R.ok();
    }
}
