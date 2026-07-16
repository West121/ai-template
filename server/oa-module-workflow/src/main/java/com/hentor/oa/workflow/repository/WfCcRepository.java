package com.hentor.oa.workflow.repository;

import com.hentor.oa.workflow.entity.WfCc;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface WfCcRepository extends JpaRepository<WfCc, Long> {

    Page<WfCc> findByUserId(Long userId, Pageable pageable);

    /** B-17：抄送给当前用户的实例 proc_inst_id（判定可见实例范围）。 */
    @Query("select c.procInstId from WfCc c where c.userId = :userId")
    List<String> findProcInstIdsByUserId(@Param("userId") Long userId);

    List<WfCc> findByProcInstIdAndUserId(String procInstId, Long userId);

    boolean existsByProcInstIdAndUserId(String procInstId, Long userId);

    long countByUserIdAndReadFlagFalse(Long userId);
}
