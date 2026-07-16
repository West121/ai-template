package com.hentor.oa.workflow.engine;

import com.hentor.oa.workflow.entity.WfVote;
import com.hentor.oa.workflow.repository.WfVoteRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.util.List;

/**
 * 票签（VOTE）支持：并行多实例节点 completionCondition {@code ${wfVote.pass(execution)}}。
 * 权重与阈值来自节点扩展 {@code oa:voteConfig={"weights":{userId:weight},"threshold":0.5}}；
 * 赞成权重占比 > 阈值即提前完成（剩余实例被引擎收敛取消）。
 */
@Slf4j
@Component("wfVote")
@RequiredArgsConstructor
public class WfVoteService {

    private final RepositoryService repositoryService;
    private final WfVoteRepository voteRepository;
    private final ObjectMapper objectMapper;

    /** 节点是否为票签模式。 */
    public boolean isVoteNode(Task task) {
        JsonNode cfg = voteConfig(task.getProcessDefinitionId(), task.getTaskDefinitionKey());
        return cfg != null || "VOTE".equalsIgnoreCase(extText(task.getProcessDefinitionId(),
                task.getTaskDefinitionKey(), "multiMode"));
    }

    /** 记录一张赞成票（幂等，权重取节点配置，缺省 1）。 */
    public void recordApprove(Task task, Long userId) {
        record(task, userId, WfVote.DECISION_APPROVE);
    }

    public void recordReject(Task task, Long userId) {
        record(task, userId, WfVote.DECISION_REJECT);
    }

    private void record(Task task, Long userId, String decision) {
        String pid = task.getProcessInstanceId();
        String node = task.getTaskDefinitionKey();
        if (voteRepository.existsByProcInstIdAndNodeIdAndUserId(pid, node, userId)) {
            return;
        }
        WfVote v = new WfVote();
        v.setProcInstId(pid);
        v.setNodeId(node);
        v.setUserId(userId);
        v.setWeight(weightOf(task.getProcessDefinitionId(), node, userId));
        v.setDecision(decision);
        voteRepository.save(v);
    }

    /**
     * 由 BPMN completionCondition 调用：赞成占比 &gt; 阈值则提前完成节点。
     * <ul>
     *   <li>配了 weights：按权重——赞成权重和 &gt; threshold × 总权重；</li>
     *   <li>未配 weights：按比例——每人等权(权重1)，赞成人数 / 总办理人数 &gt; threshold。
     *       总办理人数取多实例 nrOfInstances（发起时已展开的办理人数），使「票签按比例」名副其实，
     *       而非旧的「一票即通过」。</li>
     * </ul>
     */
    public boolean pass(DelegateExecution execution) {
        try {
            String node = execution.getCurrentActivityId();
            String pid = execution.getProcessInstanceId();
            JsonNode cfg = voteConfig(execution.getProcessDefinitionId(), node);
            double threshold = cfg != null ? cfg.path("threshold").asDouble(0.5) : 0.5;
            boolean hasWeights = cfg != null && cfg.has("weights") && cfg.get("weights").size() > 0;

            if (hasWeights) {
                double total = 0;
                for (JsonNode w : cfg.get("weights")) {
                    total += w.asDouble(1);
                }
                double approved = 0;
                for (WfVote v : voteRepository.findByProcInstIdAndNodeId(pid, node)) {
                    if (WfVote.DECISION_APPROVE.equals(v.getDecision())) {
                        approved += v.getWeight().doubleValue();
                    }
                }
                if (total <= 0) {
                    return approved > 0;
                }
                return approved > threshold * total;
            }

            // 无权重：按比例（每人等权）
            long approvedCount = 0;
            for (WfVote v : voteRepository.findByProcInstIdAndNodeId(pid, node)) {
                if (WfVote.DECISION_APPROVE.equals(v.getDecision())) {
                    approvedCount++;
                }
            }
            int total = totalAssignees(execution);
            if (total <= 0) {
                return approvedCount > 0; // 兜底：无法取到总数时退化为一票通过
            }
            return (double) approvedCount / total > threshold;
        } catch (Exception e) {
            log.warn("票签 pass 求值失败: {}", e.getMessage());
            return false;
        }
    }

    /** 多实例总办理人数：优先取引擎变量 nrOfInstances（发起展开时确定），取不到返回 0（由调用方兜底）。 */
    private int totalAssignees(DelegateExecution execution) {
        Object nr = execution.getVariable("nrOfInstances");
        if (nr instanceof Number n) {
            return n.intValue();
        }
        return 0;
    }

    /* ---------------- helpers ---------------- */

    private BigDecimal weightOf(String procDefId, String node, Long userId) {
        JsonNode cfg = voteConfig(procDefId, node);
        if (cfg != null && cfg.has("weights")) {
            JsonNode w = cfg.get("weights").get(String.valueOf(userId));
            if (w != null && w.isNumber()) {
                return BigDecimal.valueOf(w.asDouble());
            }
        }
        return BigDecimal.ONE;
    }

    private JsonNode voteConfig(String procDefId, String node) {
        String text = extText(procDefId, node, "voteConfig");
        if (text == null) {
            return null;
        }
        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    private String extText(String procDefId, String nodeId, String name) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(procDefId).getMainProcess()
                    .getFlowElement(nodeId, true);
            if (fe == null || fe.getExtensionElements() == null) {
                return null;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get(name);
            if (list == null || list.isEmpty()) {
                return null;
            }
            String t = list.get(0).getElementText();
            return t == null || t.isBlank() ? null : t;
        } catch (Exception e) {
            return null;
        }
    }
}
