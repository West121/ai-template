package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbDocContent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;

public interface KbDocContentRepository extends JpaRepository<KbDocContent, Long> {

    void deleteByDocIdIn(Collection<Long> docIds);
}
