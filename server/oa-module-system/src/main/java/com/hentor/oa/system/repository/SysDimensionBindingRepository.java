package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysDimensionBinding;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysDimensionBindingRepository extends JpaRepository<SysDimensionBinding, Long> {

    List<SysDimensionBinding> findByEntityOrderByIdAsc(String entity);

    List<SysDimensionBinding> findByDimensionOrderByIdAsc(String dimension);

    void deleteByDimension(String dimension);
}
