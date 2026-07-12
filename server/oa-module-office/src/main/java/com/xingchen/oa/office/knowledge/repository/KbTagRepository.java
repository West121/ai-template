package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbTag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KbTagRepository extends JpaRepository<KbTag, Long> {

    List<KbTag> findByTenantIdOrderByIdAsc(String tenantId);

    Optional<KbTag> findByTenantIdAndName(String tenantId, String name);
}
