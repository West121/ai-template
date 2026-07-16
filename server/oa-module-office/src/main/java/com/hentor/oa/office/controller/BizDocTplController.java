package com.hentor.oa.office.controller;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.core.R;
import com.hentor.oa.office.dto.bizdoc.BizDocDtos.PrintData;
import com.hentor.oa.office.dto.bizdoc.BizDocDtos.TplFields;
import com.hentor.oa.office.dto.bizdoc.BizDocDtos.TplRequest;
import com.hentor.oa.office.dto.bizdoc.BizDocDtos.TplResponse;
import com.hentor.oa.office.service.BizDocTplService;
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
 * 独立文档模板 API（bizdoc-design.md §11，/api/bizdoc/tpls）。
 * 权限：管理 bizdoc:def:write；列表/详情/字段树 bizdoc:read；
 * render-data / for-instance 仅登录（=实例可见性口径，同 GET /api/wf/instances/{id}）。
 */
@RestController
@RequestMapping("/api/bizdoc/tpls")
@RequiredArgsConstructor
public class BizDocTplController {

    private final BizDocTplService tplService;

    @GetMapping
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<PageResult<TplResponse>> page(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String bindType,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(tplService.page(keyword, category, bindType, pageNum, pageSize));
    }

    /** 实例可打印模板列表（已发布 且 FLOW=实例 defCode / FORM=实例 formCode）。注意先于 /{id} 匹配。 */
    @GetMapping("/for-instance/{instanceId}")
    public R<List<TplResponse>> forInstance(@PathVariable String instanceId) {
        return R.ok(tplService.forInstance(instanceId));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<TplResponse> detail(@PathVariable Long id) {
        return R.ok(tplService.detail(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<TplResponse> create(@RequestBody TplRequest req) {
        return R.ok(tplService.create(req));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<TplResponse> update(@PathVariable Long id, @RequestBody TplRequest req) {
        return R.ok(tplService.update(id, req));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<Void> delete(@PathVariable Long id) {
        tplService.delete(id);
        return R.ok();
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasAuthority('bizdoc:def:write')")
    public R<TplResponse> publish(@PathVariable Long id) {
        return R.ok(tplService.publish(id));
    }

    /** 编辑器字段树：FLOW=流程绑定表单统一清单+_approvals 组；FORM=统一清单；BIZDOC=定义清单。 */
    @GetMapping("/{id}/fields")
    @PreAuthorize("hasAuthority('bizdoc:read')")
    public R<TplFields> fields(@PathVariable Long id) {
        return R.ok(tplService.fields(id));
    }

    /** 渲染数据 {tpl,data,fields}（FLOW/FORM 绑定；BIZDOC 沿用 docs/{id}/print）。 */
    @GetMapping("/{id}/render-data")
    public R<PrintData> renderData(@PathVariable Long id, @RequestParam String instanceId) {
        return R.ok(tplService.renderData(id, instanceId));
    }
}
