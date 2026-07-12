package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbSpace;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface KbSpaceRepository extends JpaRepository<KbSpace, Long>, JpaSpecificationExecutor<KbSpace> {

    boolean existsByCode(String code);
}
