package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.ApprovalLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

public interface ApprovalLogRepository extends JpaRepository<ApprovalLog, Long> {

    List<ApprovalLog> findByApprovalIdOrderByCreatedAtAsc(Long approvalId);

    List<ApprovalLog> findByActorIdAndActionInOrderByCreatedAtDesc(Long actorId, Collection<String> actions);

    List<ApprovalLog> findByActionInAndCreatedAtGreaterThanEqual(Collection<String> actions, LocalDateTime from);

    /**
     * B-08「我处理过的」分页下推：按单去重后的审批单总数（total 语义与原内存 dedup 一致，
     * 计入引用了但可能已不存在的审批单，保持与原 ordered.size() 相同）。
     */
    @Query("""
            select count(distinct l.approvalId) from ApprovalLog l
            where l.actorId = :actorId and l.action in :actions
            """)
    long countDistinctApprovalByActor(@Param("actorId") Long actorId,
                                      @Param("actions") Collection<String> actions);

    /**
     * B-08「我处理过的」分页下推：去重后的审批单 id，按该单最近一次操作时间倒序，分页取当前页。
     * 与原内存 LinkedHashMap 保留最近一次操作、按 createdAt desc 的语义一致。
     */
    @Query("""
            select l.approvalId from ApprovalLog l
            where l.actorId = :actorId and l.action in :actions
            group by l.approvalId
            order by max(l.createdAt) desc
            """)
    List<Long> findDistinctApprovalIdsByActor(@Param("actorId") Long actorId,
                                              @Param("actions") Collection<String> actions,
                                              Pageable pageable);

    /**
     * 当前页审批单集合内、该操作人的相关日志（倒序），用于取每单最近一次操作（action/actedAt）。
     */
    List<ApprovalLog> findByActorIdAndActionInAndApprovalIdInOrderByCreatedAtDesc(
            Long actorId, Collection<String> actions, Collection<Long> approvalIds);
}
