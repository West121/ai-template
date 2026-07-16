package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysPermission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysPermissionRepository extends JpaRepository<SysPermission, Long> {

    List<SysPermission> findAllByOrderByIdAsc();
}
