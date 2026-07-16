package com.hentor.oa.infra.repository;

import com.hentor.oa.infra.entity.SysDictItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SysDictItemRepository extends JpaRepository<SysDictItem, Long> {

    List<SysDictItem> findByTypeIdOrderBySortAscIdAsc(Long typeId);

    long countByTypeId(Long typeId);

    long countByParentId(Long parentId);
}
