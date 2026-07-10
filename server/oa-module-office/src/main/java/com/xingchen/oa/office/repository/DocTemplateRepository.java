package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.DocTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocTemplateRepository extends JpaRepository<DocTemplate, Long> {

    List<DocTemplate> findByEnabledTrueOrderByIdAsc();
}
