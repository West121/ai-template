package com.xingchen.oa.boot.devstudio.adapter;

import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.dto.FormDefRequest;
import com.xingchen.oa.workflow.dto.FormDefResponse;
import com.xingchen.oa.workflow.entity.WfFormDef;
import com.xingchen.oa.workflow.repository.WfFormDefRepository;
import com.xingchen.oa.workflow.service.FormDefService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * FORM（在线表单 wf_form_def.schema_json）适配。行即版本（code+version 唯一）：
 * 树/读取一律取该 code 最高版本行（=运行时 latest 取数口径）。
 *
 * <p>保存语义（原生不改，拍板 8-④/9）：latest 为 DRAFT → 就地 update；latest 为 PUBLISHED →
 * FormDefService.create 建下一版本 DRAFT——<b>新行立即成为 latest（影响流程发起取数）</b>，
 * meta 回 {@code latestPointerChanged:true} 供前端明示。发布=publish（DRAFT→PUBLISHED，版本冻结）。
 */
@Component
@RequiredArgsConstructor
public class FormAssetAdapter implements DevAssetAdapter {

    private final WfFormDefRepository repository;
    private final FormDefService formDefService;
    private final ObjectMapper objectMapper;

    @Override
    public String type() {
        return "FORM";
    }

    @Override
    public String writeAuthority() {
        return "wf:def:edit";
    }

    @Override
    public List<AssetNode> list() {
        // 行即版本 → 按 code 聚合取最高版本行
        Map<String, WfFormDef> latest = new LinkedHashMap<>();
        for (WfFormDef f : repository.findAll()) {
            WfFormDef cur = latest.get(f.getCode());
            if (cur == null || f.getVersion() > cur.getVersion()) {
                latest.put(f.getCode(), f);
            }
        }
        List<AssetNode> out = new ArrayList<>();
        for (WfFormDef f : latest.values()) {
            out.add(new AssetNode(type(), f.getCode(), f.getName(), f.getStatus(),
                    f.getVersion(), f.getCreatedAt()));
        }
        return out;
    }

    @Override
    public AssetContent read(String code) {
        WfFormDef f = find(code);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("id", f.getId());
        meta.put("name", f.getName());
        meta.put("status", f.getStatus());
        meta.put("nativeVersion", f.getVersion());
        meta.put("formType", f.getFormType());
        meta.put("remark", f.getRemark());
        return new AssetContent(type(), code, f.getSchemaJson(), null, meta);
    }

    @Override
    public Map<String, Object> save(String code, String content, boolean publish) {
        WfFormDef latest = find(code);
        requireJsonContainer(content);
        boolean latestPointerChanged = false;
        Long targetId;
        if (WfFormDef.STATUS_DRAFT.equals(latest.getStatus())) {
            formDefService.update(latest.getId(),
                    new FormDefRequest(code, latest.getName(), content, latest.getRemark()));
            targetId = latest.getId();
        } else {
            // PUBLISHED 不可改（原生校验）→ 建下一版本 DRAFT；新行即 latest（影响发起取数）
            FormDefResponse created = formDefService.create(
                    new FormDefRequest(code, latest.getName(), content, latest.getRemark()));
            targetId = created.id();
            latestPointerChanged = true;
        }
        if (publish) {
            formDefService.publish(targetId);
        }
        WfFormDef after = repository.findById(targetId)
                .orElseThrow(() -> new BusinessException(500, "表单保存后读取失败"));
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("nativeVersion", after.getVersion());
        meta.put("status", after.getStatus());
        meta.put("latestPointerChanged", latestPointerChanged);
        return meta;
    }

    private WfFormDef find(String code) {
        return repository.findTopByCodeOrderByVersionDesc(code)
                .orElseThrow(() -> new BusinessException(404, "表单定义不存在: " + code));
    }

    /** schemaJson 容器校验：{widgets:[...]} 对象或历史顶层数组均可，标量/坏 JSON → 400。 */
    private void requireJsonContainer(String content) {
        try {
            JsonNode n = objectMapper.readTree(content);
            if (!n.isObject() && !n.isArray()) {
                throw new BusinessException(400, "表单 schemaJson 须为 JSON 对象或数组");
            }
        } catch (BusinessException be) {
            throw be;
        } catch (Exception e) {
            throw new BusinessException(400, "表单 schemaJson 不是合法 JSON: " + e.getMessage());
        }
    }
}
