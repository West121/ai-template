package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysDataDimension;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysDataDimensionRepository extends JpaRepository<SysDataDimension, String> {

    List<SysDataDimension> findByEnabledTrueOrderByCodeAsc();

    List<SysDataDimension> findAllByOrderByCodeAsc();
}
