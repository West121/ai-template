package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.DocNumberSeq;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DocNumberSeqRepository extends JpaRepository<DocNumberSeq, Long> {

    Optional<DocNumberSeq> findByRuleIdAndPeriod(Long ruleId, String period);
}
