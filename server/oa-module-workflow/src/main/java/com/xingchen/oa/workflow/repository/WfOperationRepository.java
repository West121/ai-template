package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfOperation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfOperationRepository extends JpaRepository<WfOperation, Long> {

    List<WfOperation> findByProcInstIdOrderByCreatedAtAsc(String procInstId);
}
