package com.xingchen.oa.office.controller;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DefRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DefResponse;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DocDetail;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DocItem;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DocRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintData;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintTplRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintTplResponse;
import com.xingchen.oa.office.service.BizDocDefService;
import com.xingchen.oa.office.service.BizDocService;
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
 * 单据管理 API（BizDoc §3，前缀 /api/bizdoc）。
 * 权限：定义/模板管理 bizdoc:def:write；运行时读 bizdoc:read、写 bizdoc:write。
 */
@RestController
@RequestMapping("/api/bizdoc")
@RequiredArgsConstructor
public class BizDocController {

    private final BizDocDefService defService;
    private final BizDocService docService;

    // ---------- 定义管理 ----------

    @GetMapping("/defs")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<PageResult<DefResponse>> defs(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(defService.page(keyword, status, pageNum, pageSize));
    }

    /** 运行时入口卡片：已发布定义列表。 */
    @GetMapping("/defs/published")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<List<DefResponse>> published() {
        return R.ok(defService.published());
    }

    /** {key} 纯数字=id 否则=code。 */
    @GetMapping("/defs/{key}")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<DefResponse> def(@PathVariable String key) {
        return R.ok(defService.get(key));
    }

    @PostMapping("/defs")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<DefResponse> createDef(@RequestBody DefRequest req) {
        return R.ok(defService.create(req));
    }

    @PutMapping("/defs/{id}")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<DefResponse> updateDef(@PathVariable Long id, @RequestBody DefRequest req) {
        return R.ok(defService.update(id, req));
    }

    @DeleteMapping("/defs/{id}")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<Void> deleteDef(@PathVariable Long id) {
        defService.delete(id);
        return R.ok();
    }

    @PostMapping("/defs/{id}/publish")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<DefResponse> publish(@PathVariable Long id) {
        return R.ok(defService.publish(id));
    }

    @PostMapping("/defs/{id}/disable")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<DefResponse> disable(@PathVariable Long id) {
        return R.ok(defService.disable(id));
    }

    // ---------- 打印模板 ----------

    @GetMapping("/defs/{defId}/print-tpls")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<List<PrintTplResponse>> tpls(@PathVariable Long defId) {
        return R.ok(defService.tpls(defId));
    }

    @PostMapping("/defs/{defId}/print-tpls")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<PrintTplResponse> createTpl(@PathVariable Long defId, @RequestBody PrintTplRequest req) {
        return R.ok(defService.createTpl(defId, req));
    }

    @PutMapping("/print-tpls/{id}")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<PrintTplResponse> updateTpl(@PathVariable Long id, @RequestBody PrintTplRequest req) {
        return R.ok(defService.updateTpl(id, req));
    }

    @DeleteMapping("/print-tpls/{id}")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<Void> deleteTpl(@PathVariable Long id) {
        defService.deleteTpl(id);
        return R.ok();
    }

    @PostMapping("/print-tpls/{id}/default")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<PrintTplResponse> setDefault(@PathVariable Long id) {
        return R.ok(defService.setDefaultTpl(id));
    }

    // ---------- 运行时 ----------

    @GetMapping("/docs")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<PageResult<DocItem>> docs(
            @RequestParam String defCode,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String filters,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(docService.page(defCode, keyword, status, filters, pageNum, pageSize));
    }

    @PostMapping("/docs")
    @PreAuthorize("hasAuthority('bizdoc:write')")
    public R<DocDetail> create(@RequestBody DocRequest req) {
        return R.ok(docService.create(req));
    }

    @GetMapping("/docs/{id}")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<DocDetail> detail(@PathVariable Long id) {
        return R.ok(docService.detail(id));
    }

    @PutMapping("/docs/{id}")
    @PreAuthorize("hasAuthority('bizdoc:write')")
    public R<DocDetail> update(@PathVariable Long id, @RequestBody DocRequest req) {
        return R.ok(docService.update(id, req));
    }

    @PostMapping("/docs/{id}/submit")
    @PreAuthorize("hasAuthority('bizdoc:write')")
    public R<DocDetail> submit(@PathVariable Long id) {
        return R.ok(docService.submit(id));
    }

    @PostMapping("/docs/{id}/void")
    @PreAuthorize("hasAuthority('bizdoc:write')")
    public R<DocDetail> voidDoc(@PathVariable Long id) {
        return R.ok(docService.voidDoc(id));
    }

    /** 打印数据：{tpl(元素树), data(form_data+系统字段), fields(label 映射)}——渲染在前端。 */
    @GetMapping("/docs/{id}/print")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<PrintData> print(@PathVariable Long id, @RequestParam(required = false) Long tplId) {
        return R.ok(docService.printData(id, tplId));
    }
}
