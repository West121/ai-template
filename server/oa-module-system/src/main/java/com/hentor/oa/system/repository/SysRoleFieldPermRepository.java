package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysRoleFieldPerm;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface SysRoleFieldPermRepository extends JpaRepository<SysRoleFieldPerm, Long> {

    List<SysRoleFieldPerm> findByRoleIdOrderByFeatureAscFieldAsc(Long roleId);

    List<SysRoleFieldPerm> findByRoleIdAndFeatureOrderByFieldAsc(Long roleId, String feature);

    List<SysRoleFieldPerm> findByRoleIdIn(Collection<Long> roleIds);

    void deleteByRoleIdAndFeature(Long roleId, String feature);
}
