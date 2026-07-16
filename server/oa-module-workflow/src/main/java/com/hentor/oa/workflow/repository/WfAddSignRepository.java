package com.hentor.oa.workflow.repository;

import com.hentor.oa.workflow.entity.WfAddSign;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface WfAddSignRepository extends JpaRepository<WfAddSign, Long> {

    Optional<WfAddSign> findByTaskIdAndStatus(String taskId, String status);
}
