package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfProcessExt;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WfProcessExtRepository extends JpaRepository<WfProcessExt, Long> {

    Optional<WfProcessExt> findByDefCode(String defCode);

    List<WfProcessExt> findByStatusOrderByIdAsc(String status);

    Page<WfProcessExt> findByNameContainingOrDefCodeContaining(String name, String defCode, Pageable pageable);
}
