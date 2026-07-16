package com.hentor.oa.infra.repository;

import com.hentor.oa.infra.entity.SysLoginLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysLoginLogRepository extends JpaRepository<SysLoginLog, Long> {

    Page<SysLoginLog> findByUsernameContaining(String keyword, Pageable pageable);
}
