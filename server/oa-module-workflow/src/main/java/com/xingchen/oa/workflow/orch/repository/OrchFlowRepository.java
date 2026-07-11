package com.xingchen.oa.workflow.orch.repository;

import com.xingchen.oa.workflow.orch.entity.OrchFlow;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OrchFlowRepository extends JpaRepository<OrchFlow, Long> {

    Optional<OrchFlow> findByCode(String code);

    Optional<OrchFlow> findByWebhookToken(String token);

    Page<OrchFlow> findByNameContainingOrCodeContaining(String name, String code, Pageable pageable);

    List<OrchFlow> findByEnabledTrueAndTriggerType(String triggerType);
}
