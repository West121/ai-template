package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysDataDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysDataDimensionRepository extends JpaRepository<SysDataDimension, String> {

    List<SysDataDimension> findByEnabledTrueOrderByCodeAsc();
}
