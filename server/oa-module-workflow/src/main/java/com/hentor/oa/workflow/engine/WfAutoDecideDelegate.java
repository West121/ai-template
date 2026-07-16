package com.hentor.oa.workflow.engine;

import com.hentor.oa.workflow.entity.WfInstanceExt;
import com.hentor.oa.workflow.entity.WfOperation;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.repository.WfOperationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 自动决策节点（自动通过 / 自动拒绝）：serviceTask delegateExpression {@code ${wfAutoDecide}}。
 * 读节点扩展 {@code autoDecision=APPROVE|REJECT}：
 * <ul>
 *   <li>APPROVE：记录 action=AUTO_APPROVE，流程继续后续节点；</li>
 *   <li>REJECT：记录 action=AUTO_REJECT，并把实例 biz_status 置 REJECTED（在后续终止结束事件触发
 *       {@code PROCESS_COMPLETED_WITH_TERMINATE_END_EVENT} 前落库，使全局监听器不再覆盖为 APPROVED）。</li>
 * </ul>
 */
@Slf4j
@Component("wfAutoDecide")
@RequiredArgsConstructor
public class WfAutoDecideDelegate implements JavaDelegate {

    private final RepositoryService repositoryService;
    private final WfOperationRepository operationRepository;
    private final WfInstanceExtRepository instanceRepository;

    @Override
    public void execute(DelegateExecution execution) {
        FlowElement fe = flowElement(execution);
        String decision = extText(fe, "autoDecision");
        boolean reject = "REJECT".equalsIgnoreCase(decision);

        WfOperation op = new WfOperation();
        op.setProcInstId(execution.getProcessInstanceId());
        op.setNodeId(execution.getCurrentActivityId());
        op.setNodeName(fe != null ? fe.getName() : (reject ? "自动拒绝" : "自动通过"));
        op.setActorName("系统");
        op.setAction(reject ? WfOperation.ACTION_AUTO_REJECT : WfOperation.ACTION_AUTO_APPROVE);
        op.setComment(reject ? "系统自动拒绝" : "系统自动通过");
        operationRepository.save(op);

        if (reject) {
            instanceRepository.findByProcInstId(execution.getProcessInstanceId()).ifPresent(inst -> {
                if (WfInstanceExt.STATUS_RUNNING.equals(inst.getBizStatus())) {
                    inst.setBizStatus(WfInstanceExt.STATUS_REJECTED);
                    inst.setEndedAt(OffsetDateTime.now());
                    instanceRepository.save(inst);
                }
            });
        }
        log.info("自动决策节点 pid={} node={} decision={}",
                execution.getProcessInstanceId(), execution.getCurrentActivityId(),
                reject ? "AUTO_REJECT" : "AUTO_APPROVE");
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
}
