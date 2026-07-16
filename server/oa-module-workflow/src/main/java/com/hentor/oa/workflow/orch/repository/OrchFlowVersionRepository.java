package com.hentor.oa.workflow.orch.repository;

import com.hentor.oa.workflow.orch.entity.OrchFlowVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OrchFlowVersionRepository extends JpaRepository<OrchFlowVersion, Long> {

    List<OrchFlowVersion> findByFlowIdOrderByVersionDesc(Long flowId);

    Optional<OrchFlowVersion> findByFlowIdAndVersion(Long flowId, Integer version);
}
