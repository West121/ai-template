package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysPost;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysPostRepository extends JpaRepository<SysPost, Long> {

    Page<SysPost> findByNameContainingOrCodeContaining(String name, String code, Pageable pageable);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);

    /**
     * 按名称或编码精确匹配（B-09：替代 findAll().stream().filter 全表扫描）。
     */
    Optional<SysPost> findFirstByNameOrCode(String name, String code);
}
