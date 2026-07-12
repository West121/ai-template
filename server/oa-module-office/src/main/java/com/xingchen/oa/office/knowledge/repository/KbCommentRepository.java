package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbComment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface KbCommentRepository extends JpaRepository<KbComment, Long> {

    /** 某文档全部评论，created 升序（前端自建回复树）。 */
    List<KbComment> findByDocIdOrderByCreatedAtAscIdAsc(Long docId);

    void deleteByDocIdIn(Collection<Long> docIds);
}
