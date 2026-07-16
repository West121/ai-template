package com.hentor.oa.office.repository;

import com.hentor.oa.office.entity.DocNumberLedger;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface DocNumberLedgerRepository extends JpaRepository<DocNumberLedger, Long>,
        JpaSpecificationExecutor<DocNumberLedger> {

    Optional<DocNumberLedger> findFirstByDocumentIdOrderByIdAsc(Long documentId);

    Optional<DocNumberLedger> findByDocNumber(String docNumber);
}
