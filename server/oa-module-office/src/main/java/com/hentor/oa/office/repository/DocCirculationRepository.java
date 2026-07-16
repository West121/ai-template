package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.DocCirculation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DocCirculationRepository extends JpaRepository<DocCirculation, Long> {

    List<DocCirculation> findByDocumentIdOrderByIdAsc(Long documentId);
}
