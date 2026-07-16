package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiReportCatalog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiReportCatalogRepository extends JpaRepository<AiReportCatalog, Long> {

    List<AiReportCatalog> findByStatusOrderByIdAsc(String status);

    Optional<AiReportCatalog> findByReportCodeIgnoreCase(String reportCode);
}
