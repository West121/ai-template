package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.DocNumberRule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DocNumberRuleRepository extends JpaRepository<DocNumberRule, Long> {

    List<DocNumberRule> findByEnabledTrueOrderByIdAsc();

    Optional<DocNumberRule> findByCode(String code);
}
