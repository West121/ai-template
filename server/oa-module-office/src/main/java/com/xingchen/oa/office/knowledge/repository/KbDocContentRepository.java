package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbDocContent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;

public interface KbDocContentRepository extends JpaRepository<KbDocContent, Long> {

    void deleteByDocIdIn(Collection<Long> docIds);

    /**
     * 只更新 ydoc + updated_at（CRDT 协同快照落库），不动 content_json/content_text——
     * 与 REST 保存正文路径互不覆盖。返回受影响行数（0 表示正文行尚不存在，调用方决定是否 upsert）。
     */
    @Modifying
    @Query("update KbDocContent c set c.ydoc = :ydoc, c.updatedAt = :now where c.docId = :docId")
    int updateYdoc(@Param("docId") Long docId, @Param("ydoc") byte[] ydoc, @Param("now") OffsetDateTime now);
}
