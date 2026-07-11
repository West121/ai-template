package com.xingchen.oa.workflow.orch.repository;

import com.xingchen.oa.workflow.orch.entity.OrchExecNode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OrchExecNodeRepository extends JpaRepository<OrchExecNode, Long> {

    List<OrchExecNode> findByExecIdOrderByIdAsc(Long execId);

    java.util.Optional<OrchExecNode> findFirstByExecIdAndNodeIdOrderByIdDesc(Long execId, String nodeId);
}
