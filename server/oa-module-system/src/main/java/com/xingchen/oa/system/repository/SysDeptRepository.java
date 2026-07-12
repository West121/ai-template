package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysDept;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysDeptRepository extends JpaRepository<SysDept, Long> {

    boolean existsByParentId(Long parentId);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);

    /** 某用户负责的部门（离职交接 DEPT_LEADER 扫描用）。 */
    List<SysDept> findByLeaderId(Long leaderId);
}
