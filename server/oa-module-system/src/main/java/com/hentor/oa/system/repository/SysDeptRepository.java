package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SysDeptRepository extends JpaRepository<SysDept, Long> {

    boolean existsByParentId(Long parentId);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);

    /** 某用户负责的部门（离职交接 DEPT_LEADER 扫描用）。 */
    List<SysDept> findByLeaderId(Long leaderId);

    /**
     * DP1b 物化路径子树：按 path 前缀取子树部门 id（含自身）。调用方传 {@code deptPath + "%"}，
     * PG text_pattern_ops 索引优化前缀 LIKE，替代 ancestors 递归/全表扫描。
     */
    @Query("select d.id from SysDept d where d.path like :prefix")
    List<Long> findIdsByPathPrefix(@Param("prefix") String prefix);
}
