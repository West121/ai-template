package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfNotify;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfNotifyRepository extends JpaRepository<WfNotify, Long> {

    Page<WfNotify> findByUserId(Long userId, Pageable pageable);

    long countByUserIdAndReadFlagFalse(Long userId);

    List<WfNotify> findByUserIdAndReadFlagFalse(Long userId);
}
