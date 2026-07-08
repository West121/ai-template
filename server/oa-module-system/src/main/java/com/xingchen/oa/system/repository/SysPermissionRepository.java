package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysPermission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysPermissionRepository extends JpaRepository<SysPermission, Long> {

    List<SysPermission> findAllByOrderByIdAsc();
}
