package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface SysUserRepository extends JpaRepository<SysUser, Long>, JpaSpecificationExecutor<SysUser> {

    Optional<SysUser> findByUsername(String username);

    Page<SysUser> findByNameContaining(String name, Pageable pageable);

    boolean existsByUsername(String username);

    boolean existsByEmpNo(String empNo);

    /** 现有 "XC + 数字" 工号的最大编号（无则 0），用于自动生成下一个工号 */
    @Query(value = "SELECT COALESCE(MAX(CAST(SUBSTRING(emp_no FROM 3) AS INTEGER)), 0) "
            + "FROM sys_user WHERE emp_no ~ '^XC[0-9]+$'", nativeQuery = true)
    int findMaxEmpNoSeq();
}
