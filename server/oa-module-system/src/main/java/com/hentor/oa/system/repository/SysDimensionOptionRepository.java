package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysDimensionOption;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SysDimensionOptionRepository extends JpaRepository<SysDimensionOption, Long> {

    List<SysDimensionOption> findByDimensionOrderBySortAscIdAsc(String dimension);

    List<SysDimensionOption> findByDimensionAndEnabledTrueOrderBySortAscIdAsc(String dimension);

    Optional<SysDimensionOption> findByDimensionAndValue(String dimension, Long value);

    @Query("select max(o.value) from SysDimensionOption o where o.dimension = :dimension")
    Long maxValue(String dimension);

    void deleteByDimension(String dimension);
}
