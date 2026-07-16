package com.hentor.oa.workflow.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.workflow.convert.FormManifestExtractor;
import com.hentor.oa.workflow.dto.CodeFormItem;
import com.hentor.oa.workflow.dto.FieldDescriptor;
import com.hentor.oa.workflow.dto.FormFieldManifest;
import com.hentor.oa.workflow.entity.WfFormDef;
import com.hentor.oa.workflow.repository.WfFormDefRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

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

    @PersistenceContext
    private EntityManager entityManager;

    /** 取该 formKey 最新版本表单的字段清单。表单不存在 → 404。 */
    public FormFieldManifest manifest(String formKey) {
        // §10 bizdoc 分支：formKey="bizdoc:{defCode}" 从单据定义私有 form_schema 派生字段
        //（流程设计器条件/取人由此识别单据字段）。冒号在 URL 路径段合法，原样或 %3A 编码均可路由。
        if (formKey != null && formKey.startsWith("bizdoc:")) {
            return bizdocManifest(formKey);
        }
        WfFormDef def = repository.findTopByCodeOrderByVersionDesc(formKey)
                .orElseThrow(() -> new BusinessException(404, "表单不存在: " + formKey));

        if (WfFormDef.TYPE_CODE.equalsIgnoreCase(def.getFormType())) {
            return codeManifest(formKey, def);
        }
        // 默认按 ONLINE 处理（form_type 缺省 ONLINE）
        List<FieldDescriptor> fields = FormManifestExtractor.extract(def.getSchemaJson());
        return new FormFieldManifest(formKey, FormFieldManifest.TYPE_ONLINE, fields);
    }

    /** 已登记 CODE 表单清单（供绑定 UI 下拉）：同 code 取最高版本，返回 {formKey,name,fieldCount}。 */
    public List<CodeFormItem> codeForms() {
        List<CodeFormItem> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (WfFormDef def : repository.findByFormTypeOrderByCodeAscVersionDesc(WfFormDef.TYPE_CODE)) {
            if (!seen.add(def.getCode())) {
                continue; // 已收录该 code 的最高版本（排序 code asc, version desc）
            }
            out.add(new CodeFormItem(def.getCode(), def.getName(), fieldCount(def)));
        }
        return out;
    }

    private int fieldCount(WfFormDef def) {
        if (!StringUtils.hasText(def.getFieldManifest())) {
            return 0;
        }
        try {
            return objectMapper.readValue(def.getFieldManifest(),
                    new TypeReference<List<FieldDescriptor>>() {
                    }).size();
        } catch (Exception e) {
            return 0;
        }
    }

    /** bizdoc:{defCode}：原生查 oa_bizdoc_def.form_schema（workflow 不依赖 office 模块），extractor 同源派生。 */
    private FormFieldManifest bizdocManifest(String formKey) {
        String defCode = formKey.substring("bizdoc:".length());
        java.util.List<?> rows = entityManager.createNativeQuery(
                        "SELECT form_schema FROM oa_bizdoc_def WHERE code = :code")
                .setParameter("code", defCode)
                .getResultList();
        if (rows.isEmpty()) {
            throw new BusinessException(404, "单据定义不存在: " + defCode);
        }
        Object schema = rows.get(0);
        if (schema == null || String.valueOf(schema).isBlank()) {
            throw new BusinessException(404, "该单据定义未完成字段设计（form_schema 为空）: " + defCode);
        }
        List<FieldDescriptor> fields = FormManifestExtractor.extract(String.valueOf(schema));
        return new FormFieldManifest(formKey, "BIZDOC", fields);
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
