package com.hentor.oa.workflow.engine.ai;

import com.hentor.oa.workflow.engine.ai.AiApprovalProvider.AiDecision;
import com.hentor.oa.workflow.entity.WfOperation;
import com.hentor.oa.workflow.repository.WfOperationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 审批节点（P3）：serviceTask delegateExpression {@code ${wfAiApprovalDelegate}}。
 * 读取节点扩展 aiModel/aiSystemPrompt/aiFormContext/aiOutputMap，组装表单上下文交 {@link AiApprovalProvider} 决策，
 * 决策结果：① 写 wf_operation（actor=AI，action=AI_APPROVE，意见含决策/理由，模拟时明示「AI模拟」）；
 * ② 按 outputMap 把 approve/reject/route 映射为流程变量（供后续排它网关路由）。
 * serviceTask 执行后流程自动进入下一步。
 */
@Slf4j
@Component("wfAiApprovalDelegate")
@RequiredArgsConstructor
public class AiApprovalDelegate implements JavaDelegate {

    private final RepositoryService repositoryService;
    private final WfOperationRepository operationRepository;
    private final AiApprovalProvider provider;
    private final ObjectMapper objectMapper;

    @Override
    public void execute(DelegateExecution execution) {
        FlowElement fe = flowElement(execution);
        String model = extText(fe, "aiModel");
        String systemPrompt = extText(fe, "aiSystemPrompt");
        JsonNode formContext = extJson(fe, "aiFormContext");
        JsonNode outputMap = extJson(fe, "aiOutputMap");

        Map<String, Object> context = buildContext(execution, formContext);
        AiDecision decision;
        try {
            decision = provider.decide(model, systemPrompt, context);
        } catch (Exception e) {
            log.warn("AI 审批决策异常，按通过处理 pid={}: {}", execution.getProcessInstanceId(), e.getMessage());
            decision = new AiDecision("APPROVE", "AI模拟：决策异常，默认通过", true);
        }

        // 写审批记录（actor=AI）
        WfOperation op = new WfOperation();
        op.setProcInstId(execution.getProcessInstanceId());
        op.setNodeId(execution.getCurrentActivityId());
        op.setNodeName(fe != null ? fe.getName() : "AI审批");
        op.setActorName("AI");
        // action 按 AI 真实决策区分，使审批记录/时间线语义准确（拒绝时显示 AI_REJECT）
        op.setAction("REJECT".equals(decision.decision()) ? "AI_REJECT" : WfOperation.ACTION_AI);
        op.setComment(decision.comment());
        try {
            op.setDetailJson(objectMapper.writeValueAsString(Map.of(
                    "decision", decision.decision(), "simulated", decision.simulated())));
        } catch (Exception ignored) {
            // 明细序列化失败不阻断
        }
        operationRepository.save(op);

        // outputMap：把决策映射为流程变量（key=approve/reject/route → 变量名）
        execution.setVariable("aiDecision", decision.decision());
        if (outputMap != null && outputMap.isObject()) {
            String key = switch (decision.decision()) {
                case "REJECT" -> "reject";
                case "ROUTE" -> "route";
                default -> "approve";
            };
            JsonNode target = outputMap.get(key);
            if (target != null && !target.isNull()) {
                execution.setVariable(target.asString("aiApproved"), true);
            }
        }
        log.info("AI 审批节点完成 pid={} node={} decision={} simulated={}",
                execution.getProcessInstanceId(), execution.getCurrentActivityId(),
                decision.decision(), decision.simulated());
    }

    private Map<String, Object> buildContext(DelegateExecution execution, JsonNode formContext) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        if (formContext != null && formContext.isArray() && !formContext.isEmpty()) {
            for (JsonNode f : formContext) {
                String field = f.asString(null);
                if (field != null) {
                    ctx.put(field, execution.getVariable(field));
                }
            }
        } else {
            // 未指定 formContext：带上全部标量流程变量
            execution.getVariables().forEach((k, v) -> {
                if (v instanceof Number || v instanceof String || v instanceof Boolean) {
                    ctx.put(k, v);
                }
            });
        }
        return ctx;
    }

    private FlowElement flowElement(DelegateExecution execution) {
        try {
            return repositoryService.getBpmnModel(execution.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(execution.getCurrentActivityId(), true);
        } catch (Exception e) {
            return null;
        }
    }

    private String extText(FlowElement fe, String name) {
        if (fe == null || fe.getExtensionElements() == null) {
            return null;
        }
        List<ExtensionElement> list = fe.getExtensionElements().get(name);
        if (list == null || list.isEmpty()) {
            return null;
        }
        String t = list.get(0).getElementText();
        return t == null || t.isBlank() ? null : t;
    }

    private JsonNode extJson(FlowElement fe, String name) {
        String text = extText(fe, name);
        if (text == null) {
            return null;
        }
        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }
}
