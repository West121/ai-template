package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.DocOpinion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocOpinionRepository extends JpaRepository<DocOpinion, Long> {

    List<DocOpinion> findByDocumentIdOrderByIdAsc(Long documentId);
}
