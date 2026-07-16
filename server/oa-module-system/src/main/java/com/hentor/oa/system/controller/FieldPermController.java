package com.hentor.oa.system.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import com.hentor.oa.system.fieldperm.FieldPermItem;
import com.hentor.oa.system.fieldperm.FieldPermService;
import com.hentor.oa.system.fieldperm.FieldPermState;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 角色×功能 字段权限（P3，V52）。配置沿用 system:role:edit（无新权限码）；
 * mine 端点登录即可（自己的合并权限，前端渲染消费）。
 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class FieldPermController {

    private final FieldPermService service;

    /** 角色配置：feature 缺省=该角色全部行。 */
    @GetMapping("/roles/{id}/field-perms")
    public R<List<FieldPermItem>> roleConfig(@PathVariable Long id,
                                             @RequestParam(required = false) String feature) {
        return R.ok(service.roleConfig(id, feature));
    }

    /** 按 feature 全量替换（body=[{field,visible,editable}]，item.feature 忽略以 query 为准）。 */
    @PutMapping("/roles/{id}/field-perms")
    @PreAuthorize("hasAuthority('system:role:edit')")
    @OperLog(module = "角色", action = "配置字段权限")
    public R<Void> saveRoleConfig(@PathVariable Long id, @RequestParam String feature,
                                  @RequestBody List<FieldPermItem> items) {
        service.saveRoleConfig(id, feature, items);
        return R.ok();
    }

    /** 当前用户合并字段权限（多角色并集放宽；未配置任何行=空对象=全可见全可编）。 */
    @GetMapping("/field-perms/mine")
    public R<Map<String, Object>> mine(@RequestParam String feature) {
        Map<String, FieldPermState> fields = service.resolveForCurrentUser(feature);
        return R.ok(Map.of("fields", fields));
    }
}
