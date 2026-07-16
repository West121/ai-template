package com.hentor.oa.system.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import com.hentor.oa.system.datadim.DataDimensionService;
import com.hentor.oa.system.datadim.DimensionConfigItem;
import com.hentor.oa.system.datadim.DimensionInfo;
import com.hentor.oa.system.datadim.DimensionOption;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 多维数据权限（DP1）：维度注册/options + 角色/用户维度授权读写。
 * 契约（疾风前端已用，字段名钉死）：
 * <ul>
 *   <li>GET /api/system/data-dimensions → [{code,label,entity?,enabled}]（已注册业务维度，不含内建 dept/self）</li>
 *   <li>GET /api/system/data-dimensions/{code}/options → [{id,label}]（该维 CUSTOM 可选值，泛化端点）</li>
 *   <li>GET|PUT /api/system/roles|users/{id}/data-dimensions → [{dimension,scope,values:number[]}]（PUT 全量替换）</li>
 * </ul>
 * 查询仅要求登录；写操作按角色/用户复用 system:role:edit / system:user:edit。
 */
@RestController
@RequestMapping("/api/system")
@RequiredArgsConstructor
public class DataDimensionController {

    private final DataDimensionService service;

    @GetMapping("/data-dimensions")
    public R<List<DimensionInfo>> dimensions() {
        return R.ok(service.listDimensions());
    }

    @GetMapping("/data-dimensions/{code}/options")
    public R<List<DimensionOption>> options(@PathVariable String code) {
        return R.ok(service.options(code));
    }

    @GetMapping("/roles/{id}/data-dimensions")
    public R<List<DimensionConfigItem>> roleDimensions(@PathVariable Long id) {
        return R.ok(service.roleConfig(id));
    }

    @PutMapping("/roles/{id}/data-dimensions")
    @PreAuthorize("hasAuthority('system:role:edit')")
    @OperLog(module = "角色", action = "配置数据维度")
    public R<Void> saveRoleDimensions(@PathVariable Long id, @RequestBody List<DimensionConfigItem> items) {
        service.saveRoleConfig(id, items);
        return R.ok();
    }

    @GetMapping("/users/{id}/data-dimensions")
    public R<List<DimensionConfigItem>> userDimensions(@PathVariable Long id) {
        return R.ok(service.userConfig(id));
    }

    @PutMapping("/users/{id}/data-dimensions")
    @PreAuthorize("hasAuthority('system:user:edit')")
    @OperLog(module = "用户", action = "配置数据维度")
    public R<Void> saveUserDimensions(@PathVariable Long id, @RequestBody List<DimensionConfigItem> items) {
        service.saveUserConfig(id, items);
        return R.ok();
    }
}
