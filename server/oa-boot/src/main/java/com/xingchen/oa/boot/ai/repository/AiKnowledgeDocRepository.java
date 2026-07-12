package com.xingchen.oa.boot.ai.repository;

import com.xingchen.oa.boot.ai.entity.AiKnowledgeDoc;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AiKnowledgeDocRepository extends JpaRepository<AiKnowledgeDoc, Long> {

    List<AiKnowledgeDoc> findByStatusOrderByIdAsc(String status);

    List<AiKnowledgeDoc> findByStatusAndModuleCodeOrderByIdAsc(String status, String moduleCode);
}
