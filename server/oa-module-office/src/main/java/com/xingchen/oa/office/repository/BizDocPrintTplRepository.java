package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.BizDocPrintTpl;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BizDocPrintTplRepository extends JpaRepository<BizDocPrintTpl, Long> {

    List<BizDocPrintTpl> findByDefIdOrderByIdAsc(Long defId);
}
