package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.BizDocPrintTpl;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;

public interface BizDocPrintTplRepository
        extends JpaRepository<BizDocPrintTpl, Long>, JpaSpecificationExecutor<BizDocPrintTpl> {

    List<BizDocPrintTpl> findByDefIdOrderByIdAsc(Long defId);

    Optional<BizDocPrintTpl> findByCode(String code);

    /** §11 for-instance：按绑定 + 已发布匹配。 */
    List<BizDocPrintTpl> findByBindTypeAndBindCodeAndStatusOrderByIdAsc(String bindType, String bindCode, String status);
}
