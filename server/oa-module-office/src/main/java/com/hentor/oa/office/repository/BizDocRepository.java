package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.BizDoc;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface BizDocRepository extends JpaRepository<BizDoc, Long>, JpaSpecificationExecutor<BizDoc> {
}
