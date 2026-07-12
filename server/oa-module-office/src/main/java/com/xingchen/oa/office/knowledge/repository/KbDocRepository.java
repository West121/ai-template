package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbDoc;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KbDocRepository extends JpaRepository<KbDoc, Long> {

    List<KbDoc> findBySpaceIdOrderBySortAscIdAsc(Long spaceId);

    long countBySpaceId(Long spaceId);
}
