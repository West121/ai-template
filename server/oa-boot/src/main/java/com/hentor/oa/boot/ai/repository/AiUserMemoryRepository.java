package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiUserMemory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiUserMemoryRepository extends JpaRepository<AiUserMemory, Long> {

    List<AiUserMemory> findByTenantIdAndUserIdAndStatusOrderByUpdatedAtDescIdDesc(
            String tenantId, Long userId, String status);

    Optional<AiUserMemory> findByTenantIdAndUserIdAndMemoryKeyAndStatus(
            String tenantId, Long userId, String memoryKey, String status);
}
