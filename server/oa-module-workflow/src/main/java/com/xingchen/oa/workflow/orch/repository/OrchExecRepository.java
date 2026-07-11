package com.xingchen.oa.workflow.orch.repository;

import com.xingchen.oa.workflow.orch.entity.OrchExec;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface OrchExecRepository extends JpaRepository<OrchExec, Long>, JpaSpecificationExecutor<OrchExec> {

    java.util.Optional<OrchExec> findFirstByFlowIdOrderByIdDesc(Long flowId);

    java.util.Optional<OrchExec> findByResumeToken(String resumeToken);

    java.util.List<OrchExec> findByStatus(String status);
}
