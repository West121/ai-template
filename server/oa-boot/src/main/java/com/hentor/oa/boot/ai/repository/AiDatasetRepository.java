package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiDataset;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiDatasetRepository extends JpaRepository<AiDataset, Long> {
}
