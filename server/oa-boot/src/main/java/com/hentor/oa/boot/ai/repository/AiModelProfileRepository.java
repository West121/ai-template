package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiModelProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiModelProfileRepository extends JpaRepository<AiModelProfile, Long> {

    Optional<AiModelProfile> findByCodeIgnoreCase(String code);

    List<AiModelProfile> findByEnabledTrueOrderBySortNoAscIdAsc();
}
