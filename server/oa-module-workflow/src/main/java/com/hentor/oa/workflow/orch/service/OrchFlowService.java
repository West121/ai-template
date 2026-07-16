package com.hentor.oa.workflow.orch.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.workflow.orch.dto.OrchDtos.FlowRequest;
import com.hentor.oa.workflow.orch.dto.OrchDtos.FlowResponse;
import com.hentor.oa.workflow.orch.engine.OrchCronScheduler;
import com.hentor.oa.workflow.orch.engine.OrchToElCompiler;
import com.hentor.oa.workflow.orch.entity.OrchExec;
import com.hentor.oa.workflow.orch.entity.OrchFlow;
import com.hentor.oa.workflow.orch.entity.OrchFlowVersion;
import com.hentor.oa.workflow.orch.repository.OrchExecRepository;
import com.hentor.oa.workflow.orch.repository.OrchFlowRepository;
import com.hentor.oa.workflow.orch.repository.OrchFlowVersionRepository;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    private final OrchFlowVersionRepository versionRepository;
    private final OrchToElCompiler compiler;
    private final ObjectMapper objectMapper;
    /** 懒注入避免 FlowService ↔ CronScheduler(→ExecService) 装配环。 */
    private final org.springframework.beans.factory.ObjectProvider<OrchCronScheduler> cronScheduler;

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
        OrchFlow saved = flowRepository.save(flow);
        cronScheduler.getObject().refresh(saved);
        return toResponse(saved, true, false);
    }

    @Transactional
    public void delete(Long id) {
        flowRepository.delete(find(id));
        cronScheduler.getObject().remove(id);
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
        validateTriggerConfig(flow);
        OrchFlow saved = flowRepository.save(flow);
        snapshotVersion(saved);
        cronScheduler.getObject().refresh(saved);
        return toResponse(saved, true, false);
    }

    /** §9.5 发布版本快照。 */
    private void snapshotVersion(OrchFlow flow) {
        OrchFlowVersion v = new OrchFlowVersion();
        v.setFlowId(flow.getId());
        v.setVersion(flow.getVersion());
        v.setName(flow.getName());
        v.setDesignerJson(flow.getDesignerJson());
        v.setElExpr(flow.getElExpr());
        v.setTriggerType(flow.getTriggerType());
        v.setTriggerConfig(flow.getTriggerConfig());
        v.setRemark(flow.getRemark());
        UserContext u = CurrentUserHolder.get();
        v.setCreatedBy(u != null ? u.getUserId() : null);
        versionRepository.save(v);
    }

    /** §9.5 版本列表（不含 designerJson 减载）。 */
    public List<Map<String, Object>> versions(Long flowId) {
        find(flowId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (OrchFlowVersion v : versionRepository.findByFlowIdOrderByVersionDesc(flowId)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("version", v.getVersion());
            m.put("name", v.getName());
            m.put("triggerType", v.getTriggerType());
            m.put("createdBy", v.getCreatedBy());
            m.put("createdAt", v.getCreatedAt());
            out.add(m);
        }
        return out;
    }

    /** §9.5 版本详情（含 designerJson，只读查看）。 */
    public Map<String, Object> versionDetail(Long flowId, Integer version) {
        OrchFlowVersion v = versionRepository.findByFlowIdAndVersion(flowId, version)
                .orElseThrow(() -> new BusinessException(404, "版本不存在: v" + version));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("version", v.getVersion());
        m.put("name", v.getName());
        m.put("designerJson", v.getDesignerJson());
        m.put("elExpr", v.getElExpr());
        m.put("triggerType", v.getTriggerType());
        m.put("triggerConfig", v.getTriggerConfig());
        m.put("createdBy", v.getCreatedBy());
        m.put("createdAt", v.getCreatedAt());
        return m;
    }

    /** §9.5 回滚：以历史版本 designerJson 覆盖当前草图并重新发布（产生新版本快照，历史不改写）。 */
    @Transactional
    public FlowResponse rollback(Long flowId, Integer version) {
        OrchFlow flow = find(flowId);
        OrchFlowVersion v = versionRepository.findByFlowIdAndVersion(flowId, version)
                .orElseThrow(() -> new BusinessException(404, "版本不存在: v" + version));
        flow.setDesignerJson(v.getDesignerJson());
        if (StringUtils.hasText(v.getName())) {
            flow.setName(v.getName());
        }
        flowRepository.save(flow);
        return publish(flowId);
    }

    /** 触发器配置校验（发布时）：CRON 须带合法 Spring 6 段表达式；EVENT 须带 source+type。 */
    private void validateTriggerConfig(OrchFlow flow) {
        if (OrchFlow.TRIGGER_CRON.equals(flow.getTriggerType())) {
            String cron = null;
            try {
                cron = StringUtils.hasText(flow.getTriggerConfig())
                        ? objectMapper.readTree(flow.getTriggerConfig()).path("cron").asString(null) : null;
            } catch (Exception ignored) {
                // 落到空校验
            }
            if (!StringUtils.hasText(cron)) {
                throw new BusinessException(400, "CRON 触发器缺少 cron 表达式");
            }
            if (!org.springframework.scheduling.support.CronExpression.isValidExpression(cron)) {
                throw new BusinessException(400, "cron 表达式非法（Spring 6 段，如 0 0 8 * * *）: " + cron);
            }
        }
        if (OrchFlow.TRIGGER_EVENT.equals(flow.getTriggerType())) {
            try {
                JsonNode ev = StringUtils.hasText(flow.getTriggerConfig())
                        ? objectMapper.readTree(flow.getTriggerConfig()) : null;
                if (ev == null || !StringUtils.hasText(ev.path("source").asString(null))
                        || !StringUtils.hasText(ev.path("type").asString(null))) {
                    throw new BusinessException(400, "EVENT 触发器须配置 event {source, type[, defCode]}");
                }
            } catch (BusinessException be) {
                throw be;
            } catch (Exception e) {
                throw new BusinessException(400, "EVENT 触发器配置解析失败");
            }
        }
    }

    @Transactional
    public FlowResponse enable(Long id, boolean enabled) {
        OrchFlow flow = find(id);
        if (enabled && (flow.getVersion() == null || flow.getVersion() <= 0)) {
            throw new BusinessException(400, "编排未发布，不能启用");
        }
        flow.setEnabled(enabled);
        flow.setUpdatedAt(OffsetDateTime.now());
        OrchFlow saved = flowRepository.save(flow);
        cronScheduler.getObject().refresh(saved);
        return toResponse(saved, false, false);
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
