package com.hentor.oa.workflow.init;

import com.hentor.oa.workflow.entity.WfProcessExt;
import com.hentor.oa.workflow.repository.WfProcessExtRepository;
import com.hentor.oa.workflow.service.ProcessDefService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ApplicationArguments;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 启动兜底：将种子里仍为 DRAFT 的流程定义档案转换 BPMN 并部署到引擎，令其可发起。
 * 幂等：部署成功后状态置 PUBLISHED，重启即跳过。
 */
@Slf4j
@Component
@Order(100)
@RequiredArgsConstructor
public class WorkflowInitializer implements ApplicationRunner {

    private final WfProcessExtRepository processRepository;
    private final ProcessDefService processDefService;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<WfProcessExt> drafts = processRepository.findByStatusOrderByIdAsc(WfProcessExt.STATUS_DRAFT);
        for (WfProcessExt def : drafts) {
            try {
                processDefService.deploy(def);
                processRepository.save(def);
                log.info("工作流初始化：已发布流程定义 {} ({})", def.getName(), def.getDefCode());
            } catch (Exception e) {
                log.warn("工作流初始化：流程 {} 发布失败: {}", def.getDefCode(), e.getMessage());
            }
        }
    }
}
