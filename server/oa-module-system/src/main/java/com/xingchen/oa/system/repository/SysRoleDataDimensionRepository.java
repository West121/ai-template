package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysRoleDataDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface SysRoleDataDimensionRepository extends JpaRepository<SysRoleDataDimension, Long> {

    List<SysRoleDataDimension> findByRoleId(Long roleId);

    List<SysRoleDataDimension> findByRoleIdIn(Collection<Long> roleIds);

    void deleteByRoleId(Long roleId);
}
