package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysUserDataDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysUserDataDimensionRepository extends JpaRepository<SysUserDataDimension, Long> {

    List<SysUserDataDimension> findByUserId(Long userId);

    void deleteByUserId(Long userId);
}
