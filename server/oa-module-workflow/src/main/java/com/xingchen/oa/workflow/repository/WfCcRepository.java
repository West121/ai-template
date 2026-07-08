package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfCc;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfCcRepository extends JpaRepository<WfCc, Long> {

    Page<WfCc> findByUserId(Long userId, Pageable pageable);

    List<WfCc> findByProcInstIdAndUserId(String procInstId, Long userId);

    boolean existsByProcInstIdAndUserId(String procInstId, Long userId);

    long countByUserIdAndReadFlagFalse(Long userId);
}
