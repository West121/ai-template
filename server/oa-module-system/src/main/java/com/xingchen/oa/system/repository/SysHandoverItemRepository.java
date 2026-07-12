package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysHandoverItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysHandoverItemRepository extends JpaRepository<SysHandoverItem, Long> {

    List<SysHandoverItem> findByHandoverIdOrderByIdAsc(Long handoverId);
}
