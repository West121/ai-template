package com.hentor.oa.boot.fieldperm;

import com.hentor.oa.boot.ai.entity.AiFeatureCatalog;
import com.hentor.oa.boot.ai.repository.AiFeatureCatalogRepository;
import com.hentor.oa.common.core.R;
import com.hentor.oa.system.fieldperm.FieldPermCatalogService;
import com.hentor.oa.workflow.dto.FieldDescriptor;
import com.hentor.oa.workflow.service.FormManifestService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 字段权限·归一字段清单端点（P3 拍板 B，落 boot 层——组合 ai_feature_catalog（boot）
 * + FormManifestService（workflow）+ 注解固定列目录（system），三模块只在 boot 汇合，依赖方向无损）。
 *
 * <p>GET /api/system/field-perms/catalog?feature= →
 * {@code {feature, formFields:[FieldDescriptor...], fixedColumns:[{field,label}]}}——
 * formFields=该 feature 的 related_form_codes（逗号分隔）逐个经 FormManifestService 合流去重（按 key）；
 * feature 不在目录/无关联表单 → formFields=[]（仅固定列可控）。配置矩阵唯一数据源（给疾风）。
 */
@Slf4j
@RestController
@RequestMapping("/api/system/field-perms")
@RequiredArgsConstructor
public class FieldPermCatalogController {

    private final AiFeatureCatalogRepository featureRepository;
    private final FormManifestService formManifestService;
    private final FieldPermCatalogService fixedColumnCatalog;

    @GetMapping("/catalog")
    @PreAuthorize("hasAuthority('system:role:edit')")
    public R<Map<String, Object>> catalog(@RequestParam String feature) {
        List<FieldDescriptor> formFields = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        AiFeatureCatalog cat = featureRepository.findByFeatureCodeIgnoreCase(feature).orElse(null);
        if (cat != null && StringUtils.hasText(cat.getRelatedFormCodes())) {
            for (String formKey : cat.getRelatedFormCodes().split(",")) {
                String key = formKey.trim();
                if (key.isEmpty()) {
                    continue;
                }
                try {
                    for (FieldDescriptor f : formManifestService.manifest(key).fields()) {
                        if (seen.add(f.key())) { // 多表单合流按 key 去重
                            formFields.add(f);
                        }
                    }
                } catch (Exception e) {
                    log.warn("字段清单合流：表单 {} 读取失败（跳过）: {}", key, e.getMessage());
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("feature", feature);
        out.put("formFields", formFields);
        out.put("fixedColumns", fixedColumnCatalog.fixedColumns(feature));
        return R.ok(out);
    }
}
