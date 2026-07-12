package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysCostCenter;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysCostCenterRepository extends JpaRepository<SysCostCenter, Long> {

    List<SysCostCenter> findByEnabledTrueOrderByIdAsc();
}
