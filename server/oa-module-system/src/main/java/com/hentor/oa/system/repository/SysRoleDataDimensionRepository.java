package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysRoleDataDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface SysRoleDataDimensionRepository extends JpaRepository<SysRoleDataDimension, Long> {

    List<SysRoleDataDimension> findByRoleId(Long roleId);

    List<SysRoleDataDimension> findByRoleIdIn(Collection<Long> roleIds);

    boolean existsByDimension(String dimension);

    void deleteByRoleId(Long roleId);
}
