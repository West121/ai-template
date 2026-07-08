package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.entity.WfCc;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.repository.WfCcRepository;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.repository.WfNotifyRepository;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

/**
 * 抄送节点处理（serviceTask delegateExpression {@code ${wfCcDelegate}}）：
 * 读取节点扩展 ccUsers，写 wf_cc（同实例同人去重）并投递 CC 通知。
 */
@Slf4j
@Component("wfCcDelegate")
@RequiredArgsConstructor
public class CcDelegate implements JavaDelegate {

    private final RepositoryService repositoryService;
    private final WfCcRepository ccRepository;
    private final WfNotifyRepository notifyRepository;
    private final WfInstanceExtRepository instanceRepository;
    private final SysUserRepository userRepository;
    private final ObjectMapper objectMapper;

    @Override
    public void execute(DelegateExecution execution) {
        String procInstId = execution.getProcessInstanceId();
        String nodeId = execution.getCurrentActivityId();
        FlowElement fe = repositoryService.getBpmnModel(execution.getProcessDefinitionId())
                .getMainProcess().getFlowElement(nodeId, true);
        List<Long> users = parseUsers(fe);
        if (users.isEmpty()) {
            return;
        }
        WfInstanceExt inst = instanceRepository.findByProcInstId(procInstId).orElse(null);
        String title = inst != null ? inst.getTitle() : "流程抄送";
        for (Long uid : users) {
            if (ccRepository.existsByProcInstIdAndUserId(procInstId, uid)) {
                continue;
            }
            WfCc cc = new WfCc();
            cc.setProcInstId(procInstId);
            cc.setNodeId(nodeId);
            cc.setUserId(uid);
            cc.setReadFlag(false);
            ccRepository.save(cc);

            WfNotify n = new WfNotify();
            n.setUserId(uid);
            n.setType(WfNotify.TYPE_CC);
            n.setTitle("抄送：" + title);
            n.setContent("您被抄送了流程「" + title + "」");
            n.setProcInstId(procInstId);
            n.setReadFlag(false);
            notifyRepository.save(n);
        }
    }

    private List<Long> parseUsers(FlowElement fe) {
        if (fe == null || fe.getExtensionElements() == null) {
            return List.of();
        }
        List<ExtensionElement> list = fe.getExtensionElements().get("ccUsers");
        if (list == null || list.isEmpty()) {
            return List.of();
        }
        try {
            JsonNode arr = objectMapper.readTree(list.get(0).getElementText());
            java.util.List<Long> out = new java.util.ArrayList<>();
            for (JsonNode ref : arr) {
                if (ref.has("id") && !ref.get("id").isNull()) {
                    out.add(ref.get("id").asLong());
                } else {
                    String username = ref.path("username").asString(null);
                    if (username != null) {
                        userRepository.findByUsername(username).ifPresent(u -> out.add(u.getId()));
                    }
                }
            }
            return out;
        } catch (Exception e) {
            log.warn("解析抄送用户失败: {}", e.getMessage());
            return List.of();
        }
    }
}
