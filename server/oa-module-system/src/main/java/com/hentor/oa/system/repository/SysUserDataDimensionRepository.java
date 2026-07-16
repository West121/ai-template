package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysUserDataDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysUserDataDimensionRepository extends JpaRepository<SysUserDataDimension, Long> {

    List<SysUserDataDimension> findByUserId(Long userId);

    List<SysUserDataDimension> findByUserIdAndFeature(Long userId, String feature);

    boolean existsByDimension(String dimension);

    void deleteByUserId(Long userId);
}
