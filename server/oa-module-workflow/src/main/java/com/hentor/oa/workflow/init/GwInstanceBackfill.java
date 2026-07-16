package com.hentor.oa.workflow.init;

import com.hentor.oa.workflow.entity.WfInstanceExt;
import com.hentor.oa.workflow.entity.WfProcessExt;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.repository.WfProcessExtRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.HistoryService;
import org.flowable.engine.history.HistoricProcessInstance;
import org.flowable.variable.api.history.HistoricVariableInstance;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.ZoneId;

/**
 * 历史公文实例一次性补注册：引擎级实例注册（WfEngineEventListener.PROCESS_STARTED + __wfRegister 标记）
 * 上线前已存在的公文实例（businessKey=GW:*）没有 wf_instance_ext 行，我发起/已办/监控看不到。
 * 启动时按 businessKey 前缀 GW: 扫历史实例，缺行则补。幂等：已有行跳过；每次启动零额外写。
 */
@Slf4j
@Component
@Order(130)
@RequiredArgsConstructor
public class GwInstanceBackfill implements ApplicationRunner {

    private final HistoryService historyService;
    private final WfInstanceExtRepository instanceRepository;
    private final WfProcessExtRepository processRepository;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int filled = 0;
        try {
            for (HistoricProcessInstance hpi : historyService.createHistoricProcessInstanceQuery()
                    .processInstanceBusinessKeyLike("GW:%").list()) {
                if (instanceRepository.findByProcInstId(hpi.getId()).isPresent()) {
                    continue;
                }
                String defKey = hpi.getProcessDefinitionKey();
                WfProcessExt def = defKey != null ? processRepository.findByDefCode(defKey).orElse(null) : null;

                WfInstanceExt inst = new WfInstanceExt();
                inst.setProcInstId(hpi.getId());
                inst.setDefCode(defKey != null ? defKey : "unknown");
                inst.setDefName(def != null ? def.getName() : hpi.getProcessDefinitionName());
                String title = StringUtils.hasText(hpi.getName()) ? hpi.getName()
                        : varString(hpi.getId(), "__title");
                inst.setTitle(StringUtils.hasText(title) ? title
                        : (def != null ? def.getName() : String.valueOf(defKey)));
                inst.setInitiatorId(varLong(hpi.getId(), "initiatorId"));
                inst.setInitiatorName(varString(hpi.getId(), "initiatorName"));
                inst.setInitiatorDeptId(varLong(hpi.getId(), "initiatorDeptId"));
                inst.setFormCode(def != null ? def.getFormCode() : null);
                boolean ended = hpi.getEndTime() != null;
                inst.setBizStatus(ended ? WfInstanceExt.STATUS_APPROVED : WfInstanceExt.STATUS_RUNNING);
                if (ended) {
                    inst.setEndedAt(hpi.getEndTime().toInstant().atZone(ZoneId.systemDefault()).toOffsetDateTime());
                }
                instanceRepository.save(inst);
                filled++;
            }
        } catch (Exception e) {
            log.warn("历史公文实例补注册失败（不阻断启动）: {}", e.getMessage());
        }
        if (filled > 0) {
            log.info("历史公文实例补注册：补 {} 行 wf_instance_ext", filled);
        }
    }

    private String varString(String pid, String name) {
        Object v = varValue(pid, name);
        return v != null ? String.valueOf(v) : null;
    }

    private Long varLong(String pid, String name) {
        Object v = varValue(pid, name);
        return v instanceof Number n ? n.longValue() : null;
    }

    private Object varValue(String pid, String name) {
        try {
            HistoricVariableInstance v = historyService.createHistoricVariableInstanceQuery()
                    .processInstanceId(pid).variableName(name).singleResult();
            return v != null ? v.getValue() : null;
        } catch (Exception e) {
            return null;
        }
    }
}
