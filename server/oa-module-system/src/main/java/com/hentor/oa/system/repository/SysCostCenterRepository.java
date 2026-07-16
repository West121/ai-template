package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysCostCenter;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysCostCenterRepository extends JpaRepository<SysCostCenter, Long> {

    List<SysCostCenter> findByEnabledTrueOrderByIdAsc();
}
