package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfDelegateRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfDelegateRuleRepository extends JpaRepository<WfDelegateRule, Long> {

    List<WfDelegateRule> findByOwnerIdOrderByIdDesc(Long ownerId);

    List<WfDelegateRule> findByOwnerIdAndEnabledTrue(Long ownerId);
}
