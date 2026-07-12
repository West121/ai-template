package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbDocTag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface KbDocTagRepository extends JpaRepository<KbDocTag, KbDocTag.Pk> {

    List<KbDocTag> findByDocId(Long docId);

    List<KbDocTag> findByDocIdIn(Collection<Long> docIds);

    boolean existsByDocIdAndTagId(Long docId, Long tagId);

    void deleteByDocIdAndTagId(Long docId, Long tagId);

    void deleteByDocIdIn(Collection<Long> docIds);

    void deleteByTagId(Long tagId);
}
