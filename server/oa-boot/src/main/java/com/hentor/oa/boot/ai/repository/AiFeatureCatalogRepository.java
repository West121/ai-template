package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiFeatureCatalog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiFeatureCatalogRepository extends JpaRepository<AiFeatureCatalog, Long> {

    List<AiFeatureCatalog> findByStatusOrderByIdAsc(String status);

    Optional<AiFeatureCatalog> findByFeatureCodeIgnoreCase(String featureCode);
}
