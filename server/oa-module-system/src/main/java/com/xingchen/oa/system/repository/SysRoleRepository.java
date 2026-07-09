package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysRoleRepository extends JpaRepository<SysRole, Long> {

    boolean existsByCode(String code);

    boolean existsByCodeAndIdNot(String code, Long id);

    /**
     * 按名称或编码精确匹配（B-09：替代 findAll().stream().filter 全表扫描）。
     */
    Optional<SysRole> findFirstByNameOrCode(String name, String code);
}
