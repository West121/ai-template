package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysPost;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SysPostRepository extends JpaRepository<SysPost, Long> {

    Page<SysPost> findByNameContainingOrCodeContaining(String name, String code, Pageable pageable);

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);
}
