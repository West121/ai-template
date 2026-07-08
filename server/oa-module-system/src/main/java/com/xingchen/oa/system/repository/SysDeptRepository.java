package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysDept;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysDeptRepository extends JpaRepository<SysDept, Long> {

    boolean existsByParentId(Long parentId);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);
}
