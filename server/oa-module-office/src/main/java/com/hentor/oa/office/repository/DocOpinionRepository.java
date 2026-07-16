package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.DocOpinion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocOpinionRepository extends JpaRepository<DocOpinion, Long> {

    List<DocOpinion> findByDocumentIdOrderByIdAsc(Long documentId);
}
