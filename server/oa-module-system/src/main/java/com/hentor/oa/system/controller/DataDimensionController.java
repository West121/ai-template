package com.hentor.oa.system.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.common.log.OperLog;
import com.hentor.oa.system.datadim.BindableEntityProvider;
import com.hentor.oa.system.datadim.DataDimensionService;
import com.hentor.oa.system.datadim.DimensionConfigItem;
import com.hentor.oa.system.datadim.DimensionInfo;
import com.hentor.oa.system.datadim.DimensionOption;
import com.hentor.oa.system.datadim.DimensionOptionRequest;
import com.hentor.oa.system.datadim.DimensionOptionRow;
import com.hentor.oa.system.datadim.DimensionUpsertRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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

    /** 列表：缺省仅启用（授权 UI 兼容）；all=1 含停用（管理页）。V51 起项含 valueSource/dictType/bindings。 */
    @GetMapping("/data-dimensions")
    public R<List<DimensionInfo>> dimensions(@RequestParam(required = false) Boolean all) {
        return R.ok(service.listDimensions(Boolean.TRUE.equals(all)));
    }

    /** 可绑列目录（V51 绑定白名单，SPI 聚合）：[{entity,label,columns:[{column,label}]}]。 */
    @GetMapping("/data-dimensions/bindable-entities")
    public R<List<BindableEntityProvider.BindableEntity>> bindableEntities() {
        return R.ok(service.bindableEntities());
    }

    // ==================== V51 维度 CRUD【system:dim:manage】 ====================

    @PostMapping("/data-dimensions")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    @OperLog(module = "数据维度", action = "新建维度")
    public R<DimensionInfo> createDimension(@RequestBody DimensionUpsertRequest req) {
        return R.ok(service.createDimension(req));
    }

    @PutMapping("/data-dimensions/{code}")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    @OperLog(module = "数据维度", action = "编辑维度")
    public R<DimensionInfo> updateDimension(@PathVariable String code, @RequestBody DimensionUpsertRequest req) {
        return R.ok(service.updateDimension(code, req));
    }

    /** 软删（enabled=false）；被授权引用 → 409。 */
    @DeleteMapping("/data-dimensions/{code}")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    @OperLog(module = "数据维度", action = "停用维度")
    public R<Void> deleteDimension(@PathVariable String code) {
        service.deleteDimension(code);
        return R.ok();
    }

    // ==================== options（授权侧）+ 选项 CRUD（OPTION 源，管理侧） ====================

    /** 授权侧 options（{id=授权值,label}，仅启用；专用/OPTION/DICT/DEPT 统一形状）。 */
    @GetMapping("/data-dimensions/{code}/options")
    public R<List<DimensionOption>> options(@PathVariable String code) {
        return R.ok(service.options(code));
    }

    /** 管理侧选项行（含禁用；id=行主键，编辑/删除用）。 */
    @GetMapping("/data-dimensions/{code}/option-items")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    public R<List<DimensionOptionRow>> optionRows(@PathVariable String code) {
        return R.ok(service.optionRows(code));
    }

    @PostMapping("/data-dimensions/{code}/options")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    @OperLog(module = "数据维度", action = "新建选项")
    public R<DimensionOptionRow> addOption(@PathVariable String code, @RequestBody DimensionOptionRequest req) {
        return R.ok(service.addOption(code, req));
    }

    @PutMapping("/data-dimensions/{code}/options/{id}")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    @OperLog(module = "数据维度", action = "编辑选项")
    public R<DimensionOptionRow> updateOption(@PathVariable String code, @PathVariable Long id,
                                              @RequestBody DimensionOptionRequest req) {
        return R.ok(service.updateOption(code, id, req));
    }

    @DeleteMapping("/data-dimensions/{code}/options/{id}")
    @PreAuthorize("hasAuthority('system:dim:manage')")
    @OperLog(module = "数据维度", action = "删除选项")
    public R<Void> deleteOption(@PathVariable String code, @PathVariable Long id) {
        service.deleteOption(code, id);
        return R.ok();
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
