package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbDocTag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

public interface KbDocTagRepository extends JpaRepository<KbDocTag, KbDocTag.Pk> {

    List<KbDocTag> findByDocId(Long docId);

    /** 批5 统计：可见空间集合内文档上用到的去重标签数（tagCount 按可见空间口径，红线不含不可见空间标签）。 */
    @Query("SELECT COUNT(DISTINCT t.tagId) FROM KbDocTag t "
            + "WHERE t.docId IN (SELECT d.id FROM KbDoc d WHERE d.spaceId IN :spaceIds)")
    long countDistinctTagInSpaces(Collection<Long> spaceIds);

    List<KbDocTag> findByDocIdIn(Collection<Long> docIds);

    boolean existsByDocIdAndTagId(Long docId, Long tagId);

    void deleteByDocIdAndTagId(Long docId, Long tagId);

    void deleteByDocIdIn(Collection<Long> docIds);

    void deleteByTagId(Long tagId);
}
