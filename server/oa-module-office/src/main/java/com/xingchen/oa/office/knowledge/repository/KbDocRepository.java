package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbDoc;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

public interface KbDocRepository extends JpaRepository<KbDoc, Long> {

    List<KbDoc> findBySpaceIdOrderBySortAscIdAsc(Long spaceId);

    long countBySpaceId(Long spaceId);

    /** 批5 统计：可见空间集合内某类型（DOC）节点数（docCount 按可见空间口径）。 */
    long countByTypeAndSpaceIdIn(String type, Collection<Long> spaceIds);

    /** 批5 统计：可见空间集合内最近更新的文档（COALESCE(updated,created) 降序，Top-N 由 Pageable 限）。 */
    @Query("SELECT d FROM KbDoc d WHERE d.type = :type AND d.spaceId IN :spaceIds "
            + "ORDER BY COALESCE(d.updatedAt, d.createdAt) DESC, d.id DESC")
    List<KbDoc> findRecentDocs(String type, Collection<Long> spaceIds, Pageable pageable);
}
