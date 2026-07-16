package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysHandoverItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysHandoverItemRepository extends JpaRepository<SysHandoverItem, Long> {

    List<SysHandoverItem> findByHandoverIdOrderByIdAsc(Long handoverId);
}
