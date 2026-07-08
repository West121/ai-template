package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.ApprovalLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

public interface ApprovalLogRepository extends JpaRepository<ApprovalLog, Long> {

    List<ApprovalLog> findByApprovalIdOrderByCreatedAtAsc(Long approvalId);

    List<ApprovalLog> findByActorIdAndActionInOrderByCreatedAtDesc(Long actorId, Collection<String> actions);

    List<ApprovalLog> findByActionInAndCreatedAtGreaterThanEqual(Collection<String> actions, LocalDateTime from);
}
