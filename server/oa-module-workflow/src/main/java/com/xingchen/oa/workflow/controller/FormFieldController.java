package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.dto.CodeFormItem;
import com.xingchen.oa.workflow.dto.FormFieldManifest;
import com.xingchen.oa.workflow.service.FormManifestService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 表单字段清单端点（N-B-03，设计文档第二部分 2.3）。与表单查看一致，登录即可。
 * 供设计时「节点字段权限编辑器」按 formKey 拉取机器可读字段清单，渲染 visible/editable/required 矩阵。
 */
@RestController
@RequestMapping("/api/wf/forms")
@RequiredArgsConstructor
public class FormFieldController {

    private final FormManifestService service;

    /** GET /api/wf/forms/code → 已登记 CODE 表单清单 [{formKey,name,fieldCount}]，供流程定义绑定 UI 下拉。 */
    @GetMapping("/code")
    public R<List<CodeFormItem>> codeForms() {
        return R.ok(service.codeForms());
    }

    /** GET /api/wf/forms/{formKey}/fields → 表单字段清单（ONLINE 从 schemaJson 派生 / CODE 取登记清单）。 */
    @GetMapping("/{formKey}/fields")
    public R<FormFieldManifest> fields(@PathVariable String formKey) {
        return R.ok(service.manifest(formKey));
    }
}
