package com.xingchen.oa.infra.controller;

import com.xingchen.oa.common.core.BatchResult;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.infra.dto.BatchIdsRequest;
import com.xingchen.oa.infra.dto.DictItemNode;
import com.xingchen.oa.infra.dto.DictItemRequest;
import com.xingchen.oa.infra.dto.DictTypeRequest;
import com.xingchen.oa.infra.dto.DictTypeResponse;
import com.xingchen.oa.infra.service.DictService;
import jakarta.validation.Valid;
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
 * 字典管理：类型 CRUD + 树形字典项 + 业务取值（options）。
 * 查询仅要求登录，写操作需 system:dict:edit。
 */
@RestController
@RequestMapping("/api/infra/dict")
@RequiredArgsConstructor
public class DictController {

    private final DictService dictService;

    // ---------- 字典类型 ----------

    @GetMapping("/types")
    public R<PageResult<DictTypeResponse>> pageTypes(
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(dictService.pageTypes(keyword, pageNum, pageSize));
    }

    @PostMapping("/types")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "创建类型")
    public R<DictTypeResponse> createType(@Valid @RequestBody DictTypeRequest request) {
        return R.ok(dictService.createType(request));
    }

    @PutMapping("/types/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "修改类型")
    public R<DictTypeResponse> updateType(@PathVariable Long id, @Valid @RequestBody DictTypeRequest request) {
        return R.ok(dictService.updateType(id, request));
    }

    @DeleteMapping("/types/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "删除类型")
    public R<Void> deleteType(@PathVariable Long id) {
        dictService.deleteType(id);
        return R.ok();
    }

    @PostMapping("/types/batch-delete")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "批量删除类型")
    public R<BatchResult> batchDeleteTypes(@Valid @RequestBody BatchIdsRequest request) {
        return R.ok(dictService.batchDeleteTypes(request.ids()));
    }

    // ---------- 字典项（树形） ----------

    @GetMapping("/types/{typeId}/items")
    public R<List<DictItemNode>> itemTree(@PathVariable Long typeId) {
        return R.ok(dictService.itemTree(typeId));
    }

    @PostMapping("/items")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "创建字典项")
    public R<DictItemNode> createItem(@Valid @RequestBody DictItemRequest request) {
        return R.ok(dictService.createItem(request));
    }

    @PutMapping("/items/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "修改字典项")
    public R<DictItemNode> updateItem(@PathVariable Long id, @Valid @RequestBody DictItemRequest request) {
        return R.ok(dictService.updateItem(id, request));
    }

    @DeleteMapping("/items/{id}")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "删除字典项")
    public R<Void> deleteItem(@PathVariable Long id) {
        dictService.deleteItem(id);
        return R.ok();
    }

    @PostMapping("/items/batch-delete")
    @PreAuthorize("hasAuthority('system:dict:edit')")
    @OperLog(module = "字典", action = "批量删除字典项")
    public R<BatchResult> batchDeleteItems(@Valid @RequestBody BatchIdsRequest request) {
        return R.ok(dictService.batchDeleteItems(request.ids()));
    }

    // ---------- 业务取值（登录即可） ----------

    @GetMapping("/{code}/options")
    public R<List<DictItemNode>> options(@PathVariable String code) {
        return R.ok(dictService.optionsByCode(code));
    }
}
