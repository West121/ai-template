package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfFormDef;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WfFormDefRepository extends JpaRepository<WfFormDef, Long> {

    Optional<WfFormDef> findByCodeAndVersion(String code, Integer version);

    List<WfFormDef> findByCodeOrderByVersionDesc(String code);

    Page<WfFormDef> findByNameContainingOrCodeContaining(String name, String code, Pageable pageable);

    Optional<WfFormDef> findTopByCodeAndStatusOrderByVersionDesc(String code, String status);

    Optional<WfFormDef> findTopByCodeOrderByVersionDesc(String code);
}
