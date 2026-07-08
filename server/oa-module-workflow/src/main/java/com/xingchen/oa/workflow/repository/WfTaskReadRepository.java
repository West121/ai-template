package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfTaskRead;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WfTaskReadRepository extends JpaRepository<WfTaskRead, Long> {

    boolean existsByTaskIdAndUserId(String taskId, Long userId);

    boolean existsByProcInstIdAndUserId(String procInstId, Long userId);
}
