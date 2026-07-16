package com.hentor.oa.workflow.repository;

import com.hentor.oa.workflow.entity.WfSeal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfSealRepository extends JpaRepository<WfSeal, Long> {

    List<WfSeal> findAllByOrderByIdDesc();

    /** B-17：文件是否被某个电子章引用（印章图片是组织级登录可见资产）。 */
    boolean existsByImageFileId(Long imageFileId);
}
