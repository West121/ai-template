package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.BizDocDef;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BizDocDefRepository extends JpaRepository<BizDocDef, Long> {

    Optional<BizDocDef> findByCode(String code);

    Page<BizDocDef> findByNameContainingOrCodeContaining(String name, String code, Pageable pageable);

    List<BizDocDef> findByStatusOrderByIdAsc(String status);
}
