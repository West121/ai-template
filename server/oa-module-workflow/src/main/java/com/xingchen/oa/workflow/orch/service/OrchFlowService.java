package com.xingchen.oa.workflow.orch.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.FlowRequest;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.FlowResponse;
import com.xingchen.oa.workflow.orch.engine.OrchToElCompiler;
import com.xingchen.oa.workflow.orch.entity.OrchExec;
import com.xingchen.oa.workflow.orch.entity.OrchFlow;
import com.xingchen.oa.workflow.orch.repository.OrchExecRepository;
import com.xingchen.oa.workflow.orch.repository.OrchFlowRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 编排定义 CRUD / 发布（编译校验 + el_expr 缓存 + trigger 提取）/ 启停 / webhook token 重置。
 */
@Service
@RequiredArgsConstructor
public class OrchFlowService {

    private static final Pattern CODE_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_-]{1,63}");

    private final OrchFlowRepository flowRepository;
    private final OrchExecRepository execRepository;
    private final OrchToElCompiler compiler;
    private final ObjectMapper objectMapper;

    public PageResult<FlowResponse> page(String keyword, int pageNum, int pageSize) {
        String kw = keyword == null ? "" : keyword;
        Page<OrchFlow> page = flowRepository.findByNameContainingOrCodeContaining(kw, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(f -> toResponse(f, false, true)).toList(),
                page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    /** 详情：key 纯数字按 id，否则按 code（设计器路由 :code，运行/发布按 id）。 */
    public FlowResponse get(String key) {
        OrchFlow flow = key != null && key.matches("\\d+")
                ? find(Long.valueOf(key))
                : flowRepository.findByCode(key).orElseThrow(() -> new BusinessException(404, "编排不存在: " + key));
        return toResponse(flow, true, true);
    }

    @Transactional
    public FlowResponse create(FlowRequest req) {
        if (!StringUtils.hasText(req.code()) || !CODE_PATTERN.matcher(req.code()).matches()) {
            throw new BusinessException(400, "编排编码非法（字母开头，字母数字-_，≤64）");
        }
        if (flowRepository.findByCode(req.code()).isPresent()) {
            throw new BusinessException(400, "编排编码已存在: " + req.code());
        }
        OrchFlow flow = new OrchFlow();
        flow.setCode(req.code());
        flow.setName(StringUtils.hasText(req.name()) ? req.name() : req.code());
        flow.setDesignerJson(req.designerJson());
        flow.setRemark(req.remark());
        flow.setErrorFlowId(req.errorFlowId());
        flow.setWebhookToken(newToken());
        UserContext u = CurrentUserHolder.get();
        flow.setCreatedBy(u != null ? u.getUserId() : null);
        extractTrigger(flow);
        return toResponse(flowRepository.save(flow), true, false);
    }

    @Transactional
    public FlowResponse update(Long id, FlowRequest req) {
        OrchFlow flow = find(id);
        if (StringUtils.hasText(req.name())) {
            flow.setName(req.name());
        }
        if (req.designerJson() != null) {
            flow.setDesignerJson(req.designerJson());
        }
        flow.setRemark(req.remark());
        flow.setErrorFlowId(req.errorFlowId());
        flow.setUpdatedAt(OffsetDateTime.now());
        extractTrigger(flow);
        return toResponse(flowRepository.save(flow), true, false);
    }

    @Transactional
    public void delete(Long id) {
        flowRepository.delete(find(id));
    }

    /** 发布：编译校验 → el_expr 缓存 + version+1 + trigger 提取。 */
    @Transactional
    public FlowResponse publish(Long id) {
        OrchFlow flow = find(id);
        if (!StringUtils.hasText(flow.getDesignerJson())) {
            throw new BusinessException(400, "编排为空，无法发布");
        }
        JsonNode model = parseModel(flow.getDesignerJson());
        String el = compiler.compile(model);
        flow.setElExpr(el);
        flow.setVersion((flow.getVersion() == null ? 0 : flow.getVersion()) + 1);
        flow.setUpdatedAt(OffsetDateTime.now());
        extractTrigger(flow);
        return toResponse(flowRepository.save(flow), true, false);
    }

    @Transactional
    public FlowResponse enable(Long id, boolean enabled) {
        OrchFlow flow = find(id);
        if (enabled && (flow.getVersion() == null || flow.getVersion() <= 0)) {
            throw new BusinessException(400, "编排未发布，不能启用");
        }
        flow.setEnabled(enabled);
        flow.setUpdatedAt(OffsetDateTime.now());
        return toResponse(flowRepository.save(flow), false, false);
    }

    @Transactional
    public FlowResponse resetHookToken(Long id) {
        OrchFlow flow = find(id);
        flow.setWebhookToken(newToken());
        flow.setUpdatedAt(OffsetDateTime.now());
        return toResponse(flowRepository.save(flow), false, false);
    }

    // ==================== 内部 ====================

    private OrchFlow find(Long id) {
        return flowRepository.findById(id).orElseThrow(() -> new BusinessException(404, "编排不存在"));
    }

    /** 从 designerJson 的 trigger 节点提取 trigger_type / trigger_config（保存与发布都刷新）。 */
    private void extractTrigger(OrchFlow flow) {
        flow.setTriggerType(OrchFlow.TRIGGER_MANUAL);
        flow.setTriggerConfig(null);
        if (!StringUtils.hasText(flow.getDesignerJson())) {
            return;
        }
        try {
            JsonNode model = objectMapper.readTree(flow.getDesignerJson());
            for (JsonNode n : model.path("nodes")) {
                if ("trigger".equals(n.path("type").asString(""))) {
                    JsonNode config = n.path("config");
                    flow.setTriggerType(config.path("triggerType").asString(OrchFlow.TRIGGER_MANUAL).toUpperCase());
                    if (config.hasNonNull("cron")) {
                        flow.setTriggerConfig(objectMapper.createObjectNode()
                                .put("cron", config.path("cron").asString("")).toString());
                    } else if (config.has("event")) {
                        flow.setTriggerConfig(config.path("event").toString());
                    }
                    return;
                }
            }
        } catch (Exception ignored) {
            // 图未成形时保持 MANUAL
        }
    }

    private JsonNode parseModel(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            throw new BusinessException(400, "OrchModel JSON 解析失败: " + e.getMessage());
        }
    }

    private String newToken() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    private FlowResponse toResponse(OrchFlow f, boolean withJson, boolean withLastExec) {
        String lastStatus = null;
        OffsetDateTime lastAt = null;
        if (withLastExec) {
            OrchExec last = execRepository.findFirstByFlowIdOrderByIdDesc(f.getId()).orElse(null);
            if (last != null) {
                lastStatus = last.getStatus();
                lastAt = last.getStartedAt();
            }
        }
        return new FlowResponse(f.getId(), f.getCode(), f.getName(),
                withJson ? f.getDesignerJson() : null,
                f.getTriggerType(), f.getTriggerConfig(), f.getWebhookToken(),
                f.getEnabled(), f.getVersion(), f.getErrorFlowId(), f.getRemark(),
                f.getCreatedAt(), f.getUpdatedAt(), lastStatus, lastAt);
    }
}
