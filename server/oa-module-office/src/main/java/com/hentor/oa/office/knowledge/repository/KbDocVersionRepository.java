package com.hentor.oa.office.knowledge.repository;

import com.hentor.oa.office.knowledge.entity.KbDocVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface KbDocVersionRepository extends JpaRepository<KbDocVersion, Long> {

    /** 某文档全部版本，version 降序（前端版本列表）。 */
    List<KbDocVersion> findByDocIdOrderByVersionDesc(Long docId);

    Optional<KbDocVersion> findByDocIdAndVersion(Long docId, Integer version);

    void deleteByDocIdIn(Collection<Long> docIds);
}
