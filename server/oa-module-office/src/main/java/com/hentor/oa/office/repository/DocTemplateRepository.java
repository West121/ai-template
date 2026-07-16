package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.DocTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocTemplateRepository extends JpaRepository<DocTemplate, Long> {

    List<DocTemplate> findByEnabledTrueOrderByIdAsc();
}
