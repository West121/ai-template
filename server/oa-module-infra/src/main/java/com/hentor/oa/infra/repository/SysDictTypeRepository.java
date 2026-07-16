package com.hentor.oa.infra.repository;

import com.hentor.oa.infra.entity.SysDictType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysDictTypeRepository extends JpaRepository<SysDictType, Long> {

    Optional<SysDictType> findByCode(String code);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);

    Page<SysDictType> findByNameContainingOrCodeContaining(String name, String code, Pageable pageable);
}
