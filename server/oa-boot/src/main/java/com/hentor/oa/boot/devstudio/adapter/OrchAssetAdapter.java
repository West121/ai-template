package com.hentor.oa.boot.devstudio.adapter;

import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.workflow.orch.dto.OrchDtos.FlowRequest;
import com.hentor.oa.workflow.orch.dto.OrchDtos.FlowResponse;
import com.hentor.oa.workflow.orch.entity.OrchFlow;
import com.hentor.oa.workflow.orch.repository.OrchFlowRepository;
import com.hentor.oa.workflow.orch.service.OrchFlowService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ORCH（自动化编排 orch_flow.designer_json）适配。
 * 保存=OrchFlowService.update（存草图不编译，原生语义）；发布=publish（编译 EL + version+1 +
 * 原生 orch_flow_version 快照 + cron 刷新）。enabled 启停不在门面范围（留原 /api/orch/flows/{id}/enable）。
 */
@Component
@RequiredArgsConstructor
public class OrchAssetAdapter implements DevAssetAdapter {

    private final OrchFlowRepository flowRepository;
    private final OrchFlowService flowService;
    private final ObjectMapper objectMapper;

    @Override
    public String type() {
        return "ORCH";
    }

    @Override
    public String writeAuthority() {
        return "orch:flow:write";
    }

    @Override
    public List<AssetNode> list() {
        List<AssetNode> out = new ArrayList<>();
        for (OrchFlow f : flowRepository.findAll()) {
            out.add(new AssetNode(type(), f.getCode(), f.getName(), status(f), f.getVersion(),
                    f.getUpdatedAt() != null ? f.getUpdatedAt() : f.getCreatedAt()));
        }
        return out;
    }

    /** 已启用 > 已发布 > 草稿（前端按 ENABLED 渲染「已启用」）。 */
    private String status(OrchFlow f) {
        if (Boolean.TRUE.equals(f.getEnabled())) {
            return "ENABLED";
        }
        return f.getVersion() != null && f.getVersion() > 0 ? "PUBLISHED" : "DRAFT";
    }

    @Override
    public AssetContent read(String code) {
        OrchFlow f = find(code);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("id", f.getId());
        meta.put("name", f.getName());
        meta.put("status", status(f));
        meta.put("nativeVersion", f.getVersion());
        meta.put("enabled", f.getEnabled());
        meta.put("triggerType", f.getTriggerType());
        meta.put("remark", f.getRemark());
        return new AssetContent(type(), code, f.getDesignerJson(), null, meta);
    }

    @Override
    public void validate(String code, String content) {
        find(code); // 资产须存在
        requireJsonObject(content, "编排 designerJson");
    }

    @Override
    public Map<String, Object> save(String code, String content, boolean publish) {
        OrchFlow f = find(code);
        requireJsonObject(content, "编排 designerJson");
        // update() 对 remark/errorFlowId 无条件覆盖 → 回传现值保持不变；name 传 null 保持
        flowService.update(f.getId(), new FlowRequest(null, null, content, f.getRemark(), f.getErrorFlowId()));
        FlowResponse r;
        if (publish) {
            r = flowService.publish(f.getId()); // 编译失败 → BusinessException 400，事务回滚
        } else {
            r = null;
        }
        OrchFlow after = find(code);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("nativeVersion", after.getVersion());
        meta.put("status", status(after));
        meta.put("enabled", after.getEnabled());
        if (r != null) {
            meta.put("elCompiled", true);
        }
        return meta;
    }

    private OrchFlow find(String code) {
        return flowRepository.findByCode(code)
                .orElseThrow(() -> new BusinessException(404, "编排不存在: " + code));
    }

    private void requireJsonObject(String content, String label) {
        try {
            JsonNode n = objectMapper.readTree(content);
            if (!n.isObject()) {
                throw new BusinessException(400, label + " 须为 JSON 对象");
            }
        } catch (BusinessException be) {
            throw be;
        } catch (Exception e) {
            throw new BusinessException(400, label + " 不是合法 JSON: " + e.getMessage());
        }
    }
}
