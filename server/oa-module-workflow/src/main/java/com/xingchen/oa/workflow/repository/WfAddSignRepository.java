package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfAddSign;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface WfAddSignRepository extends JpaRepository<WfAddSign, Long> {

    Optional<WfAddSign> findByTaskIdAndStatus(String taskId, String status);
}
