package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.convert.FormManifestExtractor;
import com.xingchen.oa.workflow.dto.FieldDescriptor;
import com.xingchen.oa.workflow.dto.FormFieldManifest;
import com.xingchen.oa.workflow.entity.WfFormDef;
import com.xingchen.oa.workflow.repository.WfFormDefRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

/**
 * 表单字段清单（N-B-03，设计文档第二部分 2.2/2.3）。按 formKey(=wf_form_def.code) 取最新版本表单，
 * 输出统一的 {@link FormFieldManifest}，与来源无关：
 * <ul>
 *   <li>ONLINE：从 schemaJson 递归提取扁平字段（容器透明、子表单列带前缀 + 分组）。</li>
 *   <li>CODE：返回后台登记的 field_manifest；未登记则 404（前端由 registry 本地提供，本端点主要服务 ONLINE）。</li>
 * </ul>
 * 设计时「节点字段权限编辑器」按 formKey 拉本清单渲染 visible/editable/required 矩阵，
 * 结果写入节点 {@code WfNodeProps.formPerms}（已有字段，不新增模型）。
 */
@Service
@RequiredArgsConstructor
public class FormManifestService {

    private final WfFormDefRepository repository;
    private final ObjectMapper objectMapper;

    /** 取该 formKey 最新版本表单的字段清单。表单不存在 → 404。 */
    public FormFieldManifest manifest(String formKey) {
        WfFormDef def = repository.findTopByCodeOrderByVersionDesc(formKey)
                .orElseThrow(() -> new BusinessException(404, "表单不存在: " + formKey));

        if (WfFormDef.TYPE_CODE.equalsIgnoreCase(def.getFormType())) {
            return codeManifest(formKey, def);
        }
        // 默认按 ONLINE 处理（form_type 缺省 ONLINE）
        List<FieldDescriptor> fields = FormManifestExtractor.extract(def.getSchemaJson());
        return new FormFieldManifest(formKey, FormFieldManifest.TYPE_ONLINE, fields);
    }

    /** CODE 表单：读后台登记的字段清单；无清单 → 404（前端 registry 兜底）。 */
    private FormFieldManifest codeManifest(String formKey, WfFormDef def) {
        if (!StringUtils.hasText(def.getFieldManifest())) {
            throw new BusinessException(404, "该 CODE 表单未登记字段清单，请由前端 registry 提供: " + formKey);
        }
        List<FieldDescriptor> fields;
        try {
            fields = objectMapper.readValue(def.getFieldManifest(), new TypeReference<List<FieldDescriptor>>() {
            });
        } catch (Exception e) {
            throw new BusinessException(400, "CODE 表单字段清单解析失败: " + formKey);
        }
        return new FormFieldManifest(formKey, FormFieldManifest.TYPE_CODE, fields);
    }
}
