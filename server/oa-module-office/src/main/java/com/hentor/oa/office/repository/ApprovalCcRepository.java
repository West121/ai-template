package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.ApprovalCc;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ApprovalCcRepository extends JpaRepository<ApprovalCc, Long> {

    Page<ApprovalCc> findByUserId(Long userId, Pageable pageable);

    List<ApprovalCc> findByApprovalIdAndUserId(Long approvalId, Long userId);

    List<ApprovalCc> findByUserIdAndReadFlagFalse(Long userId);
}
